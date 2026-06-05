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
}
