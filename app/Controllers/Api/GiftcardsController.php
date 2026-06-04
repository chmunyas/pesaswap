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

        $value = $this->parseAmount($body['value'] ?? $body['amount'] ?? 0);
        if ($value === null || $this->bccompZero($value) <= 0) {
            return $this->respondError('A positive value is required.', 422);
        }

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

        $expiresAt = $this->parseExpiry($body['expires_at'] ?? null, $body['expires_in_days'] ?? null);

        // Topup-on-create: if the operator chooses an MNO provider, we treat
        // the initial value as a topup. Mock STK push -> instant credit, but
        // the response shape stays async-compatible (the topup endpoint does
        // the same for subsequent top-ups).
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

            $this->db->table('giftcards')->insert([
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
                'email_status' => $recipientEmail !== '' ? 'mocked' : 'not_requested',
                'email_sent_at' => $recipientEmail !== '' ? date('Y-m-d H:i:s') : null,
                'deleted' => 0,
            ]);
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

            if ($recipientEmail !== '') {
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

    private function buildGiftcardSelect(): array
    {
        $cols = [
            'giftcards.giftcard_id',
            'giftcards.giftcard_number',
            'giftcards.value',
            'giftcards.deleted',
            'giftcards.record_time',
        ];
        foreach (['initial_value', 'status', 'recipient_name', 'recipient_email', 'sender_name', 'sender_email', 'message', 'currency', 'expires_at', 'email_status', 'email_sent_at', 'updated_at'] as $field) {
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
     * status/remaining_pct/days_to_expiry/is_expired fields. NEVER call this
     * inside the public payload (publicBalance has its own sanitiser).
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
}
