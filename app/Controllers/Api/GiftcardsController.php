<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * GiftcardsController — full lifecycle gift card API for PESASWAP.
 *
 * Schema additions (see docs/migrations/2026_06_04_giftcards_lifecycle.sql):
 *   ospos_giftcards now has initial_value, status, recipient_*, sender_*,
 *   message, currency, expires_at, email_status, email_sent_at, updated_at.
 *   New ospos_giftcard_history records every balance mutation.
 *
 * Operations:
 *   GET    /api/giftcards                  list + pagination + status filter + search
 *   GET    /api/giftcards/:id              detail + sanitized history
 *   POST   /api/giftcards                  create (auto-generates GC-XXXX-XXXX-XXXX code)
 *   PUT    /api/giftcards/:id              edit metadata only (not balance)
 *   DELETE /api/giftcards/:id              soft delete (status='disabled')
 *   POST   /api/giftcards/:id/redeem       deduct balance
 *   POST   /api/giftcards/:id/refund       restore balance
 *   POST   /api/giftcards/:id/adjust       admin set balance (with audit reason)
 *   POST   /api/giftcards/:id/topup        MNO top-up (mocked STK push, async-shaped)
 *   POST   /api/giftcards/:id/resend-email re-issue delivery email (mock)
 *   GET    /api/giftcards/:id/history      audit trail
 *
 * Public (no auth, see PublicController for the route):
 *   GET    /api/public/giftcards/balance/:code   sanitized balance lookup
 *
 * Correctness:
 *   - Every balance mutation runs in a transaction with SELECT ... FOR UPDATE
 *     on the gift card row so concurrent redeem/topup/refund cannot overspend.
 *   - Money arithmetic uses bcadd/bcsub/bccomp (2dp) — no PHP float math.
 *   - History rows are written inside the same transaction as the balance update.
 *   - Status is hybrid: 'active'/'used'/'disabled' persisted; 'expired' computed
 *     from expires_at at read AND enforced by redeem refusing expired cards.
 *
 * Lifecycle write APIs return 503 if the migration hasn't been applied (graceful
 * degradation only on the read path — never silently skip audit writes).
 */
class GiftcardsController extends BaseApiController
{
    private const SCALE = 2;
    private const MAX_CODE_RETRIES = 5;

    private const STATUS_ACTIVE = 'active';
    private const STATUS_USED = 'used';
    private const STATUS_DISABLED = 'disabled';
    private const STATUS_EXPIRED = 'expired';   // computed-only

    private const ACTION_CREATED = 'created';
    private const ACTION_REDEEMED = 'redeemed';
    private const ACTION_REFUNDED = 'refunded';
    private const ACTION_ADJUSTED = 'adjusted';
    private const ACTION_TOPPED_UP = 'topped_up';
    private const ACTION_DISABLED = 'disabled';
    private const ACTION_EMAILED = 'emailed';
    private const ACTION_TRANSFER_REQUESTED = 'transfer_requested';
    private const ACTION_TRANSFER_ACCEPTED_OUT = 'transfer_accepted_out';
    private const ACTION_TRANSFER_ACCEPTED_IN = 'transfer_accepted_in';
    private const ACTION_TRANSFER_CANCELLED = 'transfer_cancelled';
    private const ACTION_SCHEDULED = 'scheduled';
    private const ACTION_DELIVERED = 'delivered';

    // Delivery state machine for scheduled (deliver_at) cards.
    private const DELIVERY_IMMEDIATE = 'immediate';
    private const DELIVERY_PENDING = 'pending';
    private const DELIVERY_SENDING = 'sending';
    private const DELIVERY_SENT = 'sent';
    private const DELIVERY_FAILED = 'failed';
    private const DELIVERY_CANCELLED = 'cancelled';

    // Transfer URL token TTL — defaults to 24h.
    private const TRANSFER_TOKEN_TTL_HOURS = 24;
    private const TRANSFER_LOOKUP_RATE = 30;
    private const TRANSFER_ACCEPT_RATE = 5;

    // Server-side whitelist for the lucide icon name persisted with each
    // design. The frontend renders by name lookup, so an unknown name
    // would silently fail — defence in depth against malicious admin input.
    private const ALLOWED_DESIGN_ICONS = [
        'Gift', 'Sparkles', 'TreePine', 'Cake', 'Star', 'Heart',
        'PartyPopper', 'Cookie', 'Flower2', 'Music4', 'Coffee', 'Pizza',
        'Award', 'Crown', 'Diamond', 'Trophy', 'Wand2',
    ];

    private const ALLOWED_TOPUP_PROVIDERS = ['mpesa', 'airtel', 'mtn_momo', 'cash', 'card', 'bank'];

    // ---------- list / detail ----------

    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string)($this->request->getGet('search') ?? ''));
        $statusFilter = trim((string)($this->request->getGet('status') ?? ''));

        try {
            if (!$this->db->tableExists('giftcards')) {
                return $this->respondSuccess([
                    'giftcards' => [],
                    'pagination' => $this->emptyPagination($pagination, $search),
                    'stats' => $this->emptyStats(),
                ], 'Giftcards table is not available.');
            }

            $giftcardsTable = $this->db->prefixTable('giftcards');
            $select = $this->buildGiftcardSelect();

            $where = ['giftcards.deleted = 0'];
            $params = [];

            if ($search !== '') {
                $like = $this->likeValue($search);
                $where[] = "(giftcards.giftcard_number LIKE ? ESCAPE '!'"
                    . ($this->hasField('giftcards', 'recipient_name') ? " OR giftcards.recipient_name LIKE ? ESCAPE '!'" : '')
                    . ($this->hasField('giftcards', 'recipient_email') ? " OR giftcards.recipient_email LIKE ? ESCAPE '!'" : '')
                    . ')';
                $params[] = $like;
                if ($this->hasField('giftcards', 'recipient_name')) $params[] = $like;
                if ($this->hasField('giftcards', 'recipient_email')) $params[] = $like;
            }

            if ($statusFilter !== '' && $this->hasField('giftcards', 'status')) {
                if (in_array($statusFilter, [self::STATUS_ACTIVE, self::STATUS_USED, self::STATUS_DISABLED, self::STATUS_EXPIRED], true)) {
                    if ($statusFilter === self::STATUS_EXPIRED) {
                        $where[] = 'giftcards.expires_at IS NOT NULL AND giftcards.expires_at < NOW() AND giftcards.status != ?';
                        $params[] = self::STATUS_DISABLED;
                    } else {
                        $where[] = 'giftcards.status = ?';
                        $params[] = $statusFilter;
                    }
                }
            }

            $whereSql = 'WHERE ' . implode(' AND ', $where);

            $sql = "SELECT " . implode(', ', $select) . "
                    FROM {$giftcardsTable} AS giftcards
                    {$whereSql}
                    ORDER BY " . $this->orderByCreated() . " DESC, giftcards.giftcard_id DESC
                    LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}";

            $countSql = "SELECT COUNT(*) AS total FROM {$giftcardsTable} AS giftcards {$whereSql}";

            $rows = $this->db->query($sql, $params)->getResultArray();
            $total = (int)($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            $giftcards = array_map(fn(array $r) => $this->decorate($r), $rows);

            return $this->respondSuccess([
                'giftcards' => $giftcards,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                    'search' => $search,
                ],
                'stats' => $this->loadStats(),
            ]);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::index — ' . $e->getMessage());
            return $this->respondError('Failed to load gift cards.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $row = $this->fetchGiftcard($id);
        if ($row === null) {
            return $this->respondError('Gift card not found.', 404);
        }

        return $this->respondSuccess([
            'giftcard' => $this->decorate($row),
            'history' => $this->fetchHistory($id, false),
        ]);
    }

    public function history(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if ($this->fetchGiftcard($id) === null) {
            return $this->respondError('Gift card not found.', 404);
        }
        return $this->respondSuccess(['history' => $this->fetchHistory($id, false)]);
    }

    // ---------- create / update / delete ----------

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->migrationApplied()) {
            return $this->respondError('Gift card migration is required for create.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];

        $recipientName = trim((string)($body['recipient_name'] ?? ''));
        $recipientEmail = trim((string)($body['recipient_email'] ?? ''));
        $senderName = trim((string)($body['sender_name'] ?? ''));
        $senderEmail = trim((string)($body['sender_email'] ?? ''));
        $message = trim((string)($body['message'] ?? ''));
        $currency = strtoupper(trim((string)($body['currency'] ?? 'KES'))) ?: 'KES';

        if ($recipientEmail !== '' && !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('Recipient email is not a valid email address.', 422);
        }
        if ($senderEmail !== '' && !filter_var($senderEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('Sender email is not a valid email address.', 422);
        }

        // Modernization-aware fields (degrade gracefully if migration not applied).
        $designId = $this->validateDesignId($body['design_id'] ?? null);
        if ($designId === false) {
            return $this->respondError('Selected design is not available.', 422);
        }

        $denomination = $this->loadDenomination($body['denomination_id'] ?? null, $currency);
        if ($denomination === false) {
            return $this->respondError('Selected denomination is not available for this currency.', 422);
        }

        // Value priority: explicit body value > denomination amount.
        $bodyValue = $body['value'] ?? $body['amount'] ?? null;
        if (($bodyValue === null || $bodyValue === '') && $denomination !== null && isset($denomination['amount'])) {
            $bodyValue = $denomination['amount'];
        }
        $value = $this->parseAmount($bodyValue);
        if ($value === null || $this->bccompZero($value) <= 0) {
            return $this->respondError('A positive value is required.', 422);
        }
        if ($denomination !== null && bccomp($value, (string)$denomination['amount'], self::SCALE) !== 0) {
            return $this->respondError('Value does not match the selected denomination amount.', 422);
        }

        $deliverAt = $this->parseFutureDateTime($body['deliver_at'] ?? null);
        if ($deliverAt === false) {
            return $this->respondError('deliver_at must be a future ISO-8601 datetime.', 422);
        }
        $scheduled = $deliverAt !== null;
        if ($scheduled && $recipientEmail === '') {
            return $this->respondError('Scheduled delivery requires a recipient email.', 422);
        }

        $expiresAt = $this->parseExpiry($body['expires_at'] ?? null, $body['expires_in_days'] ?? null);

        $providerRaw = isset($body['payment_provider']) ? (string)$body['payment_provider'] : '';
        $provider = $providerRaw !== '' && in_array($providerRaw, self::ALLOWED_TOPUP_PROVIDERS, true)
            ? $providerRaw : null;
        $reference = isset($body['payment_reference']) ? mb_substr((string)$body['payment_reference'], 0, 64) : null;

        try {
            $code = $this->generateUniqueCode();
            if ($code === null) {
                return $this->respondError('Failed to generate a unique gift card code; please retry.', 500);
            }

            $this->db->transStart();

            $insert = [
                'giftcard_number' => $code,
                'value' => $value,
                'initial_value' => $value,
                'status' => self::STATUS_ACTIVE,
                'recipient_name' => $recipientName ?: null,
                'recipient_email' => $recipientEmail ?: null,
                'sender_name' => $senderName ?: null,
                'sender_email' => $senderEmail ?: null,
                'message' => $message !== '' ? $message : null,
                'currency' => $currency,
                'expires_at' => $expiresAt,
                'email_status' => $scheduled
                    ? 'scheduled'
                    : ($recipientEmail !== '' ? 'mocked' : 'not_requested'),
                'email_sent_at' => (!$scheduled && $recipientEmail !== '') ? date('Y-m-d H:i:s') : null,
                'deleted' => 0,
            ];

            if ($this->modernizationApplied()) {
                $insert['design_id'] = $designId;
                $insert['denomination_amount_snapshot'] = $denomination['amount'] ?? null;
                $insert['denomination_label_snapshot'] = $denomination['label'] ?? null;
                $insert['deliver_at'] = $deliverAt;
                $insert['delivery_status'] = $scheduled ? self::DELIVERY_PENDING : self::DELIVERY_IMMEDIATE;
                $insert['delivered_at'] = !$scheduled && $recipientEmail !== '' ? date('Y-m-d H:i:s') : null;
            }

            $this->db->table('giftcards')->insert($insert);
            $newId = (int)$this->db->insertID();

            $this->writeHistory($newId, [
                'action' => self::ACTION_CREATED,
                'amount' => $value,
                'balance_before' => '0.00',
                'balance_after' => $value,
                'provider' => $provider,
                'reference' => $reference,
                'transaction_id' => $provider ? $this->mockTransactionId('CREATE') : null,
                'txn_status' => 'completed',
                'comment' => 'Gift card issued' . ($provider ? ' (paid via ' . $provider . ')' : ''),
            ]);

            if ($scheduled) {
                $this->writeHistory($newId, [
                    'action' => self::ACTION_SCHEDULED,
                    'amount' => '0.00',
                    'balance_before' => $value,
                    'balance_after' => $value,
                    'comment' => 'Delivery scheduled for ' . $deliverAt . ' to ' . $recipientEmail,
                ]);
            } elseif ($recipientEmail !== '') {
                $this->writeHistory($newId, [
                    'action' => self::ACTION_EMAILED,
                    'amount' => '0.00',
                    'balance_before' => $value,
                    'balance_after' => $value,
                    'comment' => 'Delivery email mocked to ' . $recipientEmail,
                ]);
            }

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create gift card.', 500);
            }

            $fresh = $this->fetchGiftcard($newId);
            return $this->respondSuccess([
                'giftcard' => $fresh ? $this->decorate($fresh) : null,
                'history' => $this->fetchHistory($newId, false),
            ], 'Gift card created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::create — ' . $e->getMessage());
            return $this->respondError('Failed to create gift card.', 500);
        }
    }

    public function update(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->migrationApplied()) {
            return $this->respondError('Gift card migration is required for update.', 503);
        }
        $existing = $this->fetchGiftcard($id);
        if ($existing === null) {
            return $this->respondError('Gift card not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $patch = [];
        foreach (['recipient_name', 'recipient_email', 'sender_name', 'sender_email', 'message'] as $f) {
            if (array_key_exists($f, $body)) {
                $val = trim((string)$body[$f]);
                $patch[$f] = $val !== '' ? mb_substr($val, 0, 255) : null;
            }
        }
        if (array_key_exists('expires_at', $body) || array_key_exists('expires_in_days', $body)) {
            $patch['expires_at'] = $this->parseExpiry($body['expires_at'] ?? null, $body['expires_in_days'] ?? null);
        }
        if (isset($patch['recipient_email']) && $patch['recipient_email'] !== null
            && !filter_var($patch['recipient_email'], FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('Recipient email is not a valid email address.', 422);
        }
        if (empty($patch)) {
            return $this->respondError('No editable fields supplied.', 422);
        }

        try {
            $this->db->table('giftcards')->where('giftcard_id', $id)->update($patch);
            $fresh = $this->fetchGiftcard($id);
            return $this->respondSuccess([
                'giftcard' => $fresh ? $this->decorate($fresh) : null,
            ], 'Gift card updated.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::update — ' . $e->getMessage());
            return $this->respondError('Failed to update gift card.', 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        $existing = $this->fetchGiftcard($id);
        if ($existing === null) {
            return $this->respondError('Gift card not found.', 404);
        }
        if (!$this->migrationApplied()) {
            // Best-effort soft-delete on old schemas
            $this->db->table('giftcards')->where('giftcard_id', $id)->update(['deleted' => 1]);
            return $this->respondSuccess(['giftcard_id' => $id], 'Gift card deleted.');
        }

        try {
            $balance = (string)($existing['value'] ?? '0');
            $this->db->transStart();
            $this->db->table('giftcards')->where('giftcard_id', $id)->update([
                'deleted' => 1,
                'status' => self::STATUS_DISABLED,
            ]);
            $this->writeHistory($id, [
                'action' => self::ACTION_DISABLED,
                'amount' => '0.00',
                'balance_before' => $balance,
                'balance_after' => $balance,
                'comment' => 'Gift card disabled by operator',
            ]);
            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to delete gift card.', 500);
            }
            return $this->respondSuccess(['giftcard_id' => $id], 'Gift card deleted.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::delete — ' . $e->getMessage());
            return $this->respondError('Failed to delete gift card.', 500);
        }
    }

    // ---------- balance mutations (all transactional + locked) ----------

    public function redeem(int $id): ResponseInterface
    {
        return $this->mutateBalance($id, function (array $body, array $row) {
            $amount = $this->parseAmount($body['amount'] ?? 0);
            if ($amount === null || $this->bccompZero($amount) <= 0) {
                return ['error' => 'A positive amount is required.', 'code' => 422];
            }
            // Refuse expired
            if ($this->computeStatus($row) === self::STATUS_EXPIRED) {
                return ['error' => 'Gift card is expired.', 'code' => 409];
            }
            if (in_array($row['status'] ?? '', [self::STATUS_DISABLED], true)) {
                return ['error' => 'Gift card is disabled.', 'code' => 409];
            }
            $current = (string)$row['value'];
            if (bccomp($amount, $current, self::SCALE) > 0) {
                return ['error' => 'Insufficient balance.', 'code' => 422];
            }
            $newBalance = bcsub($current, $amount, self::SCALE);
            $newStatus = $this->bccompZero($newBalance) <= 0 ? self::STATUS_USED : self::STATUS_ACTIVE;
            return [
                'action' => self::ACTION_REDEEMED,
                'amount' => $amount,
                'new_balance' => $newBalance,
                'new_status' => $newStatus,
                'order_id' => isset($body['order_id']) ? (int)$body['order_id'] : null,
                'comment' => trim((string)($body['comment'] ?? '')) ?: null,
            ];
        });
    }

    public function refund(int $id): ResponseInterface
    {
        return $this->mutateBalance($id, function (array $body, array $row) {
            $amount = $this->parseAmount($body['amount'] ?? 0);
            if ($amount === null || $this->bccompZero($amount) <= 0) {
                return ['error' => 'A positive amount is required.', 'code' => 422];
            }
            if (in_array($row['status'] ?? '', [self::STATUS_DISABLED], true)) {
                return ['error' => 'Gift card is disabled.', 'code' => 409];
            }
            $current = (string)$row['value'];
            $newBalance = bcadd($current, $amount, self::SCALE);
            $newStatus = self::STATUS_ACTIVE;
            return [
                'action' => self::ACTION_REFUNDED,
                'amount' => $amount,
                'new_balance' => $newBalance,
                'new_status' => $newStatus,
                'order_id' => isset($body['order_id']) ? (int)$body['order_id'] : null,
                'comment' => trim((string)($body['comment'] ?? '')) ?: 'Refund to gift card',
            ];
        });
    }

    public function adjust(int $id): ResponseInterface
    {
        return $this->mutateBalance($id, function (array $body, array $row) {
            $newBalance = $this->parseAmount($body['new_balance'] ?? null);
            if ($newBalance === null || bccomp($newBalance, '0', self::SCALE) < 0) {
                return ['error' => 'A non-negative new_balance is required.', 'code' => 422];
            }
            $reason = trim((string)($body['reason'] ?? ''));
            if ($reason === '') {
                return ['error' => 'A reason is required for admin adjustments.', 'code' => 422];
            }
            if (in_array($row['status'] ?? '', [self::STATUS_DISABLED], true)) {
                return ['error' => 'Gift card is disabled.', 'code' => 409];
            }
            $current = (string)$row['value'];
            // Amount in audit row = delta (positive or negative — store absolute, comment carries sign)
            $delta = bcsub($newBalance, $current, self::SCALE);
            $newStatus = $this->bccompZero($newBalance) <= 0 ? self::STATUS_USED : self::STATUS_ACTIVE;
            return [
                'action' => self::ACTION_ADJUSTED,
                'amount' => $delta,
                'new_balance' => $newBalance,
                'new_status' => $newStatus,
                'comment' => 'Admin adjustment: ' . mb_substr($reason, 0, 255),
            ];
        });
    }

    public function topup(int $id): ResponseInterface
    {
        return $this->mutateBalance($id, function (array $body, array $row) {
            $amount = $this->parseAmount($body['amount'] ?? 0);
            if ($amount === null || $this->bccompZero($amount) <= 0) {
                return ['error' => 'A positive amount is required.', 'code' => 422];
            }
            $provider = strtolower(trim((string)($body['provider'] ?? '')));
            if (!in_array($provider, self::ALLOWED_TOPUP_PROVIDERS, true)) {
                return ['error' => 'Provider must be one of: ' . implode(', ', self::ALLOWED_TOPUP_PROVIDERS), 'code' => 422];
            }
            if (in_array($row['status'] ?? '', [self::STATUS_DISABLED], true)) {
                return ['error' => 'Gift card is disabled.', 'code' => 409];
            }
            // Mobile-money providers conventionally need a phone; cash/card/bank do not.
            $phone = trim((string)($body['phone'] ?? ''));
            if (in_array($provider, ['mpesa', 'airtel', 'mtn_momo'], true) && $phone === '') {
                return ['error' => 'Phone is required for ' . $provider . ' top-up.', 'code' => 422];
            }
            $reference = isset($body['reference']) ? mb_substr((string)$body['reference'], 0, 64) : null;
            $current = (string)$row['value'];
            $newBalance = bcadd($current, $amount, self::SCALE);
            // Re-activate if previously used
            $persistedStatus = $row['status'] ?? self::STATUS_ACTIVE;
            $newStatus = $persistedStatus === self::STATUS_USED ? self::STATUS_ACTIVE : $persistedStatus;
            if ($newStatus === self::STATUS_DISABLED) {
                $newStatus = self::STATUS_ACTIVE;
            }
            return [
                'action' => self::ACTION_TOPPED_UP,
                'amount' => $amount,
                'new_balance' => $newBalance,
                'new_status' => $newStatus,
                'provider' => $provider,
                'reference' => $reference,
                'transaction_id' => $this->mockTransactionId(strtoupper($provider)),
                // In real life this would start 'pending' and be flipped by the
                // MNO callback. The mock writes 'completed' so the UI sees the
                // balance instantly, but the response keeps the async shape.
                'txn_status' => 'completed',
                'comment' => 'Top-up via ' . $provider . ($phone !== '' ? ' (***' . substr($phone, -4) . ')' : ''),
            ];
        }, /* asyncResponse */ true);
    }

    public function resendEmail(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->migrationApplied()) {
            return $this->respondError('Gift card migration is required.', 503);
        }
        $row = $this->fetchGiftcard($id);
        if ($row === null) {
            return $this->respondError('Gift card not found.', 404);
        }
        $email = trim((string)($row['recipient_email'] ?? ''));
        if ($email === '') {
            return $this->respondError('No recipient email on this gift card.', 422);
        }

        try {
            $this->db->transStart();
            $this->db->table('giftcards')->where('giftcard_id', $id)->update([
                'email_status' => 'mocked',
                'email_sent_at' => date('Y-m-d H:i:s'),
            ]);
            $this->writeHistory($id, [
                'action' => self::ACTION_EMAILED,
                'amount' => '0.00',
                'balance_before' => (string)$row['value'],
                'balance_after' => (string)$row['value'],
                'comment' => 'Delivery email re-sent (mock) to ' . $email,
            ]);
            $this->db->transComplete();
            return $this->respondSuccess(['email' => $email], 'Email queued (mock).');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::resendEmail — ' . $e->getMessage());
            return $this->respondError('Failed to queue email.', 500);
        }
    }

    /**
     * Shared body for redeem/refund/adjust/topup. The $compute callback returns
     * either { error, code } to abort, or { action, amount, new_balance,
     * new_status, provider?, reference?, transaction_id?, txn_status?,
     * order_id?, comment? } to commit.
     *
     * Uses transStart + SELECT ... FOR UPDATE so concurrent mutations are
     * serialized at the DB layer.
     */
    private function mutateBalance(int $id, callable $compute, bool $asyncResponse = false): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->migrationApplied()) {
            return $this->respondError('Gift card migration is required.', 503);
        }
        $body = $this->request->getJSON(true) ?? [];

        try {
            $this->db->transStart();

            $giftcardsTable = $this->db->prefixTable('giftcards');
            // Row-level lock for the duration of the transaction.
            $row = $this->db->query(
                "SELECT * FROM {$giftcardsTable} WHERE giftcard_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($row === null) {
                $this->db->transComplete();
                return $this->respondError('Gift card not found.', 404);
            }

            // Pending-transfer freeze: refuse mutations while a transfer is
            // awaiting acceptance so the sender can't grief the recipient.
            // The publicTransferAccept path mutates the card directly (not
            // via mutateBalance), so it isn't blocked by this guard.
            if ($this->hasPendingTransferUnderLock($id)) {
                $this->db->transComplete();
                return $this->respondError(
                    'This gift card has a pending transfer. Cancel the transfer before mutating the balance.',
                    409,
                );
            }

            // In-flight payment intent freeze. createIntent() bypasses this
            // helper (it locks the row and calls applyBalanceChangeLocked
            // directly) so it never deadlocks with its own intent.
            if ($this->hasInFlightIntentUnderLock($id)) {
                $this->db->transComplete();
                return $this->respondError(
                    'A payment is currently being authorised on this card. Cancel or complete it first.',
                    409,
                );
            }

            $result = $compute($body, $row);
            if (isset($result['error'])) {
                $this->db->transComplete();
                return $this->respondError($result['error'], (int)($result['code'] ?? 422));
            }

            $balanceBefore = (string)$row['value'];
            $newBalance = (string)$result['new_balance'];
            $newStatus = (string)$result['new_status'];

            $this->db->table('giftcards')->where('giftcard_id', $id)->update([
                'value' => $newBalance,
                'status' => $newStatus,
            ]);

            $this->writeHistory($id, [
                'action' => (string)$result['action'],
                'amount' => (string)$result['amount'],
                'balance_before' => $balanceBefore,
                'balance_after' => $newBalance,
                'provider' => $result['provider'] ?? null,
                'reference' => $result['reference'] ?? null,
                'transaction_id' => $result['transaction_id'] ?? null,
                'txn_status' => $result['txn_status'] ?? 'completed',
                'order_id' => $result['order_id'] ?? null,
                'user_id' => $this->currentUserId(),
                'comment' => $result['comment'] ?? null,
            ]);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Transaction failed.', 500);
            }

            $fresh = $this->fetchGiftcard($id);
            $payload = [
                'giftcard' => $fresh ? $this->decorate($fresh) : null,
                'history' => $this->fetchHistory($id, false),
            ];
            // Async-shaped response for topup so real MNO integration won't break the contract.
            if ($asyncResponse) {
                $payload['transaction'] = [
                    'transaction_id' => $result['transaction_id'] ?? null,
                    'status' => $result['txn_status'] ?? 'completed',
                    'provider' => $result['provider'] ?? null,
                ];
            }
            return $this->respondSuccess($payload, ucfirst((string)$result['action']) . '.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::mutateBalance — ' . $e->getMessage());
            return $this->respondError('Failed to mutate balance.', 500);
        }
    }

    // ---------- PUBLIC balance lookup (rate-limited, sanitized) ----------

    /**
     * Public balance lookup. Mounted at /api/public/giftcards/balance/:code.
     *
     * Security stance:
     *   - Per-IP rate limit (60 lookups / minute) so an attacker can't quickly
     *     enumerate codes.
     *   - Identical response shape for valid / not-found / expired / disabled
     *     so the response itself can't be used as an enumeration oracle.
     *     `valid` is true ONLY for active, in-date, positive-balance cards.
     *   - Only masked code returned (last 4); no recipient/sender PII;
     *     audit history is the sanitized projection (action + amount + when only).
     *   - All lookups logged for fraud analysis.
     */
    public function publicBalance(string $code): ResponseInterface
    {
        // Rate limit before we touch the DB
        $rateOk = $this->checkRateLimit($code);
        if (!$rateOk) {
            return $this->respondError('Too many lookups. Try again in a minute.', 429);
        }

        $normalized = strtoupper(trim($code));
        if (!preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            $this->logPublicLookup($code, 'invalid_format');
            return $this->emptyPublicResponse();
        }

        try {
            if (!$this->db->tableExists('giftcards')) {
                $this->logPublicLookup($normalized, 'not_available');
                return $this->emptyPublicResponse();
            }
            $row = $this->db->table('giftcards')
                ->where('giftcard_number', $normalized)
                ->where('deleted', 0)
                ->get()
                ->getRowArray();
            if ($row === null) {
                $this->logPublicLookup($normalized, 'not_found');
                return $this->emptyPublicResponse();
            }
            $status = $this->computeStatus($row);
            $isValid = $status === self::STATUS_ACTIVE && $this->bccompZero((string)$row['value']) > 0;

            $this->logPublicLookup($normalized, $isValid ? 'valid' : 'invalid');

            $history = $this->migrationApplied() ? $this->fetchHistory((int)$row['giftcard_id'], true) : [];

            return $this->respondSuccess([
                'masked_code' => $this->maskCode($normalized),
                'balance' => (float)$row['value'],
                'currency' => (string)($row['currency'] ?? 'KES'),
                'status' => $isValid ? 'active' : 'inactive',
                'valid' => $isValid,
                'expires_at' => $row['expires_at'] ?? null,
                'history' => $history,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::publicBalance — ' . $e->getMessage());
            return $this->emptyPublicResponse();
        }
    }

    private function emptyPublicResponse(): ResponseInterface
    {
        return $this->respondSuccess([
            'masked_code' => null,
            'balance' => 0.0,
            'currency' => 'KES',
            'status' => 'inactive',
            'valid' => false,
            'expires_at' => null,
            'history' => [],
        ]);
    }

    // ---------- helpers ----------

    /**
     * Returns true if the lookup is allowed. Backed by a tiny in-DB sliding
     * window (60s) so it survives process restart, isolated per IP.
     */
    private function checkRateLimit(string $code): bool
    {
        try {
            $ip = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key = 'gc_lookup_' . hash('sha256', $ip);
            $hits = (int)($cache->get($key) ?? 0);
            if ($hits >= 60) {
                return false;
            }
            $cache->save($key, $hits + 1, 60);
            return true;
        } catch (Throwable $e) {
            // Fail-open on cache backend errors (won't block legitimate users)
            log_message('warning', 'GiftcardsController::checkRateLimit cache miss — ' . $e->getMessage());
            return true;
        }
    }

    private function logPublicLookup(string $code, string $outcome): void
    {
        $ip = $this->request->getIPAddress() ?: 'unknown';
        log_message(
            'info',
            'gc.lookup ip=' . hash('sha256', $ip) . ' code=' . hash('sha256', $code) . ' outcome=' . $outcome,
        );
    }

    private function migrationApplied(): bool
    {
        return $this->db->tableExists('giftcards')
            && $this->hasField('giftcards', 'status')
            && $this->hasField('giftcards', 'initial_value')
            && $this->db->tableExists('giftcard_history');
    }

    /**
     * True when the WeChat-parity migration (designs, denominations,
     * transfers, scheduled delivery) has been applied.
     */
    private function modernizationApplied(): bool
    {
        return $this->migrationApplied()
            && $this->db->tableExists('giftcard_designs')
            && $this->db->tableExists('giftcard_denominations')
            && $this->db->tableExists('giftcard_transfers')
            && $this->hasField('giftcards', 'design_id')
            && $this->hasField('giftcards', 'delivery_status');
    }

    /**
     * True when the Phase 6 migration (bindings, payment intents, wallets,
     * OTPs) has been applied. Endpoints in the bind/intent/self-service
     * surface gate on this and return 503 when not migrated.
     */
    private function bindingsApplied(): bool
    {
        return $this->modernizationApplied()
            && $this->db->tableExists('giftcard_bindings')
            && $this->db->tableExists('giftcard_payment_intents')
            && $this->db->tableExists('pesaswap_wallets')
            && $this->db->tableExists('giftcard_otps');
    }

    private function buildGiftcardSelect(): array
    {
        $cols = [
            'giftcards.giftcard_id',
            'giftcards.giftcard_number',
            'giftcards.value',
            'giftcards.deleted',
            'giftcards.record_time',
        ];
        foreach (['initial_value', 'status', 'recipient_name', 'recipient_email', 'sender_name', 'sender_email', 'message', 'currency', 'expires_at', 'email_status', 'email_sent_at', 'updated_at', 'design_id', 'denomination_amount_snapshot', 'denomination_label_snapshot', 'deliver_at', 'delivered_at', 'delivery_status'] as $field) {
            if ($this->hasField('giftcards', $field)) {
                $cols[] = "giftcards.{$field}";
            }
        }
        if ($this->hasField('giftcards', 'person_id')) {
            $cols[] = 'giftcards.person_id';
        }
        return $cols;
    }

    private function orderByCreated(): string
    {
        return $this->hasField('giftcards', 'updated_at') ? 'giftcards.updated_at' : 'giftcards.record_time';
    }

    private function fetchGiftcard(int $id): ?array
    {
        if (!$this->db->tableExists('giftcards')) {
            return null;
        }
        $row = $this->db->table('giftcards')
            ->where('giftcard_id', $id)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();
        return $row ?: null;
    }

    /**
     * Decorate a giftcard row for API output: numeric coercion, computed
     * status/remaining_pct/days_to_expiry/is_expired fields, plus the
     * WeChat-parity additions (design, delivery state, denomination
     * snapshot, pending-transfer summary). NEVER call this inside the
     * public payload (publicBalance has its own sanitiser).
     */
    private function decorate(array $row): array
    {
        $value = (float)$row['value'];
        $initial = (float)($row['initial_value'] ?? $value);
        $status = $this->computeStatus($row);
        $expiresAt = $row['expires_at'] ?? null;
        $daysToExpiry = null;
        if ($expiresAt) {
            $diff = strtotime($expiresAt) - time();
            $daysToExpiry = (int)floor($diff / 86400);
        }
        $row['giftcard_id'] = (int)$row['giftcard_id'];
        $row['value'] = $value;
        $row['initial_value'] = $initial;
        $row['status'] = $status;
        $row['is_expired'] = $status === self::STATUS_EXPIRED;
        $row['remaining_pct'] = $initial > 0 ? round(($value / $initial) * 100, 1) : 0;
        $row['days_to_expiry'] = $daysToExpiry;
        $row['masked_code'] = $this->maskCode((string)$row['giftcard_number']);

        $row['design'] = $this->fetchDesignSummary(isset($row['design_id']) ? (int)$row['design_id'] : null);
        $row['delivery_status'] = (string)($row['delivery_status'] ?? self::DELIVERY_IMMEDIATE);
        $row['deliver_at'] = $row['deliver_at'] ?? null;
        $row['delivered_at'] = $row['delivered_at'] ?? null;
        $row['denomination'] = $this->extractDenominationSnapshot($row);
        $row['pending_transfer'] = $this->fetchPendingTransferSummary((int)$row['giftcard_id']);

        return $row;
    }

    private function computeStatus(array $row): string
    {
        $persisted = $row['status'] ?? self::STATUS_ACTIVE;
        if ($persisted === self::STATUS_DISABLED) return self::STATUS_DISABLED;
        if (!empty($row['expires_at']) && strtotime($row['expires_at']) < time()) {
            return self::STATUS_EXPIRED;
        }
        if ($this->bccompZero((string)$row['value']) <= 0) return self::STATUS_USED;
        return self::STATUS_ACTIVE;
    }

    /**
     * @param int $id
     * @param bool $public  true to return sanitized projection (no PII/IDs)
     */
    private function fetchHistory(int $id, bool $public): array
    {
        if (!$this->db->tableExists('giftcard_history')) {
            return [];
        }
        $rows = $this->db->table('giftcard_history')
            ->where('giftcard_id', $id)
            ->orderBy('created_at', 'DESC')
            ->orderBy('history_id', 'DESC')
            ->limit(50)
            ->get()
            ->getResultArray();
        if ($public) {
            return array_map(static fn(array $r) => [
                'action' => $r['action'],
                'amount' => (float)$r['amount'],
                'created_at' => $r['created_at'],
            ], $rows);
        }
        return array_map(static fn(array $r) => [
            'history_id' => (int)$r['history_id'],
            'action' => $r['action'],
            'amount' => (float)$r['amount'],
            'balance_before' => (float)$r['balance_before'],
            'balance_after' => (float)$r['balance_after'],
            'provider' => $r['provider'],
            'reference' => $r['reference'],
            'transaction_id' => $r['transaction_id'],
            'txn_status' => $r['txn_status'],
            'order_id' => $r['order_id'] === null ? null : (int)$r['order_id'],
            'user_id' => $r['user_id'] === null ? null : (int)$r['user_id'],
            'comment' => $r['comment'],
            'created_at' => $r['created_at'],
        ], $rows);
    }

    private function writeHistory(int $giftcardId, array $entry): void
    {
        if (!$this->db->tableExists('giftcard_history')) {
            return;
        }
        $row = array_merge([
            'giftcard_id' => $giftcardId,
            'action' => self::ACTION_CREATED,
            'amount' => '0.00',
            'balance_before' => '0.00',
            'balance_after' => '0.00',
            'provider' => null,
            'reference' => null,
            'transaction_id' => null,
            'txn_status' => 'completed',
            'order_id' => null,
            'user_id' => $this->currentUserId(),
            'comment' => null,
        ], $entry);
        $this->db->table('giftcard_history')->insert($row);
    }

    private function currentUserId(): ?int
    {
        $user = $this->session->get('person_id');
        return $user ? (int)$user : null;
    }

    /**
     * Generate a unique code of the form GC-XXXX-XXXX-XXXX where X is [A-Z0-9].
     * Retries up to MAX_CODE_RETRIES on duplicate-key collision (extremely unlikely).
     */
    private function generateUniqueCode(): ?string
    {
        for ($i = 0; $i < self::MAX_CODE_RETRIES; $i++) {
            $code = $this->generateCandidateCode();
            $exists = $this->db->table('giftcards')
                ->where('giftcard_number', $code)
                ->countAllResults();
            if ($exists === 0) {
                return $code;
            }
        }
        return null;
    }

    private function generateCandidateCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // crockford-ish: no 0/O/1/I
        $parts = [];
        for ($g = 0; $g < 3; $g++) {
            $chunk = '';
            for ($c = 0; $c < 4; $c++) {
                $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $parts[] = $chunk;
        }
        return 'GC-' . implode('-', $parts);
    }

    private function mockTransactionId(string $prefix): string
    {
        return $prefix . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(3));
    }

    private function maskCode(string $code): string
    {
        $len = strlen($code);
        if ($len <= 4) return $code;
        return str_repeat('•', max(0, $len - 4)) . substr($code, -4);
    }

    /**
     * Parse a money string ("123.45" or "123,45") into a normalized "###.##"
     * suitable for DECIMAL(15,2). Returns null on invalid input.
     * Crucially does NOT round-trip through PHP float for the source value.
     */
    private function parseAmount(mixed $raw): ?string
    {
        if ($raw === null || $raw === '') return null;
        $s = is_string($raw) ? trim($raw) : (string)$raw;
        $s = str_replace([' ', ','], ['', '.'], $s);
        if (!preg_match('/^-?\d+(\.\d{1,2})?$/', $s)) {
            return null;
        }
        // bcmath canonicalisation
        return bcadd($s, '0', self::SCALE);
    }

    private function bccompZero(string $amount): int
    {
        return bccomp($amount, '0', self::SCALE);
    }

    /**
     * Accepts either an ISO datetime in `expires_at` or a positive integer
     * `expires_in_days`. Returns 'Y-m-d H:i:s' or null.
     */
    private function parseExpiry(mixed $iso, mixed $days): ?string
    {
        if ($iso !== null && $iso !== '') {
            $t = strtotime((string)$iso);
            if ($t === false || $t < time()) return null;
            return date('Y-m-d H:i:s', $t);
        }
        if ($days !== null && $days !== '') {
            $d = (int)$days;
            if ($d <= 0 || $d > 365 * 10) return null;
            return date('Y-m-d H:i:s', time() + $d * 86400);
        }
        return null;
    }

    private function hasField(string $table, string $field): bool
    {
        return $this->db->tableExists($table) && in_array($field, $this->db->getFieldNames($table), true);
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }

    private function emptyPagination(array $p, string $search): array
    {
        return [
            'limit' => $p['limit'],
            'offset' => $p['offset'],
            'total' => 0,
            'search' => $search,
        ];
    }

    private function emptyStats(): array
    {
        return [
            'total_outstanding' => 0,
            'active_count' => 0,
            'expiring_soon_count' => 0,
            'used_count' => 0,
        ];
    }

    /**
     * Operator dashboard stats — total liability, counts by status.
     */
    private function loadStats(): array
    {
        if (!$this->migrationApplied()) {
            return $this->emptyStats();
        }
        try {
            $g = $this->db->prefixTable('giftcards');
            $total = (float)($this->db->query(
                "SELECT COALESCE(SUM(value),0) AS s FROM {$g} WHERE deleted = 0 AND status != 'disabled'"
            )->getRowArray()['s'] ?? 0);
            $active = (int)($this->db->query(
                "SELECT COUNT(*) AS c FROM {$g} WHERE deleted = 0 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())"
            )->getRowArray()['c'] ?? 0);
            $used = (int)($this->db->query(
                "SELECT COUNT(*) AS c FROM {$g} WHERE deleted = 0 AND status = 'used'"
            )->getRowArray()['c'] ?? 0);
            $expSoon = (int)($this->db->query(
                "SELECT COUNT(*) AS c FROM {$g} WHERE deleted = 0 AND status = 'active' AND expires_at IS NOT NULL AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)"
            )->getRowArray()['c'] ?? 0);
            return [
                'total_outstanding' => round($total, 2),
                'active_count' => $active,
                'expiring_soon_count' => $expSoon,
                'used_count' => $used,
            ];
        } catch (Throwable $e) {
            log_message('warning', 'GiftcardsController::loadStats — ' . $e->getMessage());
            return $this->emptyStats();
        }
    }

    // ============================================================
    // Design templates (skins) — admin-only CRUD
    // ============================================================

    public function designIndex(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondSuccess(['designs' => []]);
        }
        $rows = $this->db->table('giftcard_designs')
            ->where('deleted', 0)
            ->orderBy('sort_order', 'ASC')
            ->orderBy('design_id', 'ASC')
            ->get()
            ->getResultArray();
        return $this->respondSuccess(['designs' => array_map([$this, 'decorateDesign'], $rows)]);
    }

    public function designShow(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $row = $this->db->table('giftcard_designs')->where('design_id', $id)->where('deleted', 0)->get()->getRowArray();
        if ($row === null) return $this->respondError('Design not found.', 404);
        return $this->respondSuccess(['design' => $this->decorateDesign($row)]);
    }

    public function designCreate(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $body = $this->request->getJSON(true) ?? [];
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 64) {
            return $this->respondError('Design name is required (1-64 chars).', 422);
        }
        try {
            $this->db->table('giftcard_designs')->insert([
                'name' => $name,
                'background_from' => $this->validateHexColor($body['background_from'] ?? null, '#3B82F6'),
                'background_to' => $this->validateHexColor($body['background_to'] ?? null, '#8B5CF6'),
                'accent_color' => $this->validateHexColor($body['accent_color'] ?? null, '#FFFFFF'),
                'text_color' => $this->validateHexColor($body['text_color'] ?? null, '#FFFFFF'),
                'image_url' => $this->sanitizeImageUrl($body['image_url'] ?? null),
                'icon' => $this->validateIcon($body['icon'] ?? null),
                'active' => !empty($body['active']) ? 1 : (isset($body['active']) ? 0 : 1),
                'sort_order' => (int)($body['sort_order'] ?? 0),
                'deleted' => 0,
            ]);
            $newId = (int)$this->db->insertID();
            $row = $this->db->table('giftcard_designs')->where('design_id', $newId)->get()->getRowArray();
            return $this->respondSuccess(['design' => $this->decorateDesign($row ?? [])], 'Design created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::designCreate — ' . $e->getMessage());
            return $this->respondError('Failed to create design.', 500);
        }
    }

    public function designUpdate(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $existing = $this->db->table('giftcard_designs')->where('design_id', $id)->where('deleted', 0)->get()->getRowArray();
        if ($existing === null) return $this->respondError('Design not found.', 404);

        $body = $this->request->getJSON(true) ?? [];
        $patch = [];
        if (isset($body['name'])) {
            $name = trim((string)$body['name']);
            if ($name === '' || mb_strlen($name) > 64) {
                return $this->respondError('Design name must be 1-64 chars.', 422);
            }
            $patch['name'] = $name;
        }
        foreach (['background_from', 'background_to', 'accent_color', 'text_color'] as $field) {
            if (array_key_exists($field, $body)) {
                $patch[$field] = $this->validateHexColor($body[$field], (string)$existing[$field]);
            }
        }
        if (array_key_exists('image_url', $body)) $patch['image_url'] = $this->sanitizeImageUrl($body['image_url']);
        if (array_key_exists('icon', $body)) $patch['icon'] = $this->validateIcon($body['icon']);
        if (array_key_exists('active', $body)) $patch['active'] = $body['active'] ? 1 : 0;
        if (array_key_exists('sort_order', $body)) $patch['sort_order'] = (int)$body['sort_order'];
        if ($patch === []) return $this->respondError('No updatable fields provided.', 422);

        try {
            $this->db->table('giftcard_designs')->where('design_id', $id)->update($patch);
            $row = $this->db->table('giftcard_designs')->where('design_id', $id)->get()->getRowArray();
            return $this->respondSuccess(['design' => $this->decorateDesign($row ?? [])], 'Design updated.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::designUpdate — ' . $e->getMessage());
            return $this->respondError('Failed to update design.', 500);
        }
    }

    public function designDelete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $existing = $this->db->table('giftcard_designs')->where('design_id', $id)->where('deleted', 0)->get()->getRowArray();
        if ($existing === null) return $this->respondError('Design not found.', 404);
        try {
            $this->db->table('giftcard_designs')->where('design_id', $id)->update(['deleted' => 1, 'active' => 0]);
            return $this->respondSuccess(['design_id' => $id], 'Design removed.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::designDelete — ' . $e->getMessage());
            return $this->respondError('Failed to remove design.', 500);
        }
    }

    // ============================================================
    // Preset denominations — admin-only CRUD
    // ============================================================

    public function denominationIndex(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondSuccess(['denominations' => []]);
        }
        $currency = strtoupper(trim((string)($this->request->getGet('currency') ?? '')));
        $builder = $this->db->table('giftcard_denominations')->where('deleted', 0);
        if ($currency !== '') $builder->where('currency', $currency);
        $rows = $builder->orderBy('currency', 'ASC')->orderBy('sort_order', 'ASC')->orderBy('amount', 'ASC')->get()->getResultArray();
        return $this->respondSuccess(['denominations' => array_map([$this, 'decorateDenomination'], $rows)]);
    }

    public function denominationCreate(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $body = $this->request->getJSON(true) ?? [];
        $currency = strtoupper(trim((string)($body['currency'] ?? 'KES'))) ?: 'KES';
        $amount = $this->parseAmount($body['amount'] ?? null);
        if ($amount === null || $this->bccompZero($amount) <= 0) {
            return $this->respondError('Amount must be a positive number.', 422);
        }
        $label = trim((string)($body['label'] ?? ''));
        if ($label === '') $label = $currency . ' ' . number_format((float)$amount, 0);

        $dup = $this->db->table('giftcard_denominations')
            ->where('currency', $currency)
            ->where('amount', $amount)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();
        if ($dup !== null) {
            return $this->respondError('A denomination for that currency/amount already exists.', 409);
        }

        try {
            $this->db->table('giftcard_denominations')->insert([
                'currency' => $currency,
                'amount' => $amount,
                'label' => mb_substr($label, 0, 64),
                'description' => isset($body['description']) ? mb_substr((string)$body['description'], 0, 255) : null,
                'active' => !empty($body['active']) ? 1 : (isset($body['active']) ? 0 : 1),
                'sort_order' => (int)($body['sort_order'] ?? 0),
                'deleted' => 0,
            ]);
            $newId = (int)$this->db->insertID();
            $row = $this->db->table('giftcard_denominations')->where('denomination_id', $newId)->get()->getRowArray();
            return $this->respondSuccess(['denomination' => $this->decorateDenomination($row ?? [])], 'Denomination created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::denominationCreate — ' . $e->getMessage());
            return $this->respondError('Failed to create denomination.', 500);
        }
    }

    public function denominationUpdate(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $existing = $this->db->table('giftcard_denominations')->where('denomination_id', $id)->where('deleted', 0)->get()->getRowArray();
        if ($existing === null) return $this->respondError('Denomination not found.', 404);

        $body = $this->request->getJSON(true) ?? [];
        $patch = [];
        if (isset($body['currency'])) $patch['currency'] = strtoupper(trim((string)$body['currency'])) ?: $existing['currency'];
        if (isset($body['amount'])) {
            $a = $this->parseAmount($body['amount']);
            if ($a === null || $this->bccompZero($a) <= 0) {
                return $this->respondError('Amount must be a positive number.', 422);
            }
            $patch['amount'] = $a;
        }
        if (isset($body['label'])) $patch['label'] = mb_substr((string)$body['label'], 0, 64);
        if (array_key_exists('description', $body)) $patch['description'] = $body['description'] === null ? null : mb_substr((string)$body['description'], 0, 255);
        if (array_key_exists('active', $body)) $patch['active'] = $body['active'] ? 1 : 0;
        if (array_key_exists('sort_order', $body)) $patch['sort_order'] = (int)$body['sort_order'];

        if ($patch === []) return $this->respondError('No updatable fields provided.', 422);

        try {
            $this->db->table('giftcard_denominations')->where('denomination_id', $id)->update($patch);
            $row = $this->db->table('giftcard_denominations')->where('denomination_id', $id)->get()->getRowArray();
            return $this->respondSuccess(['denomination' => $this->decorateDenomination($row ?? [])], 'Denomination updated.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::denominationUpdate — ' . $e->getMessage());
            return $this->respondError('Failed to update denomination.', 500);
        }
    }

    public function denominationDelete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        $existing = $this->db->table('giftcard_denominations')->where('denomination_id', $id)->where('deleted', 0)->get()->getRowArray();
        if ($existing === null) return $this->respondError('Denomination not found.', 404);
        try {
            $this->db->table('giftcard_denominations')->where('denomination_id', $id)->update(['deleted' => 1, 'active' => 0]);
            return $this->respondSuccess(['denomination_id' => $id], 'Denomination removed.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::denominationDelete — ' . $e->getMessage());
            return $this->respondError('Failed to remove denomination.', 500);
        }
    }

    // ============================================================
    // Send-as-gift transfer flow — operator-initiated, customer-accepted
    //
    // On accept the giftcard_number is ROTATED so the sender's old code
    // stops working. This is the only way to make ownership transfer real
    // on a bearer instrument that the legacy POS redeems by code alone.
    // ============================================================

    public function transferRequest(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $toName = trim((string)($body['to_recipient_name'] ?? ''));
        $toEmail = trim((string)($body['to_recipient_email'] ?? ''));
        $toPhone = trim((string)($body['to_recipient_phone'] ?? ''));
        $message = trim((string)($body['message'] ?? ''));
        $channel = strtolower(trim((string)($body['channel'] ?? 'link')));
        if (!in_array($channel, ['link', 'email', 'sms'], true)) $channel = 'link';
        if ($toEmail !== '' && !filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('Recipient email is not a valid email address.', 422);
        }
        if ($channel === 'email' && $toEmail === '') {
            return $this->respondError('Email channel requires to_recipient_email.', 422);
        }
        if ($channel === 'sms' && $toPhone === '') {
            return $this->respondError('SMS channel requires to_recipient_phone.', 422);
        }

        $idempotencyKey = mb_substr((string)($body['idempotency_key'] ?? bin2hex(random_bytes(8))), 0, 64);

        try {
            $this->db->transStart();
            $giftcardsTable = $this->db->prefixTable('giftcards');
            $card = $this->db->query(
                "SELECT * FROM {$giftcardsTable} WHERE giftcard_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($card === null) {
                $this->db->transComplete();
                return $this->respondError('Gift card not found.', 404);
            }
            if ($this->computeStatus($card) !== self::STATUS_ACTIVE) {
                $this->db->transComplete();
                return $this->respondError('Only active gift cards can be transferred.', 409);
            }

            $prior = $this->db->table('giftcard_transfers')
                ->where('giftcard_id', $id)
                ->where('client_idempotency_key', $idempotencyKey)
                ->get()
                ->getRowArray();
            if ($prior !== null) {
                $this->db->transComplete();
                return $this->respondSuccess([
                    'transfer' => $this->decorateTransfer($prior),
                    'verification_token' => null,
                    'message' => 'Existing transfer returned (idempotent).',
                ]);
            }

            if ($this->hasPendingTransferUnderLock($id)) {
                $this->db->transComplete();
                return $this->respondError('A transfer is already pending for this gift card.', 409);
            }

            $token = bin2hex(random_bytes(16));  // 128-bit URL token
            $tokenHash = hash('sha256', $token);
            $ttlHours = max(1, self::TRANSFER_TOKEN_TTL_HOURS);
            $expires = date('Y-m-d H:i:s', time() + $ttlHours * 3600);

            $this->db->table('giftcard_transfers')->insert([
                'giftcard_id' => $id,
                'initiated_by_employee_id' => $this->currentUserId(),
                'channel' => $channel,
                'to_recipient_name' => $toName !== '' ? mb_substr($toName, 0, 255) : null,
                'to_recipient_email' => $toEmail !== '' ? $toEmail : null,
                'to_recipient_phone' => $toPhone !== '' ? mb_substr($toPhone, 0, 64) : null,
                'message' => $message !== '' ? $message : null,
                'verification_token_hash' => $tokenHash,
                'verification_expires_at' => $expires,
                'balance_at_request' => (string)$card['value'],
                'old_code_masked' => $this->maskCode((string)$card['giftcard_number']),
                'ip' => $this->request->getIPAddress() ?: null,
                'user_agent' => mb_substr((string)$this->request->getUserAgent(), 0, 255),
                'client_idempotency_key' => $idempotencyKey,
            ]);
            $transferId = (int)$this->db->insertID();

            $this->writeHistory($id, [
                'action' => self::ACTION_TRANSFER_REQUESTED,
                'amount' => '0.00',
                'balance_before' => (string)$card['value'],
                'balance_after' => (string)$card['value'],
                'comment' => 'Transfer requested (#' . $transferId . ', expires ' . $expires . ')',
            ]);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create transfer.', 500);
            }

            $fresh = $this->db->table('giftcard_transfers')->where('transfer_id', $transferId)->get()->getRowArray();
            return $this->respondSuccess([
                'transfer' => $this->decorateTransfer($fresh ?? []),
                'verification_token' => $token,  // returned ONCE — never stored, never re-derivable
                'accept_url' => '/giftcard/transfer/' . $token,
                'expires_at' => $expires,
            ], 'Transfer requested.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::transferRequest — ' . $e->getMessage());
            return $this->respondError('Failed to create transfer.', 500);
        }
    }

    public function transferList(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondSuccess(['transfers' => []]);
        }
        if ($this->fetchGiftcard($id) === null) return $this->respondError('Gift card not found.', 404);
        $rows = $this->db->table('giftcard_transfers')
            ->where('giftcard_id', $id)
            ->orderBy('created_at', 'DESC')
            ->orderBy('transfer_id', 'DESC')
            ->limit(50)
            ->get()
            ->getResultArray();
        return $this->respondSuccess(['transfers' => array_map([$this, 'decorateTransfer'], $rows)]);
    }

    public function transferCancel(int $id, int $transferId): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Gift card modernization migration is required.', 503);
        }
        if ($this->fetchGiftcard($id) === null) return $this->respondError('Gift card not found.', 404);
        $row = $this->db->table('giftcard_transfers')->where('transfer_id', $transferId)->where('giftcard_id', $id)->get()->getRowArray();
        if ($row === null) return $this->respondError('Transfer not found.', 404);
        if (!empty($row['accepted_at'])) return $this->respondError('Transfer already accepted.', 409);
        if (!empty($row['cancelled_at'])) return $this->respondError('Transfer already cancelled.', 409);

        try {
            $this->db->table('giftcard_transfers')->where('transfer_id', $transferId)->update([
                'cancelled_at' => date('Y-m-d H:i:s'),
                'cancelled_reason' => 'cancelled_by_operator',
            ]);
            $this->writeHistory($id, [
                'action' => self::ACTION_TRANSFER_CANCELLED,
                'amount' => '0.00',
                'balance_before' => '0.00',
                'balance_after' => '0.00',
                'comment' => 'Transfer #' . $transferId . ' cancelled by operator',
            ]);
            $fresh = $this->db->table('giftcard_transfers')->where('transfer_id', $transferId)->get()->getRowArray();
            return $this->respondSuccess(['transfer' => $this->decorateTransfer($fresh ?? [])], 'Transfer cancelled.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::transferCancel — ' . $e->getMessage());
            return $this->respondError('Failed to cancel transfer.', 500);
        }
    }

    /**
     * Public preview of a pending transfer. Returns sanitized fields only.
     * NEVER returns balance or full card details.
     */
    public function publicTransferLookup(string $token): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_xfer_lookup', self::TRANSFER_LOOKUP_RATE)) {
            return $this->respondError('Too many lookups. Try again in a minute.', 429);
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Transfer not found.', 404);
        }
        $hash = hash('sha256', trim($token));
        $transfer = $this->db->table('giftcard_transfers')->where('verification_token_hash', $hash)->get()->getRowArray();
        if ($transfer === null) return $this->respondError('Transfer not found.', 404);

        $state = $this->transferState($transfer);
        if ($state !== 'pending') {
            return $this->respondSuccess([
                'state' => $state,
                'preview' => null,
                'message' => 'This transfer link is ' . $state . '.',
            ]);
        }

        $card = $this->fetchGiftcard((int)$transfer['giftcard_id']);
        if ($card === null) return $this->respondError('Gift card not found.', 404);

        return $this->respondSuccess([
            'state' => 'pending',
            'preview' => [
                'masked_old_code' => $this->maskCode((string)$card['giftcard_number']),
                'currency' => (string)($card['currency'] ?? 'KES'),
                'sender_name' => $card['sender_name'] ?? null,
                'message' => $transfer['message'] ?? $card['message'] ?? null,
                'to_recipient_name' => $transfer['to_recipient_name'] ?? null,
                'design' => $this->fetchDesignSummary(isset($card['design_id']) ? (int)$card['design_id'] : null),
                'expires_at' => $transfer['verification_expires_at'] ?? null,
            ],
        ]);
    }

    /**
     * Recipient accepts a pending transfer. Performs the ownership transfer
     * under a single tx: locks the transfer row + giftcard row, validates
     * state, ROTATES the giftcard_number so the sender's old code stops
     * working, updates recipient/sender metadata, writes two audit history
     * rows. Returns the NEW code in the response — recipient should save it.
     */
    public function publicTransferAccept(string $token): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_xfer_accept', self::TRANSFER_ACCEPT_RATE)) {
            return $this->respondError('Too many attempts. Try again in a minute.', 429);
        }
        if (!$this->modernizationApplied()) {
            return $this->respondError('Transfer not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $acceptName = trim((string)($body['recipient_name'] ?? ''));
        $acceptEmail = trim((string)($body['recipient_email'] ?? ''));
        $acceptPhone = trim((string)($body['recipient_phone'] ?? ''));
        if ($acceptEmail !== '' && !filter_var($acceptEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('recipient_email is not a valid email address.', 422);
        }
        if ($acceptName === '' && $acceptEmail === '' && $acceptPhone === '') {
            return $this->respondError('Provide at least a name, email or phone to accept the gift.', 422);
        }

        $hash = hash('sha256', trim($token));

        try {
            $this->db->transStart();
            $transfersTable = $this->db->prefixTable('giftcard_transfers');
            $giftcardsTable = $this->db->prefixTable('giftcards');

            $transfer = $this->db->query(
                "SELECT * FROM {$transfersTable} WHERE verification_token_hash = ? LIMIT 1 FOR UPDATE",
                [$hash],
            )->getRowArray();
            if ($transfer === null) {
                $this->db->transComplete();
                return $this->respondError('Transfer not found.', 404);
            }
            $state = $this->transferState($transfer);
            if ($state !== 'pending') {
                $this->db->transComplete();
                return $this->respondError('This transfer is ' . $state . '.', 409);
            }

            $card = $this->db->query(
                "SELECT * FROM {$giftcardsTable} WHERE giftcard_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [(int)$transfer['giftcard_id']],
            )->getRowArray();
            if ($card === null) {
                $this->db->transComplete();
                return $this->respondError('Gift card not found.', 404);
            }
            if ($this->computeStatus($card) !== self::STATUS_ACTIVE) {
                $this->db->transComplete();
                return $this->respondError('This gift card is no longer active.', 409);
            }

            $newCode = $this->generateUniqueCode();
            if ($newCode === null) {
                $this->db->transComplete();
                return $this->respondError('Failed to rotate gift card code.', 500);
            }
            $oldCode = (string)$card['giftcard_number'];

            $this->db->table('giftcards')->where('giftcard_id', (int)$card['giftcard_id'])->update([
                'giftcard_number' => $newCode,
                'recipient_name' => $acceptName !== '' ? mb_substr($acceptName, 0, 255) : ($transfer['to_recipient_name'] ?? null),
                'recipient_email' => $acceptEmail !== '' ? $acceptEmail : ($transfer['to_recipient_email'] ?? null),
                'sender_name' => $card['recipient_name'] ?? $card['sender_name'] ?? null,
                'sender_email' => $card['recipient_email'] ?? $card['sender_email'] ?? null,
                'message' => $transfer['message'] ?? $card['message'] ?? null,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);

            $this->db->table('giftcard_transfers')->where('transfer_id', (int)$transfer['transfer_id'])->update([
                'accepted_at' => date('Y-m-d H:i:s'),
                'accepted_recipient_name' => $acceptName !== '' ? mb_substr($acceptName, 0, 255) : null,
                'accepted_recipient_email' => $acceptEmail !== '' ? $acceptEmail : null,
                'accepted_recipient_phone' => $acceptPhone !== '' ? mb_substr($acceptPhone, 0, 64) : null,
                'balance_at_accept' => (string)$card['value'],
                'new_code_masked' => $this->maskCode($newCode),
            ]);

            $balance = (string)$card['value'];
            $this->writeHistory((int)$card['giftcard_id'], [
                'action' => self::ACTION_TRANSFER_ACCEPTED_OUT,
                'amount' => '0.00',
                'balance_before' => $balance,
                'balance_after' => $balance,
                'comment' => 'Transfer #' . (int)$transfer['transfer_id'] . ' accepted — old code ' . $this->maskCode($oldCode) . ' invalidated',
            ]);
            $this->writeHistory((int)$card['giftcard_id'], [
                'action' => self::ACTION_TRANSFER_ACCEPTED_IN,
                'amount' => '0.00',
                'balance_before' => $balance,
                'balance_after' => $balance,
                'comment' => 'New code issued ' . $this->maskCode($newCode) . ' for accepted transfer #' . (int)$transfer['transfer_id'],
            ]);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to accept transfer.', 500);
            }

            return $this->respondSuccess([
                'state' => 'accepted',
                'new_code' => $newCode,
                'masked_new_code' => $this->maskCode($newCode),
                'balance' => (float)$card['value'],
                'currency' => (string)($card['currency'] ?? 'KES'),
            ], 'Gift accepted. Save your new code — it will not be shown again.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::publicTransferAccept — ' . $e->getMessage());
            return $this->respondError('Failed to accept transfer.', 500);
        }
    }

    // ============================================================
    // Scheduled-delivery dispatcher (invoked by spark CLI)
    // ============================================================

    /**
     * Claim up to $limit due scheduled-delivery cards atomically, then send
     * the mock email and flip each to 'sent' (or 'failed') with a
     * conditional UPDATE — ensures concurrent runs cannot double-send.
     */
    public function dispatchScheduled(int $limit = 100): array
    {
        $summary = ['claimed' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0];
        if (!$this->modernizationApplied()) {
            return $summary + ['error' => 'modernization-migration-required'];
        }
        $limit = max(1, min($limit, 1000));
        $giftcards = $this->db->prefixTable('giftcards');
        $now = date('Y-m-d H:i:s');

        try {
            // Atomic claim: flip pending+due rows to 'sending'.
            $this->db->query(
                "UPDATE {$giftcards} SET delivery_status = ? WHERE delivery_status = ? AND deliver_at <= ? AND deleted = 0 LIMIT {$limit}",
                [self::DELIVERY_SENDING, self::DELIVERY_PENDING, $now],
            );

            $claimed = $this->db->table('giftcards')
                ->where('delivery_status', self::DELIVERY_SENDING)
                ->where('deliver_at <=', $now)
                ->where('deleted', 0)
                ->orderBy('deliver_at', 'ASC')
                ->limit($limit)
                ->get()
                ->getResultArray();
            $summary['claimed'] = count($claimed);

            foreach ($claimed as $row) {
                $id = (int)$row['giftcard_id'];
                $email = trim((string)($row['recipient_email'] ?? ''));
                if ($email === '') {
                    $this->db->table('giftcards')->where('giftcard_id', $id)->update([
                        'delivery_status' => self::DELIVERY_FAILED,
                    ]);
                    $this->writeHistory($id, [
                        'action' => self::ACTION_DELIVERED,
                        'amount' => '0.00',
                        'balance_before' => (string)$row['value'],
                        'balance_after' => (string)$row['value'],
                        'comment' => 'Scheduled delivery skipped: no recipient_email',
                    ]);
                    $summary['skipped']++;
                    continue;
                }

                $sentAt = date('Y-m-d H:i:s');
                $this->db->table('giftcards')->where('giftcard_id', $id)->update([
                    'delivery_status' => self::DELIVERY_SENT,
                    'delivered_at' => $sentAt,
                    'email_status' => 'mocked',
                    'email_sent_at' => $sentAt,
                ]);
                $this->writeHistory($id, [
                    'action' => self::ACTION_DELIVERED,
                    'amount' => '0.00',
                    'balance_before' => (string)$row['value'],
                    'balance_after' => (string)$row['value'],
                    'comment' => 'Scheduled delivery sent (mock) to ' . $email,
                ]);
                $summary['sent']++;
            }
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::dispatchScheduled — ' . $e->getMessage());
            $summary['error'] = $e->getMessage();
        }

        return $summary;
    }

    // ============================================================
    // Modernization helpers
    // ============================================================

    private function decorateDesign(array $row): array
    {
        if ($row === []) return $row;
        $row['design_id'] = (int)$row['design_id'];
        $row['active'] = (bool)$row['active'];
        $row['sort_order'] = (int)($row['sort_order'] ?? 0);
        return $row;
    }

    private function decorateDenomination(array $row): array
    {
        if ($row === []) return $row;
        $row['denomination_id'] = (int)$row['denomination_id'];
        $row['amount'] = (float)$row['amount'];
        $row['active'] = (bool)$row['active'];
        $row['sort_order'] = (int)($row['sort_order'] ?? 0);
        return $row;
    }

    private function decorateTransfer(array $row): array
    {
        if ($row === []) return $row;
        $row['transfer_id'] = (int)$row['transfer_id'];
        $row['giftcard_id'] = (int)$row['giftcard_id'];
        $row['initiated_by_employee_id'] = $row['initiated_by_employee_id'] === null ? null : (int)$row['initiated_by_employee_id'];
        $row['balance_at_request'] = $row['balance_at_request'] === null ? null : (float)$row['balance_at_request'];
        $row['balance_at_accept'] = $row['balance_at_accept'] === null ? null : (float)$row['balance_at_accept'];
        unset($row['verification_token_hash']);
        $row['state'] = $this->transferState($row);
        return $row;
    }

    private function transferState(array $transfer): string
    {
        if (!empty($transfer['accepted_at'])) return 'accepted';
        if (!empty($transfer['cancelled_at'])) return 'cancelled';
        if (!empty($transfer['verification_expires_at']) && strtotime($transfer['verification_expires_at']) < time()) {
            return 'expired';
        }
        return 'pending';
    }

    private function fetchDesignSummary(?int $id): ?array
    {
        if ($id === null || $id <= 0) return null;
        if (!$this->db->tableExists('giftcard_designs')) return null;
        $row = $this->db->table('giftcard_designs')->where('design_id', $id)->where('deleted', 0)->get()->getRowArray();
        return $row ? $this->decorateDesign($row) : null;
    }

    private function extractDenominationSnapshot(array $row): ?array
    {
        if (empty($row['denomination_amount_snapshot'])) return null;
        return [
            'amount' => (float)$row['denomination_amount_snapshot'],
            'label' => $row['denomination_label_snapshot'] ?? null,
        ];
    }

    private function fetchPendingTransferSummary(int $giftcardId): ?array
    {
        if (!$this->db->tableExists('giftcard_transfers')) return null;
        $row = $this->db->table('giftcard_transfers')
            ->where('giftcard_id', $giftcardId)
            ->where('accepted_at IS NULL', null, false)
            ->where('cancelled_at IS NULL', null, false)
            ->where('verification_expires_at >', date('Y-m-d H:i:s'))
            ->orderBy('created_at', 'DESC')
            ->limit(1)
            ->get()
            ->getRowArray();
        if ($row === null) return null;
        return [
            'transfer_id' => (int)$row['transfer_id'],
            'channel' => (string)$row['channel'],
            'to_recipient_name' => $row['to_recipient_name'] ?? null,
            'to_recipient_email' => $row['to_recipient_email'] ?? null,
            'expires_at' => $row['verification_expires_at'] ?? null,
            'created_at' => $row['created_at'] ?? null,
        ];
    }

    /** Caller must already be in a transaction with the gift card row locked. */
    private function hasPendingTransferUnderLock(int $giftcardId): bool
    {
        if (!$this->db->tableExists('giftcard_transfers')) return false;
        $count = $this->db->table('giftcard_transfers')
            ->where('giftcard_id', $giftcardId)
            ->where('accepted_at IS NULL', null, false)
            ->where('cancelled_at IS NULL', null, false)
            ->where('verification_expires_at >', date('Y-m-d H:i:s'))
            ->countAllResults();
        return $count > 0;
    }

    /** Returns int|null on valid id, false on invalid (id given but unknown). */
    private function validateDesignId(mixed $raw): int|false|null
    {
        if ($raw === null || $raw === '' || $raw === 0 || $raw === '0') return null;
        $id = (int)$raw;
        if ($id <= 0) return false;
        if (!$this->db->tableExists('giftcard_designs')) return null;
        $exists = $this->db->table('giftcard_designs')
            ->where('design_id', $id)
            ->where('deleted', 0)
            ->where('active', 1)
            ->countAllResults();
        return $exists > 0 ? $id : false;
    }

    /**
     * Loads + snapshots an active denomination by id. Returns:
     *   null  — caller didn't request one (no snapshot)
     *   false — caller asked for one that doesn't exist / wrong currency
     *   array{amount, label} — snapshot to embed on the issued card
     */
    private function loadDenomination(mixed $raw, string $currency): array|false|null
    {
        if ($raw === null || $raw === '' || $raw === 0 || $raw === '0') return null;
        $id = (int)$raw;
        if ($id <= 0) return false;
        if (!$this->db->tableExists('giftcard_denominations')) return null;
        $row = $this->db->table('giftcard_denominations')
            ->where('denomination_id', $id)
            ->where('deleted', 0)
            ->where('active', 1)
            ->get()
            ->getRowArray();
        if ($row === null) return false;
        if (strtoupper((string)$row['currency']) !== strtoupper($currency)) return false;
        return [
            'amount' => $this->parseAmount($row['amount']) ?? '0.00',
            'label' => $row['label'] ?? null,
        ];
    }

    /** Parse ISO-8601-ish deliver_at. Returns null (none), false (invalid), or 'Y-m-d H:i:s' string. */
    private function parseFutureDateTime(mixed $raw): string|false|null
    {
        if ($raw === null || $raw === '') return null;
        $s = trim((string)$raw);
        $ts = strtotime($s);
        if ($ts === false) return false;
        if ($ts <= time()) return false;
        return date('Y-m-d H:i:s', $ts);
    }

    private function validateHexColor(mixed $raw, string $default): string
    {
        if ($raw === null) return $default;
        $s = strtoupper(trim((string)$raw));
        if (preg_match('/^#[0-9A-F]{6}$/', $s)) return $s;
        if (preg_match('/^#[0-9A-F]{3}$/', $s)) return $s;
        return $default;
    }

    private function validateIcon(mixed $raw): ?string
    {
        if ($raw === null || $raw === '') return null;
        $s = (string)$raw;
        return in_array($s, self::ALLOWED_DESIGN_ICONS, true) ? $s : null;
    }

    /** Allow only relative paths or https URLs for design imagery (XSS hardening). */
    private function sanitizeImageUrl(mixed $raw): ?string
    {
        if ($raw === null || $raw === '') return null;
        $s = trim((string)$raw);
        if ($s === '') return null;
        if (str_starts_with($s, '/') || str_starts_with($s, 'https://')) {
            return mb_substr($s, 0, 512);
        }
        return null;
    }

    /**
     * Per-IP sliding-window rate limit for public transfer endpoints.
     * Fail-CLOSED on cache backend failure for these sensitive endpoints
     * (the balance-lookup helper fails open; accepting a transfer is
     * higher-stakes).
     */
    private function publicTransferRateLimit(string $bucket, int $perMinute): bool
    {
        try {
            $ip = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key = $bucket . '_' . hash('sha256', $ip);
            $hits = (int)($cache->get($key) ?? 0);
            if ($hits >= $perMinute) return false;
            $cache->save($key, $hits + 1, 60);
            return true;
        } catch (Throwable $e) {
            log_message('warning', 'GiftcardsController::publicTransferRateLimit — ' . $e->getMessage());
            return false;
        }
    }

    // ============================================================
    // Phase 6 — NFC bindings, payment intents, customer self-service
    // ============================================================

    private const BIND_TTL_MIN = 15;
    private const INTENT_TTL_SEC = 60;
    private const OTP_TTL_MIN = 5;
    private const PUBLIC_OTP_RATE = 5;       // per minute per IP
    private const PUBLIC_DISABLE_RATE = 3;   // per minute per IP

    private const ALLOWED_MNO = ['mpesa', 'airtel', 'mtn_momo'];
    private const ALLOWED_INTENT_SOURCES = [
        'card_balance', 'mpesa', 'airtel', 'mtn_momo',
        'pesaswap_wallet', 'coop_bank', 'coop_bnpl', 'split',
    ];
    private const SYNC_SOURCES = ['card_balance', 'pesaswap_wallet'];

    // ---------- Bindings (operator-initiated) ----------

    public function bindingIndex(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) return $this->respondSuccess(['bindings' => []]);
        if ($this->fetchGiftcard($id) === null) return $this->respondError('Gift card not found.', 404);
        $rows = $this->db->table('giftcard_bindings')
            ->where('giftcard_id', $id)
            ->where('deleted', 0)
            ->orderBy('created_at', 'DESC')
            ->limit(20)
            ->get()
            ->getResultArray();
        return $this->respondSuccess([
            'bindings' => array_map([$this, 'decorateBinding'], $rows),
        ]);
    }

    /**
     * Operator-initiated bind. Customer authorises via STK push to the
     * provided mobile number. We persist the binding as 'pending' with an
     * expires_at; a real MNO callback (or the mocked dev-mode auto-confirm
     * step below) flips it to 'active'.
     */
    public function bind(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) {
            return $this->respondError('Gift card bindings migration is required.', 503);
        }
        $body = $this->request->getJSON(true) ?? [];

        $phone = preg_replace('/\s+/', '', (string)($body['mobile_number'] ?? ''));
        if (!preg_match('/^\+?\d{9,15}$/', $phone)) {
            return $this->respondError('mobile_number must be 9-15 digits, optionally with leading +.', 422);
        }
        $provider = strtolower(trim((string)($body['mno_provider'] ?? '')));
        if (!in_array($provider, self::ALLOWED_MNO, true)) {
            return $this->respondError('mno_provider must be one of: ' . implode(', ', self::ALLOWED_MNO), 422);
        }
        $idemKey = mb_substr((string)($body['idempotency_key'] ?? bin2hex(random_bytes(8))), 0, 64);

        try {
            $this->db->transStart();
            $giftcardsTable = $this->db->prefixTable('giftcards');
            $card = $this->db->query(
                "SELECT * FROM {$giftcardsTable} WHERE giftcard_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($card === null) {
                $this->db->transComplete();
                return $this->respondError('Gift card not found.', 404);
            }
            if ($this->computeStatus($card) !== self::STATUS_ACTIVE) {
                $this->db->transComplete();
                return $this->respondError('Only active gift cards can be bound.', 409);
            }

            // Idempotency: same (card, idempotency_key) returns the existing binding.
            $prior = $this->db->table('giftcard_bindings')
                ->where('giftcard_id', $id)
                ->where('idempotency_key', $idemKey)
                ->get()
                ->getRowArray();
            if ($prior !== null) {
                $this->db->transComplete();
                return $this->respondSuccess([
                    'binding' => $this->decorateBinding($prior),
                    'message' => 'Existing binding returned (idempotent).',
                ]);
            }

            // Refuse if there's already an active binding on this card. (The
            // generated-column unique index also enforces this, but we want
            // a friendly 409 instead of a duplicate-key surprise.)
            $activeExisting = $this->db->table('giftcard_bindings')
                ->where('giftcard_id', $id)
                ->where('status', 'active')
                ->where('deleted', 0)
                ->countAllResults();
            if ($activeExisting > 0) {
                $this->db->transComplete();
                return $this->respondError('Card is already bound to a phone. Unbind first.', 409);
            }

            $expires = date('Y-m-d H:i:s', time() + self::BIND_TTL_MIN * 60);

            $this->db->table('giftcard_bindings')->insert([
                'giftcard_id' => $id,
                'mobile_number' => $phone,
                'mno_provider' => $provider,
                'status' => $this->devMode() ? 'active' : 'pending',
                'bound_at' => $this->devMode() ? date('Y-m-d H:i:s') : null,
                'pin_attempts' => 0,
                'initiated_by_employee_id' => $this->currentUserId(),
                'mno_request_id' => $this->mockTransactionId('STK'),
                'idempotency_key' => $idemKey,
                'expires_at' => $expires,
                'ip' => $this->request->getIPAddress() ?: null,
                'user_agent' => mb_substr((string)$this->request->getUserAgent(), 0, 255),
                'deleted' => 0,
            ]);
            $bindingId = (int)$this->db->insertID();

            $this->writeHistory($id, [
                'action' => 'binding_' . ($this->devMode() ? 'activated' : 'requested'),
                'amount' => '0.00',
                'balance_before' => (string)$card['value'],
                'balance_after' => (string)$card['value'],
                'comment' => 'Bound to ' . $this->maskPhoneServer($phone) . ' via ' . $provider . ' (binding #' . $bindingId . ')',
            ]);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create binding.', 500);
            }

            $fresh = $this->db->table('giftcard_bindings')->where('binding_id', $bindingId)->get()->getRowArray();
            return $this->respondSuccess([
                'binding' => $this->decorateBinding($fresh ?? []),
                'message' => $this->devMode()
                    ? 'Binding activated (dev mode bypassed STK push).'
                    : 'STK push sent — customer has ' . self::BIND_TTL_MIN . ' minutes to authorise.',
            ], 'Binding created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::bind — ' . $e->getMessage());
            return $this->respondError('Failed to create binding.', 500);
        }
    }

    /** Operator-initiated unbind (admin override). */
    public function unbind(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) {
            return $this->respondError('Gift card bindings migration is required.', 503);
        }
        if ($this->fetchGiftcard($id) === null) return $this->respondError('Gift card not found.', 404);
        return $this->disableBindingInternal($id, 'unbound_by_operator');
    }

    // ---------- Payment intents ----------

    public function createIntent(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) {
            return $this->respondError('Gift card bindings migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $amountRaw = $this->parseAmount($body['amount'] ?? null);
        if ($amountRaw === null || $this->bccompZero($amountRaw) <= 0) {
            return $this->respondError('amount must be a positive number.', 422);
        }
        $source = strtolower(trim((string)($body['source'] ?? '')));
        if (!in_array($source, self::ALLOWED_INTENT_SOURCES, true)) {
            return $this->respondError('source must be one of: ' . implode(', ', self::ALLOWED_INTENT_SOURCES), 422);
        }
        if ($source === 'split') {
            // Phase 6 ships single-source intents only. Split needs an intent-
            // legs table — tracked as a v2 follow-up.
            return $this->respondError('Split tender is not implemented in this release.', 501);
        }
        $currency = strtoupper(trim((string)($body['currency'] ?? 'KES'))) ?: 'KES';
        $idemKey = mb_substr((string)($body['idempotency_key'] ?? bin2hex(random_bytes(8))), 0, 64);
        $saleId = isset($body['sale_id']) ? (int)$body['sale_id'] : null;

        try {
            $this->db->transStart();
            $giftcardsTable = $this->db->prefixTable('giftcards');
            $card = $this->db->query(
                "SELECT * FROM {$giftcardsTable} WHERE giftcard_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($card === null) {
                $this->db->transComplete();
                return $this->respondError('Gift card not found.', 404);
            }
            if ($this->computeStatus($card) !== self::STATUS_ACTIVE) {
                $this->db->transComplete();
                return $this->respondError('Only active gift cards can receive payment intents.', 409);
            }

            // Idempotency replay
            $prior = $this->db->table('giftcard_payment_intents')
                ->where('giftcard_id', $id)
                ->where('idempotency_key', $idemKey)
                ->get()
                ->getRowArray();
            if ($prior !== null) {
                $this->db->transComplete();
                return $this->respondSuccess([
                    'intent' => $this->decorateIntent($prior),
                    'message' => 'Existing intent returned (idempotent).',
                ]);
            }

            // Pending-transfer freeze still applies (a transfer-in-progress
            // means ownership is changing — no new debits).
            if ($this->hasPendingTransferUnderLock($id)) {
                $this->db->transComplete();
                return $this->respondError('Card has a pending transfer. Cancel it before taking a payment.', 409);
            }
            if ($this->hasInFlightIntentUnderLock($id)) {
                $this->db->transComplete();
                return $this->respondError('An intent is already in flight on this card. Cancel it first.', 409);
            }

            // For card_balance, validate sufficiency now.
            if ($source === 'card_balance' && bccomp((string)$card['value'], $amountRaw, self::SCALE) < 0) {
                $this->db->transComplete();
                return $this->respondError('Insufficient card balance.', 422);
            }

            $isSync = in_array($source, self::SYNC_SOURCES, true);
            $expires = $isSync ? null : date('Y-m-d H:i:s', time() + self::INTENT_TTL_SEC);
            $initialStatus = $isSync ? 'pending' : 'awaiting_pin';

            $this->db->table('giftcard_payment_intents')->insert([
                'giftcard_id' => $id,
                'sale_id' => $saleId,
                'amount' => $amountRaw,
                'currency' => $currency,
                'source' => $source,
                'status' => $initialStatus,
                'mno_request_id' => $isSync ? null : $this->mockTransactionId('STK'),
                'initiated_by_employee_id' => $this->currentUserId(),
                'idempotency_key' => $idemKey,
                'ip' => $this->request->getIPAddress() ?: null,
                'user_agent' => mb_substr((string)$this->request->getUserAgent(), 0, 255),
                'expires_at' => $expires,
            ]);
            $intentId = (int)$this->db->insertID();

            // Synchronous sources (card_balance + wallet) settle inside this
            // same tx. MNO/Co-op sources sit in awaiting_pin until callback.
            if ($source === 'card_balance') {
                $newBalance = bcsub((string)$card['value'], $amountRaw, self::SCALE);
                $newStatus = $this->bccompZero($newBalance) <= 0 ? self::STATUS_USED : self::STATUS_ACTIVE;
                $this->applyBalanceChangeLocked($id, $card, $newBalance, $newStatus, [
                    'action' => self::ACTION_REDEEMED,
                    'amount' => $amountRaw,
                    'balance_before' => (string)$card['value'],
                    'balance_after' => $newBalance,
                    'comment' => 'Redeemed via card balance (intent #' . $intentId . ')',
                ]);
                $this->markIntentCompleted($intentId, 'CARD-' . $intentId);
            } elseif ($source === 'pesaswap_wallet') {
                $result = $this->debitWalletLocked($card, $amountRaw, $currency, $intentId);
                if (isset($result['error'])) {
                    $this->db->transComplete();
                    return $this->respondError($result['error'], (int)($result['code'] ?? 422));
                }
                $this->markIntentCompleted($intentId, 'WLT-' . $intentId);
            }

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create intent.', 500);
            }

            // In dev mode, auto-complete MNO/Co-op sources via a mock callback
            // after a short delay so demos work without a real webhook. The
            // delay is fake (callback is sync here); the front-end can poll
            // showIntent() to see the transition.
            if (!$isSync && $this->devMode()) {
                $this->mockExternalCallback($intentId, $source);
            }

            $fresh = $this->db->table('giftcard_payment_intents')->where('intent_id', $intentId)->get()->getRowArray();
            return $this->respondSuccess([
                'intent' => $this->decorateIntent($fresh ?? []),
            ], 'Intent created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::createIntent — ' . $e->getMessage());
            return $this->respondError('Failed to create intent.', 500);
        }
    }

    public function showIntent(int $id, int $intentId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) {
            return $this->respondError('Gift card bindings migration is required.', 503);
        }
        $row = $this->db->table('giftcard_payment_intents')
            ->where('intent_id', $intentId)
            ->where('giftcard_id', $id)
            ->get()
            ->getRowArray();
        if ($row === null) return $this->respondError('Intent not found.', 404);
        return $this->respondSuccess(['intent' => $this->decorateIntent($row)]);
    }

    public function cancelIntent(int $id, int $intentId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->bindingsApplied()) {
            return $this->respondError('Gift card bindings migration is required.', 503);
        }
        try {
            $this->db->transStart();
            $intentsTable = $this->db->prefixTable('giftcard_payment_intents');
            $row = $this->db->query(
                "SELECT * FROM {$intentsTable} WHERE intent_id = ? AND giftcard_id = ? LIMIT 1 FOR UPDATE",
                [$intentId, $id],
            )->getRowArray();
            if ($row === null) {
                $this->db->transComplete();
                return $this->respondError('Intent not found.', 404);
            }
            if (!in_array($row['status'], ['pending', 'awaiting_pin', 'authorised'], true)) {
                $this->db->transComplete();
                return $this->respondError('Intent is already in a terminal state (' . $row['status'] . ').', 409);
            }
            $this->db->table('giftcard_payment_intents')->where('intent_id', $intentId)->update([
                'status' => 'cancelled',
                'completed_at' => date('Y-m-d H:i:s'),
                'failure_code' => 'CUSTOMER_CANCELLED',
                'failure_reason' => 'Cancelled by operator.',
            ]);
            $this->db->transComplete();
            $fresh = $this->db->table('giftcard_payment_intents')->where('intent_id', $intentId)->get()->getRowArray();
            return $this->respondSuccess(['intent' => $this->decorateIntent($fresh ?? [])], 'Intent cancelled.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::cancelIntent — ' . $e->getMessage());
            return $this->respondError('Failed to cancel intent.', 500);
        }
    }

    // ---------- MNO webhook (HMAC-stub) ----------

    public function mnoCallback(string $provider): ResponseInterface
    {
        $provider = strtolower(trim($provider));
        if (!in_array($provider, self::ALLOWED_MNO, true)) {
            return $this->respondError('Unknown provider.', 404);
        }
        if (!$this->bindingsApplied()) {
            return $this->respondError('Migration not applied.', 503);
        }

        // HMAC verification: required in production, bypassed only when the
        // operator hasn't configured a secret (dev mode).
        $secret = (string)$this->getAppConfig('giftcard_mno_webhook_secret', '');
        $bodyRaw = $this->request->getBody() ?? '';
        if ($secret !== '') {
            $sig = (string)$this->request->getHeaderLine('X-Pesaswap-Signature');
            $expected = hash_hmac('sha256', $bodyRaw, $secret);
            if (!hash_equals($expected, $sig)) {
                return $this->respondError('Invalid signature.', 401);
            }
        }

        $body = json_decode($bodyRaw, true) ?? [];
        $mnoRequestId = (string)($body['mno_request_id'] ?? '');
        $status = strtolower((string)($body['status'] ?? ''));
        $mnoTxnRef = (string)($body['mno_txn_ref'] ?? '');
        $failureCode = (string)($body['failure_code'] ?? '');
        $failureReason = (string)($body['failure_reason'] ?? '');
        if ($mnoRequestId === '') return $this->respondError('mno_request_id required.', 422);
        if (!in_array($status, ['completed', 'failed'], true)) {
            return $this->respondError('status must be completed or failed.', 422);
        }

        try {
            // Could be a binding STK callback OR an intent STK callback —
            // route by which table holds the mno_request_id.
            $intent = $this->db->table('giftcard_payment_intents')
                ->where('mno_request_id', $mnoRequestId)
                ->get()
                ->getRowArray();
            if ($intent !== null) {
                return $this->handleIntentCallback($intent, $provider, $status, $mnoTxnRef, $failureCode, $failureReason);
            }
            $binding = $this->db->table('giftcard_bindings')
                ->where('mno_request_id', $mnoRequestId)
                ->get()
                ->getRowArray();
            if ($binding !== null) {
                return $this->handleBindingCallback($binding, $provider, $status, $failureCode, $failureReason);
            }
            return $this->respondError('Unknown mno_request_id.', 404);
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::mnoCallback — ' . $e->getMessage());
            return $this->respondError('Failed to process callback.', 500);
        }
    }

    // ---------- Public self-service (OTP-gated unbind + disable) ----------

    public function publicBinding(string $code): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_binding_lookup', 30)) {
            return $this->respondError('Too many lookups.', 429);
        }
        if (!$this->bindingsApplied()) return $this->respondSuccess(['binding' => null]);
        $card = $this->lookupCardByCode($code);
        if ($card === null) return $this->respondSuccess(['binding' => null]);
        $row = $this->db->table('giftcard_bindings')
            ->where('giftcard_id', (int)$card['giftcard_id'])
            ->where('status', 'active')
            ->where('deleted', 0)
            ->get()
            ->getRowArray();
        if ($row === null) return $this->respondSuccess(['binding' => null]);
        // Sanitised projection — never leak the full phone.
        return $this->respondSuccess([
            'binding' => [
                'binding_id' => (int)$row['binding_id'],
                'mno_provider' => (string)$row['mno_provider'],
                'masked_phone' => $this->maskPhoneServer((string)$row['mobile_number']),
                'bound_at' => $row['bound_at'],
                'last_used_at' => $row['last_used_at'],
            ],
        ]);
    }

    public function publicSendOtp(string $code): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_otp_send', self::PUBLIC_OTP_RATE)) {
            return $this->respondError('Too many OTP requests.', 429);
        }
        if (!$this->bindingsApplied()) return $this->respondError('Migration not applied.', 503);
        $body = $this->request->getJSON(true) ?? [];
        $action = strtolower(trim((string)($body['action'] ?? '')));
        if (!in_array($action, ['unbind', 'disable'], true)) {
            return $this->respondError('action must be unbind or disable.', 422);
        }
        $card = $this->lookupCardByCode($code);
        if ($card === null) return $this->respondError('Card not found.', 404);

        // Both verbs require an active binding (otherwise no phone to OTP).
        $binding = $this->db->table('giftcard_bindings')
            ->where('giftcard_id', (int)$card['giftcard_id'])
            ->where('status', 'active')
            ->where('deleted', 0)
            ->get()
            ->getRowArray();
        if ($binding === null) {
            return $this->respondError('Card has no active phone binding — operator must perform this action.', 409);
        }

        // Invalidate any prior un-consumed OTP for this card+action so the
        // generated-column unique index has room.
        $this->db->table('giftcard_otps')
            ->where('giftcard_id', (int)$card['giftcard_id'])
            ->where('action', $action)
            ->where('consumed_at IS NULL', null, false)
            ->update(['consumed_at' => date('Y-m-d H:i:s')]);

        $plain = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $hash = hash('sha256', $plain);
        $expires = date('Y-m-d H:i:s', time() + self::OTP_TTL_MIN * 60);

        $this->db->table('giftcard_otps')->insert([
            'giftcard_id' => (int)$card['giftcard_id'],
            'action' => $action,
            'code_hash' => $hash,
            'attempts' => 0,
            'max_attempts' => 5,
            'expires_at' => $expires,
            'ip' => $this->request->getIPAddress() ?: null,
            'user_agent' => mb_substr((string)$this->request->getUserAgent(), 0, 255),
        ]);

        $inline = (string)$this->getAppConfig('giftcard_otp_inline_return', '1') === '1';
        return $this->respondSuccess([
            'masked_phone' => $this->maskPhoneServer((string)$binding['mobile_number']),
            'expires_at' => $expires,
            // Inline return only in dev mode. Real production wires SMS and
            // never returns the plaintext code.
            'demo_code' => $inline ? $plain : null,
        ], 'OTP sent.');
    }

    public function publicUnbind(string $code): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_unbind', self::PUBLIC_OTP_RATE)) {
            return $this->respondError('Too many attempts.', 429);
        }
        $card = $this->verifyOtpForCode($code, 'unbind');
        if (isset($card['error'])) return $this->respondError($card['error'], (int)$card['code']);
        return $this->disableBindingInternal((int)$card['giftcard_id'], 'unbound_by_customer');
    }

    public function publicDisable(string $code): ResponseInterface
    {
        if (!$this->publicTransferRateLimit('gc_disable', self::PUBLIC_DISABLE_RATE)) {
            return $this->respondError('Too many attempts.', 429);
        }
        $card = $this->verifyOtpForCode($code, 'disable');
        if (isset($card['error'])) return $this->respondError($card['error'], (int)$card['code']);

        try {
            $this->db->transStart();
            // Disable = status='disabled' (NOT delete=1) — keeps the row
            // visible to admins for fraud audit.
            $this->db->table('giftcards')
                ->where('giftcard_id', (int)$card['giftcard_id'])
                ->update([
                    'status' => self::STATUS_DISABLED,
                    'updated_at' => date('Y-m-d H:i:s'),
                ]);
            // Also disable any active binding so the bound phone stops being
            // a key to a now-frozen card.
            $this->db->table('giftcard_bindings')
                ->where('giftcard_id', (int)$card['giftcard_id'])
                ->where('status', 'active')
                ->update(['status' => 'disabled']);
            $this->writeHistory((int)$card['giftcard_id'], [
                'action' => self::ACTION_DISABLED,
                'amount' => '0.00',
                'balance_before' => (string)$card['value'],
                'balance_after' => (string)$card['value'],
                'comment' => 'Disabled by customer via self-service portal (OTP verified)',
            ]);
            $this->db->transComplete();
            return $this->respondSuccess([
                'giftcard_id' => (int)$card['giftcard_id'],
                'status' => self::STATUS_DISABLED,
            ], 'Card disabled.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::publicDisable — ' . $e->getMessage());
            return $this->respondError('Failed to disable card.', 500);
        }
    }

    // ---------- Helpers ----------

    /**
     * Centralised balance write — assumes the caller has already locked the
     * giftcard row inside a transStart. Extracted out of mutateBalance so
     * createIntent can share the same debit+history machinery without
     * triggering its own freeze check.
     */
    private function applyBalanceChangeLocked(int $id, array $row, string $newBalance, string $newStatus, array $historyEntry): void
    {
        $this->db->table('giftcards')->where('giftcard_id', $id)->update([
            'value' => $newBalance,
            'status' => $newStatus,
        ]);
        $this->writeHistory($id, array_merge([
            'amount' => '0.00',
            'balance_before' => (string)$row['value'],
            'balance_after' => $newBalance,
            'txn_status' => 'completed',
        ], $historyEntry));
    }

    /** Caller must have giftcard row locked. */
    private function debitWalletLocked(array $card, string $amount, string $currency, int $intentId): array
    {
        $recipientEmail = trim((string)($card['recipient_email'] ?? ''));
        if ($recipientEmail === '') {
            return ['error' => 'Wallet requires recipient_email on the card.', 'code' => 422];
        }
        $personId = $this->resolvePersonByEmail($recipientEmail);
        if ($personId === null) {
            return ['error' => 'No customer wallet on file for this recipient.', 'code' => 422];
        }

        $walletsTable = $this->db->prefixTable('pesaswap_wallets');
        $wallet = $this->db->query(
            "SELECT * FROM {$walletsTable} WHERE person_id = ? AND currency = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
            [$personId, $currency],
        )->getRowArray();
        if ($wallet === null) {
            return ['error' => 'Customer wallet is empty or not initialised.', 'code' => 422];
        }
        if (bccomp((string)$wallet['balance'], $amount, self::SCALE) < 0) {
            return ['error' => 'Insufficient wallet balance.', 'code' => 422];
        }
        $newBalance = bcsub((string)$wallet['balance'], $amount, self::SCALE);
        $this->db->table('pesaswap_wallets')->where('wallet_id', (int)$wallet['wallet_id'])->update(['balance' => $newBalance]);
        $this->writeHistory((int)$card['giftcard_id'], [
            'action' => self::ACTION_REDEEMED,
            'amount' => $amount,
            'balance_before' => (string)$card['value'],
            'balance_after' => (string)$card['value'],
            'comment' => 'Redeemed via PESASWAP wallet (intent #' . $intentId . ', wallet balance ' . $newBalance . ')',
            'provider' => 'pesaswap_wallet',
        ]);
        return ['ok' => true];
    }

    private function markIntentCompleted(int $intentId, string $txnRef): void
    {
        $this->db->table('giftcard_payment_intents')->where('intent_id', $intentId)->update([
            'status' => 'completed',
            'completed_at' => date('Y-m-d H:i:s'),
            'mno_txn_ref' => $txnRef,
        ]);
    }

    /**
     * Mock external callback for dev mode. Runs inline — no real async.
     * 90% success rate so demos see both paths.
     */
    private function mockExternalCallback(int $intentId, string $source): void
    {
        $success = random_int(1, 100) <= 90;
        if ($success) {
            $this->markIntentCompleted($intentId, strtoupper($source) . '-' . $intentId . '-' . substr(bin2hex(random_bytes(3)), 0, 6));
            // For card_balance and wallet we already debited. MNO sources
            // don't debit the card itself — they debit the customer's MNO
            // account, which is out-of-band. No giftcard.value mutation here.
        } else {
            $this->db->table('giftcard_payment_intents')->where('intent_id', $intentId)->update([
                'status' => 'failed',
                'completed_at' => date('Y-m-d H:i:s'),
                'failure_code' => 'PIN_DECLINED',
                'failure_reason' => 'Customer declined the PIN prompt (mock).',
            ]);
        }
    }

    private function handleIntentCallback(array $intent, string $provider, string $status, string $mnoTxnRef, string $failureCode, string $failureReason): ResponseInterface
    {
        if ($intent['source'] !== $provider) {
            return $this->respondError('provider mismatch on intent.', 409);
        }
        if (!in_array($intent['status'], ['pending', 'awaiting_pin', 'authorised'], true)) {
            // Terminal state idempotency — late callback is a no-op.
            return $this->respondSuccess(['intent_id' => (int)$intent['intent_id'], 'already_terminal' => true]);
        }
        if ($status === 'completed') {
            $this->markIntentCompleted((int)$intent['intent_id'], $mnoTxnRef !== '' ? $mnoTxnRef : 'MNO-' . $intent['intent_id']);
        } else {
            $this->db->table('giftcard_payment_intents')->where('intent_id', (int)$intent['intent_id'])->update([
                'status' => 'failed',
                'completed_at' => date('Y-m-d H:i:s'),
                'failure_code' => $failureCode !== '' ? mb_substr($failureCode, 0, 32) : 'UNKNOWN',
                'failure_reason' => $failureReason !== '' ? mb_substr($failureReason, 0, 255) : 'MNO declined.',
            ]);
        }
        return $this->respondSuccess(['intent_id' => (int)$intent['intent_id'], 'status' => $status]);
    }

    private function handleBindingCallback(array $binding, string $provider, string $status, string $failureCode, string $failureReason): ResponseInterface
    {
        if ($binding['mno_provider'] !== $provider) {
            return $this->respondError('provider mismatch on binding.', 409);
        }
        if ($binding['status'] !== 'pending') {
            return $this->respondSuccess(['binding_id' => (int)$binding['binding_id'], 'already_terminal' => true]);
        }
        if ($status === 'completed') {
            $this->db->table('giftcard_bindings')->where('binding_id', (int)$binding['binding_id'])->update([
                'status' => 'active',
                'bound_at' => date('Y-m-d H:i:s'),
            ]);
        } else {
            $this->db->table('giftcard_bindings')->where('binding_id', (int)$binding['binding_id'])->update([
                'status' => 'disabled',
                'pin_attempts' => (int)$binding['pin_attempts'] + 1,
            ]);
            $this->writeHistory((int)$binding['giftcard_id'], [
                'action' => 'binding_failed',
                'amount' => '0.00',
                'balance_before' => '0.00',
                'balance_after' => '0.00',
                'comment' => 'Binding failed: ' . ($failureCode ?: 'UNKNOWN') . ' — ' . ($failureReason ?: 'no reason given'),
            ]);
        }
        return $this->respondSuccess(['binding_id' => (int)$binding['binding_id'], 'status' => $status]);
    }

    private function disableBindingInternal(int $giftcardId, string $reason): ResponseInterface
    {
        try {
            $this->db->transStart();
            $existing = $this->db->table('giftcard_bindings')
                ->where('giftcard_id', $giftcardId)
                ->where('status', 'active')
                ->where('deleted', 0)
                ->get()
                ->getRowArray();
            if ($existing === null) {
                $this->db->transComplete();
                return $this->respondError('No active binding to disable.', 404);
            }
            $this->db->table('giftcard_bindings')->where('binding_id', (int)$existing['binding_id'])->update([
                'status' => 'disabled',
            ]);
            $this->writeHistory($giftcardId, [
                'action' => 'binding_disabled',
                'amount' => '0.00',
                'balance_before' => '0.00',
                'balance_after' => '0.00',
                'comment' => 'Binding to ' . $this->maskPhoneServer((string)$existing['mobile_number']) . ' disabled (' . $reason . ')',
            ]);
            $this->db->transComplete();
            return $this->respondSuccess(['binding_id' => (int)$existing['binding_id']], 'Binding disabled.');
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::disableBindingInternal — ' . $e->getMessage());
            return $this->respondError('Failed to disable binding.', 500);
        }
    }

    /**
     * Verifies the OTP for a card+action. Returns the card row on success,
     * or {error, code} on failure (with sensible HTTP code).
     */
    private function verifyOtpForCode(string $code, string $action): array
    {
        if (!$this->bindingsApplied()) {
            return ['error' => 'Migration not applied.', 'code' => 503];
        }
        $body = $this->request->getJSON(true) ?? [];
        $otpPlain = trim((string)($body['otp'] ?? ''));
        if (!preg_match('/^\d{6}$/', $otpPlain)) {
            return ['error' => 'OTP must be a 6-digit code.', 'code' => 422];
        }
        $card = $this->lookupCardByCode($code);
        if ($card === null) return ['error' => 'Card not found.', 'code' => 404];

        try {
            $this->db->transStart();
            $otpTable = $this->db->prefixTable('giftcard_otps');
            $otp = $this->db->query(
                "SELECT * FROM {$otpTable} WHERE giftcard_id = ? AND action = ? AND consumed_at IS NULL LIMIT 1 FOR UPDATE",
                [(int)$card['giftcard_id'], $action],
            )->getRowArray();
            if ($otp === null) {
                $this->db->transComplete();
                return ['error' => 'No active OTP. Request a new one.', 'code' => 422];
            }
            if (strtotime((string)$otp['expires_at']) < time()) {
                $this->db->table('giftcard_otps')->where('otp_id', (int)$otp['otp_id'])->update(['consumed_at' => date('Y-m-d H:i:s')]);
                $this->db->transComplete();
                return ['error' => 'OTP has expired.', 'code' => 422];
            }
            if ((int)$otp['attempts'] >= (int)$otp['max_attempts']) {
                $this->db->table('giftcard_otps')->where('otp_id', (int)$otp['otp_id'])->update(['consumed_at' => date('Y-m-d H:i:s')]);
                $this->db->transComplete();
                return ['error' => 'OTP locked after too many attempts.', 'code' => 429];
            }
            $hash = hash('sha256', $otpPlain);
            if (!hash_equals((string)$otp['code_hash'], $hash)) {
                $this->db->table('giftcard_otps')->where('otp_id', (int)$otp['otp_id'])->update(['attempts' => (int)$otp['attempts'] + 1]);
                $this->db->transComplete();
                return ['error' => 'OTP code is incorrect.', 'code' => 401];
            }
            $this->db->table('giftcard_otps')->where('otp_id', (int)$otp['otp_id'])->update(['consumed_at' => date('Y-m-d H:i:s')]);
            $this->db->transComplete();
            return $card;
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::verifyOtpForCode — ' . $e->getMessage());
            return ['error' => 'Failed to verify OTP.', 'code' => 500];
        }
    }

    private function lookupCardByCode(string $code): ?array
    {
        $normalized = strtoupper(trim($code));
        if (!preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) return null;
        $row = $this->db->table('giftcards')
            ->where('giftcard_number', $normalized)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();
        return $row ?: null;
    }

    /** Caller must hold the giftcard row lock. */
    private function hasInFlightIntentUnderLock(int $giftcardId): bool
    {
        if (!$this->db->tableExists('giftcard_payment_intents')) return false;
        $count = $this->db->table('giftcard_payment_intents')
            ->where('giftcard_id', $giftcardId)
            ->whereIn('status', ['pending', 'awaiting_pin', 'authorised'])
            ->countAllResults();
        return $count > 0;
    }

    private function decorateBinding(array $row): array
    {
        if ($row === []) return $row;
        return [
            'binding_id' => (int)$row['binding_id'],
            'giftcard_id' => (int)$row['giftcard_id'],
            'mno_provider' => (string)$row['mno_provider'],
            'mobile_number' => (string)$row['mobile_number'],
            'masked_phone' => $this->maskPhoneServer((string)$row['mobile_number']),
            'status' => (string)$row['status'],
            'bound_at' => $row['bound_at'],
            'last_used_at' => $row['last_used_at'],
            'expires_at' => $row['expires_at'] ?? null,
            'pin_attempts' => (int)$row['pin_attempts'],
            'created_at' => $row['created_at'] ?? null,
        ];
    }

    private function decorateIntent(array $row): array
    {
        if ($row === []) return $row;
        return [
            'intent_id' => (int)$row['intent_id'],
            'giftcard_id' => $row['giftcard_id'] === null ? null : (int)$row['giftcard_id'],
            'sale_id' => $row['sale_id'] === null ? null : (int)$row['sale_id'],
            'amount' => (float)$row['amount'],
            'currency' => (string)$row['currency'],
            'source' => (string)$row['source'],
            'status' => (string)$row['status'],
            'mno_request_id' => $row['mno_request_id'],
            'mno_txn_ref' => $row['mno_txn_ref'],
            'failure_code' => $row['failure_code'],
            'failure_reason' => $row['failure_reason'],
            'expires_at' => $row['expires_at'],
            'completed_at' => $row['completed_at'],
            'created_at' => $row['created_at'] ?? null,
        ];
    }

    private function maskPhoneServer(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        if (strlen($digits) < 4) return $phone;
        $tail = substr($digits, -4);
        $head = substr($digits, 0, max(0, strlen($digits) - 7));
        return '+' . str_pad($head, 3, '*') . ' ••• ' . $tail;
    }

    private function resolvePersonByEmail(string $email): ?int
    {
        if (!$this->db->tableExists('people')) return null;
        $row = $this->db->table('people')->where('email', $email)->limit(1)->get()->getRowArray();
        return $row ? (int)$row['person_id'] : null;
    }

    private function getAppConfig(string $key, string $default): string
    {
        try {
            if (!$this->db->tableExists('app_config')) return $default;
            $row = $this->db->table('app_config')->where('key', $key)->get()->getRowArray();
            return $row ? (string)$row['value'] : $default;
        } catch (Throwable $e) {
            return $default;
        }
    }

    /** True when no MNO webhook secret is configured — auto-confirms STK + binding. */
    private function devMode(): bool
    {
        return (string)$this->getAppConfig('giftcard_mno_webhook_secret', '') === '';
    }

    /**
     * Sweep stale awaiting_pin intents past their expires_at. Called by the
     * spark CLI app/Commands/SweepStaleGiftcardIntents.php. Returns a summary.
     */
    public function sweepStaleIntents(int $limit = 100): array
    {
        $summary = ['expired' => 0];
        if (!$this->bindingsApplied()) return $summary + ['error' => 'migration-not-applied'];
        $limit = max(1, min($limit, 1000));
        $now = date('Y-m-d H:i:s');
        $intents = $this->db->prefixTable('giftcard_payment_intents');
        try {
            $this->db->query(
                "UPDATE {$intents} SET status='expired', completed_at=?, failure_code='TIMEOUT', failure_reason='Awaiting PIN timeout.'
                 WHERE status IN ('pending','awaiting_pin') AND expires_at IS NOT NULL AND expires_at < ? LIMIT {$limit}",
                [$now, $now],
            );
            $summary['expired'] = (int)$this->db->affectedRows();
        } catch (Throwable $e) {
            log_message('error', 'GiftcardsController::sweepStaleIntents — ' . $e->getMessage());
            $summary['error'] = $e->getMessage();
        }
        // Also sweep stale pending bindings.
        try {
            $bindings = $this->db->prefixTable('giftcard_bindings');
            $this->db->query(
                "UPDATE {$bindings} SET status='disabled' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < ?",
                [$now],
            );
            $summary['bindings_expired'] = (int)$this->db->affectedRows();
        } catch (Throwable $e) {
            log_message('warning', 'GiftcardsController::sweepStaleIntents bindings — ' . $e->getMessage());
        }
        return $summary;
    }
}
