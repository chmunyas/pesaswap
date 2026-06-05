<?php

namespace App\Controllers\Api;

use App\Models\Ticket;
use App\Models\Ticket_product;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use DateTimeImmutable;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * TicketsController — Phase 1 wiring for QR ticketing.
 *
 * Phase 0 (commit 2c222d1b9) shipped the schema, RS256 signing libs, QR
 * library, and the underlying Ticket + Ticket_product models with their
 * issue() / redeem() primitives. Phase 1 (this file) wires HTTP endpoints
 * and enforces the business invariants the model-level primitives do not:
 *
 *   - Product CRUD lifecycle (with archive-on-delete-if-issued semantics
 *     and a hard refusal of subtype changes after creation).
 *   - Atomic issuance that holds a row lock on the product, applies the
 *     conditional quantity-cap UPDATE, and validates the sale window,
 *     max_per_customer, bind_customer, and subtype seat assignment.
 *   - Manual operator issuance carrying an explicit issuance_reason.
 *   - Staff redemption with input normalisation (raw JWT / full URL /
 *     ticket code all accepted), per-employee + per-IP rate limiting,
 *     and idempotency replay handling.
 *   - Public claim lookup keyed by the short human ticket code (NOT the
 *     JWT) so the cryptographic credential never leaks via logs/history.
 *
 * Subtype rule:
 *   The four supported subtypes — meeting, scenic, movie, transport —
 *   each have a dedicated 1:1 child table. The controller validates that
 *   the body.subtype_data keys are appropriate for the chosen subtype on
 *   create. On update, subtype changes are rejected (422).
 *
 * Money & inventory rule:
 *   Issuance is the only path that increments quantity_issued. The
 *   counter increment is a conditional UPDATE inside a transaction so two
 *   concurrent issue calls cannot overshoot the cap.
 */
class TicketsController extends BaseApiController
{
    private const ALLOWED_SUBTYPES       = ['meeting', 'scenic', 'movie', 'transport'];
    private const ALLOWED_CODE_TYPES     = ['text', 'barcode', 'qrcode', 'only_qrcode', 'only_barcode'];
    private const ALLOWED_VALIDITY_MODES = ['fixed', 'relative'];
    private const ALLOWED_ISSUE_REASONS  = ['comp', 'replacement', 'gift', 'test', 'migration', 'manual'];
    private const STATUS_TRANSITIONS     = [
        'issued'   => ['active', 'revoked', 'expired'],
        'active'   => ['redeemed', 'revoked', 'refunded', 'expired'],
        'redeemed' => [],
        'refunded' => [],
        'revoked'  => [],
        'expired'  => [],
    ];

    // ========================================================================
    // Phase 2 — sessions, tiers, assign, transfer
    // ========================================================================

    private const ALLOWED_SESSION_STATUSES  = ['scheduled', 'live', 'ended', 'cancelled'];
    private const ALLOWED_TRANSFER_CHANNELS = ['email', 'sms'];

    private Ticket_product $products;
    private Ticket $tickets;

    public function initController(RequestInterface $request, ResponseInterface $response, LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);
        $this->products = model(Ticket_product::class);
        $this->tickets  = model(Ticket::class);
    }

    // ---------- ticket_products CRUD ----------

    public function productIndex(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $pagination = $this->getPagination();
        $search     = trim((string) ($this->request->getGet('search') ?? ''));
        $subtype    = trim((string) ($this->request->getGet('subtype') ?? ''));

        try {
            $table      = $this->db->prefixTable('ticket_products');
            $itemsTable = $this->db->prefixTable('items');

            $where  = ['p.deleted = 0'];
            $params = [];

            if ($search !== '') {
                $like     = $this->likeValue($search);
                $where[]  = "(p.title LIKE ? ESCAPE '!' OR p.brand_name LIKE ? ESCAPE '!')";
                $params[] = $like;
                $params[] = $like;
            }
            if ($subtype !== '' && in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
                $where[]  = 'p.subtype = ?';
                $params[] = $subtype;
            }
            $whereSql = 'WHERE ' . implode(' AND ', $where);

            $sql = "SELECT p.*, i.name AS item_name, i.unit_price AS item_price
                    FROM {$table} AS p
                    LEFT JOIN {$itemsTable} AS i ON i.item_id = p.item_id
                    {$whereSql}
                    ORDER BY p.updated_at DESC, p.ticket_product_id DESC
                    LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}";
            $countSql = "SELECT COUNT(*) AS total FROM {$table} AS p {$whereSql}";

            $rows  = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            $products = array_map(fn (array $r) => $this->decorateProduct($r), $rows);

            return $this->respondSuccess([
                'products'   => $products,
                'pagination' => [
                    'limit'  => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total'  => $total,
                    'search' => $search,
                ],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load ticket products.', 500);
        }
    }

    public function productShow(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        try {
            $product = $this->loadProductRow($id);
            if ($product === null) {
                return $this->respondError('Ticket product not found.', 404);
            }
            $subtype   = $this->loadSubtypeRow((string) $product['subtype'], $id);
            $locations = $this->loadProductLocations($id);

            return $this->respondSuccess([
                'product'   => $this->decorateProduct($product),
                'subtype'   => $subtype,
                'locations' => $locations,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productShow — ' . $e->getMessage());

            return $this->respondError('Failed to load ticket product.', 500);
        }
    }

    public function productCreate(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validateProductPayload($body, /* isCreate */ true);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        $signingKey = $this->loadActiveSigningKeyId();
        if ($signingKey === null) {
            return $this->respondError('No active signing key configured. Run the tickets migration to generate one.', 503);
        }

        try {
            $this->db->transStart();
            $row = $this->buildProductRow($body, /* itemId */ (int) ($body['item_id'] ?? 0), $signingKey);
            $this->db->table('ticket_products')->insert($row);
            $newId = (int) $this->db->insertID();
            $this->writeSubtypeRow((string) $row['subtype'], $newId, $body['subtype_data'] ?? []);
            $this->writeLocations($newId, (array) ($body['location_ids'] ?? []));
            $this->db->transComplete();
            if (! $this->db->transStatus()) {
                return $this->respondError('Failed to create ticket product.', 500);
            }
            $fresh = $this->loadProductRow($newId);

            return $this->respondSuccess([
                'product'   => $fresh ? $this->decorateProduct($fresh) : null,
                'subtype'   => $this->loadSubtypeRow((string) $row['subtype'], $newId),
                'locations' => $this->loadProductLocations($newId),
            ], 'Ticket product created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create ticket product.', 500);
        }
    }

    public function productUpdate(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $existing = $this->loadProductRow($id);
        if ($existing === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];

        // Rubber-duck #6: subtype changes are forbidden after creation.
        if (isset($body['subtype']) && (string) $body['subtype'] !== (string) $existing['subtype']) {
            return $this->respondError('Subtype cannot be changed after creation.', 422);
        }
        // Pre-fill the existing subtype so validateProductPayload allows
        // partial updates of subtype_data without resending the subtype key.
        $body['subtype'] = (string) $existing['subtype'];

        $err = $this->validateProductPayload($body, /* isCreate */ false);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $this->db->transStart();
            $patch = $this->buildProductRow($body, (int) $existing['item_id'], (int) $existing['signing_key_id']);
            // Do not let an update silently change item_id or signing_key_id
            unset($patch['item_id'], $patch['signing_key_id'], $patch['quantity_issued']);

            // counter is owned by issuance only
            $this->db->table('ticket_products')->where('ticket_product_id', $id)->update($patch);
            if (array_key_exists('subtype_data', $body)) {
                $this->writeSubtypeRow((string) $existing['subtype'], $id, (array) $body['subtype_data']);
            }
            if (array_key_exists('location_ids', $body)) {
                $this->writeLocations($id, (array) $body['location_ids']);
            }
            $this->db->transComplete();
            if (! $this->db->transStatus()) {
                return $this->respondError('Failed to update ticket product.', 500);
            }
            $fresh = $this->loadProductRow($id);

            return $this->respondSuccess([
                'product'   => $fresh ? $this->decorateProduct($fresh) : null,
                'subtype'   => $this->loadSubtypeRow((string) $existing['subtype'], $id),
                'locations' => $this->loadProductLocations($id),
            ], 'Ticket product updated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productUpdate — ' . $e->getMessage());

            return $this->respondError('Failed to update ticket product.', 500);
        }
    }

    public function productDelete(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }
        $existing = $this->loadProductRow($id);
        if ($existing === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        try {
            // Rubber-duck #7: products with issued instances become "archived"
            // (still readable for joins from existing tickets) rather than
            // hard-deleted. The semantics are encoded in the `deleted` flag
            // either way; the difference is that we return a different
            // success message so the operator understands.
            $issued = (int) $existing['quantity_issued'];
            $this->db->table('ticket_products')->where('ticket_product_id', $id)->update(['deleted' => 1]);
            $msg = $issued > 0
                ? "Product archived (still readable for {$issued} issued tickets)."
                : 'Product deleted.';

            return $this->respondSuccess(['ticket_product_id' => $id, 'quantity_issued' => $issued], $msg);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productDelete — ' . $e->getMessage());

            return $this->respondError('Failed to delete ticket product.', 500);
        }
    }

    // ---------- tickets (issued instances) ----------

    public function ticketIndex(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $pagination = $this->getPagination();
        $productId  = (int) ($this->request->getGet('ticket_product_id') ?? 0);
        $status     = trim((string) ($this->request->getGet('status') ?? ''));
        $customerId = (int) ($this->request->getGet('customer_id') ?? 0);

        try {
            $table         = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $where         = ['t.deleted = 0'];
            $params        = [];
            if ($productId > 0) {
                $where[]  = 't.ticket_product_id = ?';
                $params[] = $productId;
            }
            if ($status !== '') {
                $where[]  = 't.status = ?';
                $params[] = $status;
            }
            if ($customerId > 0) {
                $where[]  = 't.customer_id = ?';
                $params[] = $customerId;
            }
            $whereSql = 'WHERE ' . implode(' AND ', $where);

            $sql = "SELECT t.*, p.title AS product_title, p.subtype, p.brand_name
                    FROM {$table} AS t
                    LEFT JOIN {$productsTable} AS p ON p.ticket_product_id = t.ticket_product_id
                    {$whereSql}
                    ORDER BY t.issued_at DESC, t.ticket_id DESC
                    LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}";
            $countSql = "SELECT COUNT(*) AS total FROM {$table} AS t {$whereSql}";

            $rows  = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'tickets'    => array_map(fn (array $r) => $this->decorateTicket($r), $rows),
                'pagination' => [
                    'limit'  => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total'  => $total,
                ],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load tickets.', 500);
        }
    }

    public function ticketShow(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }
        $ticket = $this->loadTicketRow($id);
        if ($ticket === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        return $this->respondSuccess([
            'ticket'      => $this->decorateTicket($ticket),
            'redemptions' => $this->loadRedemptions($id),
        ]);
    }

    /**
     * Manual issuance — rubber-duck #3, #4, #8.
     *
     * Wraps the entire issue flow in a transaction that locks the parent
     * product row, validates the business invariants, conditionally
     * increments `quantity_issued`, then defers to the model's issue()
     * primitive for code generation + JWT signing.
     */
    public function ticketIssue(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $body      = $this->request->getJSON(true) ?? [];
        $productId = (int) ($body['ticket_product_id'] ?? 0);
        if ($productId <= 0) {
            return $this->respondError('ticket_product_id is required.', 422);
        }

        $saleId = isset($body['sale_id']) ? (int) $body['sale_id'] : null;
        $reason = strtolower(trim((string) ($body['issuance_reason'] ?? '')));
        if ($saleId === null && ! in_array($reason, self::ALLOWED_ISSUE_REASONS, true)) {
            return $this->respondError(
                'Manual issuance (without sale_id) requires issuance_reason ('
                . implode(', ', self::ALLOWED_ISSUE_REASONS) . ').',
                422,
            );
        }

        $customerId = isset($body['customer_id']) ? (int) $body['customer_id'] : null;
        $sessionId  = isset($body['session_id']) && $body['session_id'] !== null && $body['session_id'] !== ''
            ? (int) $body['session_id'] : null;
        $tierId = isset($body['tier_id']) && $body['tier_id'] !== null && $body['tier_id'] !== ''
            ? (int) $body['tier_id'] : null;

        try {
            // Manual transactions — CI4's transStart/transComplete only rolls
            // back on driver errors; logical aborts via affectedRows()==0 need
            // explicit transRollback() to avoid committing partial counter
            // increments. See Phase 2 commit for the exhaustion test that
            // motivated this change.
            $this->db->transBegin();

            $productsTable = $this->db->prefixTable('ticket_products');
            $product       = $this->db->query(
                "SELECT * FROM {$productsTable} WHERE ticket_product_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$productId],
            )->getRowArray();
            if ($product === null) {
                $this->db->transRollback();

                return $this->respondError('Ticket product not found or archived.', 404);
            }

            $err = $this->validateIssuance($product, $customerId, $body['seat_assignment'] ?? null);
            if (is_string($err)) {
                $this->db->transRollback();

                return $this->respondError($err, 422);
            }

            // Conditional product counter UPDATE — atomic cap protection.
            $this->db->query(
                "UPDATE {$productsTable}
                 SET quantity_issued = quantity_issued + 1
                 WHERE ticket_product_id = ?
                   AND deleted = 0
                   AND (quantity IS NULL OR quantity_issued < quantity)",
                [$productId],
            );
            if ($this->db->affectedRows() === 0) {
                $this->db->transRollback();

                return $this->respondError('Ticket product is sold out.', 409);
            }

            // Phase 2: session counter (optional)
            if ($sessionId !== null) {
                if (! $this->db->tableExists('ticket_product_sessions')) {
                    $this->db->transRollback();

                    return $this->respondError('Sessions migration not applied.', 503);
                }
                $sessionsTable = $this->db->prefixTable('ticket_product_sessions');
                $this->db->query(
                    "UPDATE {$sessionsTable}
                     SET quantity_issued = quantity_issued + 1
                     WHERE session_id = ?
                       AND ticket_product_id = ?
                       AND deleted = 0
                       AND status IN ('scheduled','live')
                       AND (quantity IS NULL OR quantity_issued < quantity)",
                    [$sessionId, $productId],
                );
                if ($this->db->affectedRows() === 0) {
                    $this->db->transRollback();

                    return $this->respondError('Session is sold out, cancelled, or not for this product.', 409);
                }
            }

            // Phase 2: tier counter (optional)
            if ($tierId !== null) {
                if (! $this->db->tableExists('ticket_product_tiers')) {
                    $this->db->transRollback();

                    return $this->respondError('Tiers migration not applied.', 503);
                }
                $tiersTable = $this->db->prefixTable('ticket_product_tiers');
                $this->db->query(
                    "UPDATE {$tiersTable}
                     SET quantity_issued = quantity_issued + 1
                     WHERE tier_id = ?
                       AND ticket_product_id = ?
                       AND deleted = 0
                       AND (quantity IS NULL OR quantity_issued < quantity)",
                    [$tierId, $productId],
                );
                if ($this->db->affectedRows() === 0) {
                    $this->db->transRollback();

                    return $this->respondError('Tier is sold out or not for this product.', 409);
                }
            }

            [$validFrom, $validTo] = $this->resolveValidityWindow($product, $body, $sessionId);

            $params = [
                'ticket_product_id' => $productId,
                'session_id'        => $sessionId,
                'tier_id'           => $tierId,
                'sale_id'           => $saleId,
                'sale_item_seq'     => isset($body['sale_item_seq']) ? (int) $body['sale_item_seq'] : null,
                'customer_id'       => $customerId,
                'valid_from'        => $validFrom,
                'valid_to'          => $validTo,
                'seat_assignment'   => $body['seat_assignment'] ?? null,
            ];

            // Phase 2: Ticket::issue no longer auto-bumps the counter — we own
            // it above. This eliminates the previous increment-then-decrement
            // dance that was fragile under transaction rollback.
            $result = $this->tickets->issue($params);
            if (! isset($result['ticket']) || ! isset($result['token'])) {
                $this->db->transRollback();

                return $this->respondError('Issuance failed.', 500);
            }

            // Manual reason audit — Phase 0 schema has no dedicated column,
            // so we stash it on transfer_history_json with a typed entry.
            if ($saleId === null) {
                $ticketObj = $result['ticket'];
                $audit     = [[
                    'type'        => 'manual_issue',
                    'reason'      => $reason,
                    'employee_id' => $this->session->get('person_id'),
                    'at'          => date('c'),
                ]];
                $this->db->table('tickets')->where('ticket_id', $ticketObj->ticket_id)
                    ->update(['transfer_history_json' => json_encode($audit)]);
            }

            if (! $this->db->transCommit()) {
                return $this->respondError('Issuance transaction failed.', 500);
            }

            // Phase 3: best-effort auto-delivery if operator supplied a recipient.
            $deliveryEmail = isset($body['deliver_email']) ? trim((string) $body['deliver_email']) : '';
            $deliveryPhone = isset($body['deliver_phone']) ? trim((string) $body['deliver_phone']) : '';
            if (($deliveryEmail !== '' || $deliveryPhone !== '') && $this->db->tableExists('ticket_delivery_attempts')) {
                try {
                    service('ticket_delivery_lib')->dispatch(
                        $result['ticket'],
                        $deliveryEmail !== '' ? $deliveryEmail : null,
                        $deliveryPhone !== '' ? $deliveryPhone : null,
                    );
                } catch (Throwable $e) {
                    log_message('error', 'TicketsController::ticketIssue delivery — ' . $e->getMessage());
                }
            }

            $fresh = $this->loadTicketRow((int) $result['ticket']->ticket_id);

            return $this->respondSuccess([
                'ticket'         => $fresh ? $this->decorateTicket($fresh) : null,
                'token'          => $result['token'],
                'redemption_url' => service('qr_lib')->build_redemption_url((string) $result['token']),
            ], 'Ticket issued.', 201);
        } catch (Throwable $e) {
            try {
                $this->db->transRollback();
            } catch (Throwable $ignore) {
            }
            log_message('error', 'TicketsController::ticketIssue — ' . $e->getMessage());

            return $this->respondError('Failed to issue ticket: ' . $e->getMessage(), 500);
        }
    }

    public function ticketRevoke(int $id): ResponseInterface
    {
        return $this->transitionStatus($id, 'revoked', 'reason');
    }

    public function ticketRefund(int $id): ResponseInterface
    {
        return $this->transitionStatus($id, 'refunded', 'reason');
    }

    /**
     * Staff scan endpoint. Accepts:
     *   - raw JWT
     *   - full redemption URL like https://merchant/ticket/<JWT>
     *   - any extra whitespace / surrounding text
     *
     * Always 200s with a `result` field for the UI to render. Failures
     * (invalid signature, not found, expired, already-redeemed, wrong
     * location) are logged in ticket_redemptions just like successes.
     */
    public function ticketRedeem(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        // Rubber-duck #11: rate limit per-employee + per-IP. Failed signatures
        // are throttled more aggressively than authenticated success attempts.
        $employeeId = (int) ($this->session->get('person_id') ?? 0);
        if (! $this->checkRedeemRateLimit($employeeId)) {
            return $this->respondError('Too many redemption attempts. Slow down.', 429);
        }

        $body  = $this->request->getJSON(true) ?? [];
        $raw   = trim((string) ($body['token'] ?? ''));
        $token = $this->extractToken($raw);
        if ($token === '') {
            return $this->respondError('A ticket token, URL, or code is required.', 422);
        }

        $locationId     = isset($body['location_id']) ? (int) $body['location_id'] : null;
        $idempotencyKey = isset($body['idempotency_key'])
            ? mb_substr((string) $body['idempotency_key'], 0, 64) : null;

        try {
            $result = $this->tickets->redeem($token, $employeeId, $locationId, $idempotencyKey);
            // Decorate with the ticket for client display when possible
            $ticket = null;
            if (! empty($result['ticket_id'])) {
                $row = $this->loadTicketRow((int) $result['ticket_id']);
                if ($row !== null) {
                    $ticket = $this->decorateTicket($row);
                }
            }

            return $this->respondSuccess([
                'result'    => $result['result'],
                'ticket_id' => $result['ticket_id'] ?? null,
                'message'   => $result['message'] ?? '',
                'ticket'    => $ticket,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketRedeem — ' . $e->getMessage());

            return $this->respondError('Failed to process redemption.', 500);
        }
    }

    public function ticketQr(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }
        $ticket = $this->loadTicketRow($id);
        if ($ticket === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        try {
            // Re-issue a JWT for display purposes (uses ticket's active key).
            // We do not need to overwrite code_hash because this is a display
            // helper — the originally-issued token is still the valid one.
            // For display we just embed the existing code in the QR (the
            // staff scan path will look up by code, NOT by JWT, when the
            // input lacks a dotted JWT format).
            $url = service('qr_lib')->build_redemption_url((string) $ticket['code']);
            $svg = service('qr_lib')->generate_svg($url);

            return $this->respondSuccess([
                'svg'  => $svg,
                'url'  => $url,
                'code' => (string) $ticket['code'],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketQr — ' . $e->getMessage());

            return $this->respondError('Failed to generate QR.', 500);
        }
    }

    // ---------- PUBLIC claim lookup ----------

    /**
     * Public lookup by short `tickets.code` (NOT the JWT — rubber-duck #1, #2).
     * Sanitises out PII and crypto material. Rate-limited per-IP to defeat
     * code enumeration.
     */
    public function publicLookup(string $code): ResponseInterface
    {
        if (! $this->publicRateLimit('ticket_lookup', 60, 60)) {
            return $this->respondError('Too many lookups.', 429);
        }
        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->emptyPublicTicket();
        }

        try {
            if (! $this->db->tableExists('tickets')) {
                return $this->emptyPublicTicket();
            }
            $ticketsTable  = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $row           = $this->db->query(
                "SELECT t.ticket_id, t.code, t.status, t.valid_from, t.valid_to, t.seat_assignment_json,
                        t.redeem_count, t.customer_id IS NOT NULL AS bound,
                        p.subtype, p.title, p.brand_name, p.color, p.notice, p.code_type,
                        p.logo_url, p.service_phone, p.description
                 FROM {$ticketsTable} AS t
                 LEFT JOIN {$productsTable} AS p ON p.ticket_product_id = t.ticket_product_id
                 WHERE t.code = ? AND t.deleted = 0
                 LIMIT 1",
                [$normalized],
            )->getRowArray();

            $this->logPublicLookup($normalized, $row === null ? 'not_found' : 'ok');

            if ($row === null) {
                return $this->emptyPublicTicket();
            }

            // Subtype-specific public info
            $subtype     = (string) $row['subtype'];
            $subtypeInfo = $this->loadPublicSubtypeRow($subtype, (int) $row['ticket_id'] ?: 0);

            // Re-fetch the subtype row by product_id (the join doesn't carry it)
            $product = $this->db->table('ticket_products')
                ->where('title', $row['title'])
                ->where('subtype', $subtype)
                ->limit(1)
                ->get()
                ->getRowArray();
            if ($product) {
                $subtypeInfo = $this->loadPublicSubtypeRow($subtype, (int) $product['ticket_product_id']);
            }

            // The redemption URL embedded in the QR — staff scans this.
            $redemptionUrl = service('qr_lib')->build_redemption_url($normalized);

            return $this->respondSuccess([
                'code'         => $row['code'],
                'status'       => (string) $row['status'],
                'valid_from'   => $row['valid_from'],
                'valid_to'     => $row['valid_to'],
                'seat'         => $row['seat_assignment_json'] ? json_decode((string) $row['seat_assignment_json'], true) : null,
                'redeem_count' => (int) $row['redeem_count'],
                'bound'        => (bool) $row['bound'],
                'product'      => [
                    'subtype'       => $subtype,
                    'title'         => (string) $row['title'],
                    'brand_name'    => $row['brand_name'],
                    'color'         => $row['color'],
                    'notice'        => $row['notice'],
                    'code_type'     => $row['code_type'],
                    'logo_url'      => $row['logo_url'],
                    'service_phone' => $row['service_phone'],
                    'description'   => $row['description'],
                ],
                'subtype_info' => $subtypeInfo,
                'qr_url'       => $redemptionUrl,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::publicLookup — ' . $e->getMessage());

            return $this->emptyPublicTicket();
        }
    }

    private function emptyPublicTicket(): ResponseInterface
    {
        return $this->respondSuccess([
            'code'         => null,
            'status'       => 'not_found',
            'valid_from'   => null,
            'valid_to'     => null,
            'seat'         => null,
            'redeem_count' => 0,
            'bound'        => false,
            'product'      => null,
            'subtype_info' => null,
            'qr_url'       => null,
        ]);
    }

    // ---------- helpers ----------

    private function migrationApplied(): bool
    {
        return $this->db->tableExists('ticket_products')
            && $this->db->tableExists('tickets')
            && $this->db->tableExists('ticket_signing_keys');
    }

    private function loadActiveSigningKeyId(): ?int
    {
        try {
            // Phase 0 convention: the active key is the newest one with
            // rotated_at IS NULL. Matches Ticket_token_lib::getActiveKey().
            $row = $this->db->table('ticket_signing_keys')
                ->where('rotated_at IS NULL', null, false)
                ->orderBy('signing_key_id', 'DESC')
                ->limit(1)
                ->get()
                ->getRowArray();

            return $row ? (int) $row['signing_key_id'] : null;
        } catch (Throwable $e) {
            return null;
        }
    }

    private function loadProductRow(int $id): ?array
    {
        $row = $this->db->table('ticket_products')
            ->where('ticket_product_id', $id)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();

        return $row ?: null;
    }

    private function loadSubtypeRow(string $subtype, int $productId): array
    {
        if (! in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
            return [];
        }
        $table = 'ticket_product_' . $subtype;
        if (! $this->db->tableExists($table)) {
            return [];
        }
        $row = $this->db->table($table)->where('ticket_product_id', $productId)->get()->getRowArray();

        return $row ?: [];
    }

    private function loadPublicSubtypeRow(string $subtype, int $productId): array
    {
        return $this->loadSubtypeRow($subtype, $productId);
        // No sensitive fields in any of the subtype tables, but always project explicitly:
    }

    private function loadProductLocations(int $productId): array
    {
        try {
            $rows = $this->db->table('ticket_product_locations')
                ->where('ticket_product_id', $productId)
                ->get()
                ->getResultArray();

            return array_map(static fn (array $r) => (int) $r['location_id'], $rows);
        } catch (Throwable $e) {
            return [];
        }
    }

    private function writeSubtypeRow(string $subtype, int $productId, array $data): void
    {
        if (! in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
            return;
        }
        $table = 'ticket_product_' . $subtype;
        if (! $this->db->tableExists($table)) {
            return;
        }
        $allowed = $this->subtypeAllowedFields($subtype);
        $row     = ['ticket_product_id' => $productId];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $data)) {
                $val = $data[$f];
                if (is_array($val)) {
                    $val = json_encode($val);
                }
                $row[$f] = $val;
            }
        }
        $this->db->table($table)->replace($row);
    }

    private function writeLocations(int $productId, array $locationIds): void
    {
        $this->db->table('ticket_product_locations')->where('ticket_product_id', $productId)->delete();

        foreach ($locationIds as $loc) {
            $id = (int) $loc;
            if ($id <= 0) {
                continue;
            }
            $this->db->table('ticket_product_locations')->insert([
                'ticket_product_id' => $productId,
                'location_id'       => $id,
            ]);
        }
    }

    /**
     * Subtype-allowed field whitelist. Mirrors Phase 0 schema.
     */
    private function subtypeAllowedFields(string $subtype): array
    {
        return match ($subtype) {
            'meeting'   => ['meeting_detail', 'map_url', 'entrance', 'zone'],
            'scenic'    => ['scenic_name', 'opening_hours', 'ticket_class', 'address'],
            'movie'     => ['film_title', 'hall', 'screening_ts', 'seat_map_json'],
            'transport' => ['origin', 'destination', 'carrier', 'departure_ts', 'arrival_ts', 'seat_map_json'],
            default     => [],
        };
    }

    /**
     * Validates the body of a productCreate / productUpdate request.
     *
     * @return string|true error string, or true if valid
     */
    private function validateProductPayload(array $body, bool $isCreate): string|true
    {
        $title = trim((string) ($body['title'] ?? ''));
        if ($isCreate && $title === '') {
            return 'Title is required.';
        }
        if (mb_strlen($title) > 255) {
            return 'Title is too long (max 255).';
        }

        $subtype = (string) ($body['subtype'] ?? '');
        if ($isCreate && ! in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
            return 'subtype must be one of: ' . implode(', ', self::ALLOWED_SUBTYPES);
        }

        if (isset($body['code_type']) && ! in_array((string) $body['code_type'], self::ALLOWED_CODE_TYPES, true)) {
            return 'code_type is invalid.';
        }
        if (isset($body['validity_mode']) && ! in_array((string) $body['validity_mode'], self::ALLOWED_VALIDITY_MODES, true)) {
            return 'validity_mode must be fixed or relative.';
        }
        if ($isCreate) {
            if (! isset($body['item_id']) || (int) $body['item_id'] <= 0) {
                return 'item_id is required (links to the OSPOS item).';
            }
            $exists = $this->db->table('items')->where('item_id', (int) $body['item_id'])->countAllResults();
            if ($exists === 0) {
                return 'Unknown item_id.';
            }
        }
        if (isset($body['quantity']) && $body['quantity'] !== null && (int) $body['quantity'] < 0) {
            return 'quantity must be a non-negative integer or null.';
        }
        if (isset($body['max_per_customer']) && $body['max_per_customer'] !== null && (int) $body['max_per_customer'] < 1) {
            return 'max_per_customer must be at least 1.';
        }

        if (isset($body['subtype_data']) && ! is_array($body['subtype_data'])) {
            return 'subtype_data must be an object.';
        }

        return true;
    }

    private function buildProductRow(array $body, int $itemId, int $signingKeyId): array
    {
        return [
            'item_id'               => $itemId,
            'subtype'               => (string) $body['subtype'],
            'code_type'             => (string) ($body['code_type'] ?? 'qrcode'),
            'validity_mode'         => (string) ($body['validity_mode'] ?? 'fixed'),
            'begin_ts'              => $this->parseDateTime($body['begin_ts'] ?? null),
            'end_ts'                => $this->parseDateTime($body['end_ts'] ?? null),
            'fixed_begin_term_days' => $this->intOrNull($body['fixed_begin_term_days'] ?? null),
            'fixed_term_days'       => $this->intOrNull($body['fixed_term_days'] ?? null),
            'quantity'              => $this->intOrNull($body['quantity'] ?? null),
            'max_per_customer'      => $this->intOrNull($body['max_per_customer'] ?? null),
            'sale_window_from'      => $this->parseDateTime($body['sale_window_from'] ?? null),
            'sale_window_to'        => $this->parseDateTime($body['sale_window_to'] ?? null),
            'bind_customer'         => (int) (bool) ($body['bind_customer'] ?? false),
            'transferable'          => (int) (bool) ($body['transferable'] ?? true),
            'single_use'            => (int) (bool) ($body['single_use'] ?? true),
            'max_redemptions'       => max(1, (int) ($body['max_redemptions'] ?? 1)),
            'refundable'            => (int) (bool) ($body['refundable'] ?? true),
            'refund_window_hours'   => $this->intOrNull($body['refund_window_hours'] ?? null),
            'title'                 => mb_substr((string) ($body['title'] ?? ''), 0, 255),
            'brand_name'            => $this->stringOrNull($body['brand_name'] ?? null, 255),
            'color'                 => $this->stringOrNull($body['color'] ?? null, 16),
            'notice'                => $this->stringOrNull($body['notice'] ?? null, 255),
            'description'           => $body['description'] ?? null,
            'service_phone'         => $this->stringOrNull($body['service_phone'] ?? null, 64),
            'source'                => $this->stringOrNull($body['source'] ?? null, 64),
            'custom_url'            => $this->stringOrNull($body['custom_url'] ?? null, 512),
            'custom_url_name'       => $this->stringOrNull($body['custom_url_name'] ?? null, 64),
            'custom_url_sub_title'  => $this->stringOrNull($body['custom_url_sub_title'] ?? null, 128),
            'logo_url'              => $this->stringOrNull($body['logo_url'] ?? null, 512),
            'signing_key_id'        => $signingKeyId,
        ];
    }

    private function decorateProduct(array $row): array
    {
        $quantity                = $row['quantity'] === null ? null : (int) $row['quantity'];
        $issued                  = (int) ($row['quantity_issued'] ?? 0);
        $row['quantity']         = $quantity;
        $row['quantity_issued']  = $issued;
        $row['remaining']        = $quantity === null ? null : max(0, $quantity - $issued);
        $row['sold_out']         = $quantity !== null && $issued >= $quantity;
        $row['sale_window_open'] = $this->isSaleWindowOpen($row);

        return $row;
    }

    private function decorateTicket(array $row): array
    {
        // Mask the code to last 4 in list payloads — operator-only views can fetch the full code via the show endpoint.
        $row['masked_code'] = $this->maskCode((string) ($row['code'] ?? ''));

        return $row;
    }

    private function loadTicketRow(int $id): ?array
    {
        $row = $this->db->table('tickets')
            ->where('ticket_id', $id)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();

        return $row ?: null;
    }

    private function loadRedemptions(int $ticketId): array
    {
        return $this->db->table('ticket_redemptions')
            ->where('ticket_id', $ticketId)
            ->orderBy('occurred_at', 'DESC')
            ->limit(50)
            ->get()
            ->getResultArray();
    }

    private function maskCode(string $code): string
    {
        $len = strlen($code);
        if ($len <= 4) {
            return $code;
        }

        return str_repeat('•', $len - 4) . substr($code, -4);
    }

    /**
     * Rubber-duck #3: validate issuance against product invariants before
     * we commit the counter increment.
     */
    private function validateIssuance(array $product, ?int $customerId, mixed $seatAssignment): string|true
    {
        $now = new DateTimeImmutable();
        // Sale window
        if (! empty($product['sale_window_from']) && strtotime((string) $product['sale_window_from']) > $now->getTimestamp()) {
            return 'Sale window has not opened yet.';
        }
        if (! empty($product['sale_window_to']) && strtotime((string) $product['sale_window_to']) < $now->getTimestamp()) {
            return 'Sale window has closed.';
        }
        if ((int) $product['bind_customer'] === 1 && ($customerId === null || $customerId <= 0)) {
            return 'This product requires customer_id (bind_customer is on).';
        }
        if ((int) $product['max_per_customer'] > 0 && $customerId !== null && $customerId > 0) {
            $existing = (int) $this->db->table('tickets')
                ->where('ticket_product_id', $product['ticket_product_id'])
                ->where('customer_id', $customerId)
                ->where('deleted', 0)
                ->countAllResults();
            if ($existing >= (int) $product['max_per_customer']) {
                return 'Customer has reached the max_per_customer limit.';
            }
        }

        return true;
    }

    private function resolveValidityWindow(array $product, array $body, ?int $sessionId = null): array
    {
        // Phase 2: if a session is selected, its window wins.
        if ($sessionId !== null && $this->db->tableExists('ticket_product_sessions')) {
            $session = $this->db->table('ticket_product_sessions')
                ->where('session_id', $sessionId)
                ->where('ticket_product_id', (int) $product['ticket_product_id'])
                ->where('deleted', 0)
                ->get()
                ->getRowArray();
            if ($session !== null && ! empty($session['starts_at'])) {
                $vf = new DateTimeImmutable((string) $session['starts_at']);
                $vt = ! empty($session['ends_at']) ? new DateTimeImmutable((string) $session['ends_at']) : null;

                return [$vf, $vt];
            }
        }

        $mode = (string) ($product['validity_mode'] ?? 'fixed');
        if ($mode === 'fixed') {
            $vf = $product['begin_ts'] ? new DateTimeImmutable((string) $product['begin_ts']) : null;
            $vt = $product['end_ts'] ? new DateTimeImmutable((string) $product['end_ts']) : null;

            return [$vf, $vt];
        }
        // Relative: now + fixed_begin_term_days for valid_from, +fixed_term_days for valid_to
        $now       = new DateTimeImmutable();
        $beginDays = (int) ($product['fixed_begin_term_days'] ?? 0);
        $termDays  = (int) ($product['fixed_term_days'] ?? 30);
        $vf        = $now->modify("+{$beginDays} days");
        $vt        = $vf->modify("+{$termDays} days");

        return [$vf, $vt];
    }

    private function transitionStatus(int $id, string $target, string $reasonField): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }
        $body   = $this->request->getJSON(true) ?? [];
        $reason = trim((string) ($body[$reasonField] ?? ''));

        try {
            $this->db->transStart();
            $ticketsTable = $this->db->prefixTable('tickets');
            $row          = $this->db->query(
                "SELECT * FROM {$ticketsTable} WHERE ticket_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($row === null) {
                $this->db->transComplete();

                return $this->respondError('Ticket not found.', 404);
            }
            $current = (string) $row['status'];
            if (! in_array($target, self::STATUS_TRANSITIONS[$current] ?? [], true)) {
                $this->db->transComplete();

                return $this->respondError(
                    "Cannot transition from {$current} to {$target}.",
                    409,
                );
            }

            $this->db->table('tickets')->where('ticket_id', $id)->update(['status' => $target]);
            $this->db->table('ticket_redemptions')->insert([
                'ticket_id'   => $id,
                'employee_id' => $this->session->get('person_id'),
                'result'      => $target === 'revoked' ? 'revoked' : 'expired',
                'notes'       => mb_substr($reason !== '' ? $reason : ucfirst($target), 0, 255),
            ]);
            $this->db->transComplete();

            $fresh = $this->loadTicketRow($id);

            return $this->respondSuccess([
                'ticket' => $fresh ? $this->decorateTicket($fresh) : null,
            ], ucfirst($target) . '.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::transitionStatus — ' . $e->getMessage());

            return $this->respondError('Failed to transition ticket.', 500);
        }
    }

    /**
     * Extract a usable identifier from a scan input. Accepts:
     *   - raw JWT (3 base64url chunks separated by .)
     *   - full /ticket/<JWT> URL  → extract JWT
     *   - short ticket code GC-XXXX-XXXX → returned as-is
     */
    private function extractToken(string $raw): string
    {
        $s = trim($raw);
        if ($s === '') {
            return '';
        }
        // URL → take last path segment
        if (preg_match('#^https?://#i', $s)) {
            $parts = explode('/', parse_url($s, PHP_URL_PATH) ?: '');
            $s     = end($parts) ?: '';
        }

        return $s;
    }

    private function checkRedeemRateLimit(int $employeeId): bool
    {
        try {
            $ip    = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key   = 'tk_redeem_' . hash('sha256', $employeeId . '|' . $ip);
            $hits  = (int) ($cache->get($key) ?? 0);
            // Generous limit so a scanner with auto-fire still works in normal use,
            // but defends against pathological loops.
            if ($hits >= 120) {
                return false;
            }
            $cache->save($key, $hits + 1, 60);

            return true;
        } catch (Throwable $e) {
            return true;
        }
    }

    private function publicRateLimit(string $bucket, int $limit, int $windowSeconds): bool
    {
        try {
            $ip    = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key   = $bucket . '_' . hash('sha256', $ip);
            $hits  = (int) ($cache->get($key) ?? 0);
            if ($hits >= $limit) {
                return false;
            }
            $cache->save($key, $hits + 1, $windowSeconds);

            return true;
        } catch (Throwable $e) {
            return true;
        }
    }

    private function logPublicLookup(string $code, string $outcome): void
    {
        $ip = $this->request->getIPAddress() ?: 'unknown';
        log_message(
            'info',
            'tk.lookup ip=' . hash('sha256', $ip) . ' code=' . hash('sha256', $code) . ' outcome=' . $outcome,
        );
    }

    private function isSaleWindowOpen(array $row): bool
    {
        $now = time();
        if (! empty($row['sale_window_from']) && strtotime((string) $row['sale_window_from']) > $now) {
            return false;
        }

        return ! (! empty($row['sale_window_to']) && strtotime((string) $row['sale_window_to']) < $now);
    }

    private function intOrNull(mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }

        return (int) $v;
    }

    private function stringOrNull(mixed $v, int $max): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }

        return mb_substr((string) $v, 0, $max);
    }

    private function parseDateTime(mixed $v): ?string
    {
        if (! $v) {
            return null;
        }
        $t = strtotime((string) $v);
        if ($t === false) {
            return null;
        }

        return date('Y-m-d H:i:s', $t);
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }

    private function phase2MigrationApplied(): bool
    {
        return $this->migrationApplied()
            && $this->db->tableExists('ticket_product_sessions')
            && $this->db->tableExists('ticket_product_tiers')
            && $this->db->tableExists('ticket_transfers');
    }

    private function phase3MigrationApplied(): bool
    {
        return $this->phase2MigrationApplied()
            && $this->db->tableExists('ticket_delivery_attempts')
            && $this->db->tableExists('ticket_product_translations');
    }

    // ---------- sessions CRUD ----------

    public function sessionIndex(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets sessions migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        try {
            $rows = $this->db->table('ticket_product_sessions')
                ->where('ticket_product_id', $productId)
                ->where('deleted', 0)
                ->orderBy('starts_at', 'ASC')
                ->get()
                ->getResultArray();
            $sessions = array_map(fn (array $r) => $this->decorateSession($r), $rows);

            return $this->respondSuccess(['sessions' => $sessions]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::sessionIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load sessions.', 500);
        }
    }

    public function sessionShow(int $productId, int $sessionId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets sessions migration is required.', 503);
        }
        $session = $this->loadSessionRow($productId, $sessionId);
        if ($session === null) {
            return $this->respondError('Session not found.', 404);
        }

        return $this->respondSuccess(['session' => $this->decorateSession($session)]);
    }

    public function sessionCreate(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets sessions migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validateSessionPayload($body, true);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $row = $this->buildSessionRow($body, $productId);
            $this->db->table('ticket_product_sessions')->insert($row);
            $newId = (int) $this->db->insertID();
            $fresh = $this->loadSessionRow($productId, $newId);

            return $this->respondSuccess(['session' => $fresh ? $this->decorateSession($fresh) : null], 'Session created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::sessionCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create session.', 500);
        }
    }

    public function sessionUpdate(int $productId, int $sessionId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets sessions migration is required.', 503);
        }
        if ($this->loadSessionRow($productId, $sessionId) === null) {
            return $this->respondError('Session not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validateSessionPayload($body, false);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $patch = $this->buildSessionRow($body, $productId);
            unset($patch['quantity_issued'], $patch['ticket_product_id']);
            $this->db->table('ticket_product_sessions')->where('session_id', $sessionId)->update($patch);
            $fresh = $this->loadSessionRow($productId, $sessionId);

            return $this->respondSuccess(['session' => $fresh ? $this->decorateSession($fresh) : null], 'Session updated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::sessionUpdate — ' . $e->getMessage());

            return $this->respondError('Failed to update session.', 500);
        }
    }

    public function sessionDelete(int $productId, int $sessionId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets sessions migration is required.', 503);
        }
        $existing = $this->loadSessionRow($productId, $sessionId);
        if ($existing === null) {
            return $this->respondError('Session not found.', 404);
        }

        try {
            $issued = (int) $existing['quantity_issued'];
            $this->db->table('ticket_product_sessions')->where('session_id', $sessionId)->update(['deleted' => 1]);
            $msg = $issued > 0
                ? "Session archived (still readable for {$issued} issued tickets)."
                : 'Session deleted.';

            return $this->respondSuccess(['session_id' => $sessionId, 'quantity_issued' => $issued], $msg);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::sessionDelete — ' . $e->getMessage());

            return $this->respondError('Failed to delete session.', 500);
        }
    }

    // ---------- tiers CRUD ----------

    public function tierIndex(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets tiers migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        try {
            $rows = $this->db->table('ticket_product_tiers')
                ->where('ticket_product_id', $productId)
                ->where('deleted', 0)
                ->orderBy('sort_order', 'ASC')
                ->orderBy('tier_id', 'ASC')
                ->get()
                ->getResultArray();
            $tiers = array_map(fn (array $r) => $this->decorateTier($r), $rows);

            return $this->respondSuccess(['tiers' => $tiers]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::tierIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load tiers.', 500);
        }
    }

    public function tierShow(int $productId, int $tierId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets tiers migration is required.', 503);
        }
        $tier = $this->loadTierRow($productId, $tierId);
        if ($tier === null) {
            return $this->respondError('Tier not found.', 404);
        }

        return $this->respondSuccess(['tier' => $this->decorateTier($tier)]);
    }

    public function tierCreate(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets tiers migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validateTierPayload($body, true);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $row = $this->buildTierRow($body, $productId);
            $this->db->table('ticket_product_tiers')->insert($row);
            $newId = (int) $this->db->insertID();
            $fresh = $this->loadTierRow($productId, $newId);

            return $this->respondSuccess(['tier' => $fresh ? $this->decorateTier($fresh) : null], 'Tier created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::tierCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create tier.', 500);
        }
    }

    public function tierUpdate(int $productId, int $tierId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets tiers migration is required.', 503);
        }
        if ($this->loadTierRow($productId, $tierId) === null) {
            return $this->respondError('Tier not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validateTierPayload($body, false);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $patch = $this->buildTierRow($body, $productId);
            unset($patch['quantity_issued'], $patch['ticket_product_id']);
            $this->db->table('ticket_product_tiers')->where('tier_id', $tierId)->update($patch);
            $fresh = $this->loadTierRow($productId, $tierId);

            return $this->respondSuccess(['tier' => $fresh ? $this->decorateTier($fresh) : null], 'Tier updated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::tierUpdate — ' . $e->getMessage());

            return $this->respondError('Failed to update tier.', 500);
        }
    }

    public function tierDelete(int $productId, int $tierId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets tiers migration is required.', 503);
        }
        $existing = $this->loadTierRow($productId, $tierId);
        if ($existing === null) {
            return $this->respondError('Tier not found.', 404);
        }

        try {
            $issued = (int) $existing['quantity_issued'];
            $this->db->table('ticket_product_tiers')->where('tier_id', $tierId)->update(['deleted' => 1]);
            $msg = $issued > 0
                ? "Tier archived (still referenced by {$issued} issued tickets)."
                : 'Tier deleted.';

            return $this->respondSuccess(['tier_id' => $tierId, 'quantity_issued' => $issued], $msg);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::tierDelete — ' . $e->getMessage());

            return $this->respondError('Failed to delete tier.', 500);
        }
    }

    // ---------- assign ----------

    public function ticketAssign(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }
        if ($this->loadTicketRow($id) === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        $body = $this->request->getJSON(true) ?? [];
        if (empty($body) || ! is_array($body)) {
            return $this->respondError('Assignment payload is empty.', 422);
        }

        $allowed = ['seat', 'row', 'zone', 'entrance', 'gate', 'hall', 'showtime', 'flight_no', 'pnr', 'session_id', 'tier_id', 'notes'];
        $patch   = [];

        foreach ($allowed as $k) {
            if (array_key_exists($k, $body)) {
                $patch[$k] = $body[$k];
            }
        }
        if ($patch === []) {
            return $this->respondError('No assignable fields supplied. Allowed: ' . implode(', ', $allowed), 422);
        }

        try {
            $this->db->transBegin();

            $ticketsTable = $this->db->prefixTable('tickets');
            $current      = $this->db->query(
                "SELECT seat_assignment_json, ticket_product_id, session_id, tier_id FROM {$ticketsTable} WHERE ticket_id = ? FOR UPDATE",
                [$id],
            )->getRowArray();
            $existing = $current['seat_assignment_json'] ? (array) json_decode((string) $current['seat_assignment_json'], true) : [];

            $sessionUpdate = null;
            $tierUpdate    = null;
            if (array_key_exists('session_id', $patch)) {
                $sid = $patch['session_id'] === null ? null : (int) $patch['session_id'];
                if ($sid !== null && $this->loadSessionRow((int) $current['ticket_product_id'], $sid) === null) {
                    $this->db->transRollback();

                    return $this->respondError('Session not found for this product.', 422);
                }
                $sessionUpdate = $sid;
                unset($patch['session_id']);
            }
            if (array_key_exists('tier_id', $patch)) {
                $tid = $patch['tier_id'] === null ? null : (int) $patch['tier_id'];
                if ($tid !== null && $this->loadTierRow((int) $current['ticket_product_id'], $tid) === null) {
                    $this->db->transRollback();

                    return $this->respondError('Tier not found for this product.', 422);
                }
                $tierUpdate = $tid;
                unset($patch['tier_id']);
            }

            foreach ($patch as $k => $v) {
                if ($v === null) {
                    unset($existing[$k]);
                } else {
                    $existing[$k] = $v;
                }
            }

            $update = ['seat_assignment_json' => json_encode($existing)];
            if ($sessionUpdate !== null || array_key_exists('session_id', $body)) {
                $update['session_id'] = $sessionUpdate;
            }
            if ($tierUpdate !== null || array_key_exists('tier_id', $body)) {
                $update['tier_id'] = $tierUpdate;
            }

            $this->db->table('tickets')->where('ticket_id', $id)->update($update);

            // Audit. ticket_redemptions.result enum doesn't include 'assigned'
            // so we use 'ok' + a typed note prefix.
            $this->db->table('ticket_redemptions')->insert([
                'ticket_id'   => $id,
                'employee_id' => $this->session->get('person_id'),
                'result'      => 'ok',
                'notes'       => mb_substr('assigned:' . json_encode($patch + array_filter([
                    'session_id' => $sessionUpdate,
                    'tier_id'    => $tierUpdate,
                ], static fn ($v) => $v !== null), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 0, 255),
            ]);

            if (! $this->db->transCommit()) {
                return $this->respondError('Failed to assign ticket.', 500);
            }

            $fresh = $this->loadTicketRow($id);

            return $this->respondSuccess(['ticket' => $fresh ? $this->decorateTicket($fresh) : null], 'Ticket assigned.');
        } catch (Throwable $e) {
            try {
                $this->db->transRollback();
            } catch (Throwable $ignore) {
            }
            log_message('error', 'TicketsController::ticketAssign — ' . $e->getMessage());

            return $this->respondError('Failed to assign ticket.', 500);
        }
    }

    // ---------- public transfer (two-step) ----------

    public function ticketTransferRequest(string $code): ResponseInterface
    {
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets transfers migration is required.', 503);
        }
        if (! $this->publicRateLimit('ticket_transfer', 10, 60)) {
            return $this->respondError('Too many transfer attempts.', 429);
        }
        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->respondError('Invalid ticket code.', 422);
        }

        $body           = $this->request->getJSON(true) ?? [];
        $toEmail        = trim((string) ($body['to_email'] ?? ''));
        $toPhone        = trim((string) ($body['to_phone'] ?? ''));
        $idempotencyKey = mb_substr((string) ($body['idempotency_key'] ?? bin2hex(random_bytes(8))), 0, 64);

        if ($toEmail === '' && $toPhone === '') {
            return $this->respondError('to_email or to_phone is required.', 422);
        }
        if ($toEmail !== '' && ! filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('to_email is not a valid email address.', 422);
        }
        $channel = $toEmail !== '' ? 'email' : 'sms';
        $contact = $toEmail !== '' ? strtolower($toEmail) : preg_replace('/\s+/', '', $toPhone);

        try {
            $ticket = $this->db->table('tickets')->where('code', $normalized)->where('deleted', 0)->get()->getRowArray();
            if ($ticket === null) {
                return $this->respondError('Ticket not found.', 404);
            }

            $product = $this->loadProductRow((int) $ticket['ticket_product_id']);
            if ($product === null) {
                return $this->respondError('Ticket product not found.', 404);
            }
            if ((int) $product['transferable'] !== 1) {
                return $this->respondError('This ticket is not transferable.', 409);
            }
            if (! in_array((string) $ticket['status'], ['issued', 'active'], true)) {
                return $this->respondError('Ticket cannot be transferred in its current state.', 409);
            }

            $cap  = (int) $this->getAppConfig('ticket_transfer_max_per_ticket', '5');
            $done = (int) $this->db->table('ticket_transfers')
                ->where('ticket_id', $ticket['ticket_id'])
                ->where('verified_at IS NOT NULL', null, false)
                ->countAllResults();
            if ($done >= $cap) {
                return $this->respondError("Transfer cap reached ({$cap}).", 409);
            }

            $prior = $this->db->table('ticket_transfers')
                ->where('ticket_id', $ticket['ticket_id'])
                ->where('client_idempotency_key', $idempotencyKey)
                ->get()
                ->getRowArray();
            if ($prior !== null) {
                return $this->respondSuccess([
                    'transfer_id'        => (int) $prior['transfer_id'],
                    'channel'            => (string) $prior['channel'],
                    'expires_at'         => $prior['verification_expires_at'],
                    'verification_token' => null,
                    'message'            => 'Existing transfer request returned.',
                ]);
            }

            $token   = strtoupper(bin2hex(random_bytes(4)));
            $ttlMin  = max(1, (int) $this->getAppConfig('ticket_transfer_verify_ttl_min', '15'));
            $expires = (new DateTimeImmutable())->modify("+{$ttlMin} minutes");

            $this->db->table('ticket_transfers')->insert([
                'ticket_id'               => (int) $ticket['ticket_id'],
                'from_contact_hash'       => null,
                'to_contact_hash'         => $this->hashContact($contact),
                'to_contact_last4'        => mb_substr($contact, -4),
                'channel'                 => $channel,
                'verification_token_hash' => hash('sha256', $token),
                'verification_sent_at'    => date('Y-m-d H:i:s'),
                'verification_expires_at' => $expires->format('Y-m-d H:i:s'),
                'verified_at'             => null,
                'ip'                      => $this->request->getIPAddress() ?: null,
                'user_agent'              => mb_substr((string) $this->request->getUserAgent(), 0, 255),
                'client_idempotency_key'  => $idempotencyKey,
            ]);
            $transferId  = (int) $this->db->insertID();
            $inlineToken = $this->getAppConfig('ticket_transfer_inline_token', '0') === '1';

            return $this->respondSuccess([
                'transfer_id'        => $transferId,
                'channel'            => $channel,
                'expires_at'         => $expires->format('c'),
                'verification_token' => $inlineToken ? $token : null,
                'message'            => $inlineToken
                    ? 'Transfer requested. Token returned inline (dev mode).'
                    : 'Transfer requested. Verification token sent.',
            ], 'Transfer requested.', 202);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketTransferRequest — ' . $e->getMessage());

            return $this->respondError('Failed to request transfer.', 500);
        }
    }

    public function ticketTransferConfirm(string $code): ResponseInterface
    {
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Tickets transfers migration is required.', 503);
        }
        if (! $this->publicRateLimit('ticket_transfer_confirm', 30, 60)) {
            return $this->respondError('Too many confirmation attempts.', 429);
        }
        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->respondError('Invalid ticket code.', 422);
        }

        $body       = $this->request->getJSON(true) ?? [];
        $transferId = (int) ($body['transfer_id'] ?? 0);
        $token      = strtoupper(trim((string) ($body['verification_token'] ?? '')));
        if ($transferId <= 0 || $token === '') {
            return $this->respondError('transfer_id and verification_token are required.', 422);
        }

        try {
            $this->db->transBegin();

            $ticket = $this->db->table('tickets')->where('code', $normalized)->where('deleted', 0)->get()->getRowArray();
            if ($ticket === null) {
                $this->db->transRollback();

                return $this->respondError('Ticket not found.', 404);
            }

            $transfer = $this->db->table('ticket_transfers')
                ->where('transfer_id', $transferId)
                ->where('ticket_id', $ticket['ticket_id'])
                ->get()
                ->getRowArray();
            if ($transfer === null) {
                $this->db->transRollback();

                return $this->respondError('Transfer request not found.', 404);
            }
            if (! empty($transfer['verified_at'])) {
                $this->db->transRollback();

                return $this->respondError('Transfer already completed.', 409);
            }
            if (! empty($transfer['verification_expires_at']) && strtotime((string) $transfer['verification_expires_at']) < time()) {
                $this->db->transRollback();

                return $this->respondError('Verification token expired.', 410);
            }
            if (! hash_equals((string) $transfer['verification_token_hash'], hash('sha256', $token))) {
                $this->db->transRollback();

                return $this->respondError('Verification token is incorrect.', 422);
            }

            $this->db->table('ticket_transfers')->where('transfer_id', $transferId)->update(['verified_at' => date('Y-m-d H:i:s')]);

            $history = ! empty($ticket['transfer_history_json'])
                ? (array) json_decode((string) $ticket['transfer_history_json'], true)
                : [];
            $history[] = [
                'type'        => 'transfer',
                'transfer_id' => $transferId,
                'channel'     => (string) $transfer['channel'],
                'to_last4'    => (string) $transfer['to_contact_last4'],
                'at'          => date('c'),
            ];
            $this->db->table('tickets')->where('ticket_id', $ticket['ticket_id'])->update([
                'transfer_history_json' => json_encode($history),
                'customer_id'           => null,
            ]);

            if (! $this->db->transCommit()) {
                return $this->respondError('Failed to confirm transfer.', 500);
            }

            return $this->respondSuccess([
                'transfer_id' => $transferId,
                'channel'     => (string) $transfer['channel'],
                'to_last4'    => (string) $transfer['to_contact_last4'],
                'message'     => 'Transfer completed.',
            ], 'Transfer completed.');
        } catch (Throwable $e) {
            try {
                $this->db->transRollback();
            } catch (Throwable $ignore) {
            }
            log_message('error', 'TicketsController::ticketTransferConfirm — ' . $e->getMessage());

            return $this->respondError('Failed to confirm transfer.', 500);
        }
    }

    // ========================================================================
    // Phase 3 — translations, delivery, iCal, Apple/Google Wallet
    // ========================================================================

    // ---------- translations CRUD ----------

    public function translationIndex(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Tickets translations migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        try {
            $rows = $this->db->table('ticket_product_translations')
                ->where('ticket_product_id', $productId)
                ->orderBy('locale', 'ASC')
                ->get()
                ->getResultArray();

            return $this->respondSuccess(['translations' => $rows]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::translationIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load translations.', 500);
        }
    }

    public function translationUpsert(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Tickets translations migration is required.', 503);
        }
        if ($this->loadProductRow($productId) === null) {
            return $this->respondError('Ticket product not found.', 404);
        }

        $body   = $this->request->getJSON(true) ?? [];
        $locale = trim((string) ($body['locale'] ?? ''));
        if (! preg_match('/^[a-zA-Z]{2,3}([_-][a-zA-Z]{2,4})?$/', $locale)) {
            return $this->respondError('locale must be an IETF tag like en, en-US, zh-CN.', 422);
        }

        try {
            $this->db->table('ticket_product_translations')->replace([
                'ticket_product_id' => $productId,
                'locale'            => $locale,
                'title'             => $this->stringOrNull($body['title'] ?? null, 255),
                'notice'            => $this->stringOrNull($body['notice'] ?? null, 255),
                'description'       => $body['description'] ?? null,
            ]);
            $row = $this->db->table('ticket_product_translations')
                ->where('ticket_product_id', $productId)
                ->where('locale', $locale)
                ->get()
                ->getRowArray();

            return $this->respondSuccess(['translation' => $row], 'Translation saved.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::translationUpsert — ' . $e->getMessage());

            return $this->respondError('Failed to save translation.', 500);
        }
    }

    public function translationDelete(int $productId, string $locale): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Tickets translations migration is required.', 503);
        }

        try {
            $this->db->table('ticket_product_translations')
                ->where('ticket_product_id', $productId)
                ->where('locale', $locale)
                ->delete();

            return $this->respondSuccess(['locale' => $locale], 'Translation removed.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::translationDelete — ' . $e->getMessage());

            return $this->respondError('Failed to remove translation.', 500);
        }
    }

    // ---------- resend delivery ----------

    public function ticketResendDelivery(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Tickets delivery migration is required.', 503);
        }

        $body  = $this->request->getJSON(true) ?? [];
        $email = trim((string) ($body['email'] ?? ''));
        $phone = trim((string) ($body['phone'] ?? ''));
        if ($email === '' && $phone === '') {
            return $this->respondError('email or phone is required.', 422);
        }
        if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondError('Invalid email.', 422);
        }

        $row = $this->db->table('tickets')
            ->select('tickets.*, ticket_products.title, ticket_products.brand_name, ticket_products.notice')
            ->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left')
            ->where('ticket_id', $id)
            ->where('tickets.deleted', 0)
            ->get()
            ->getRow();
        if ($row === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        try {
            $result = service('ticket_delivery_lib')->dispatch($row, $email !== '' ? $email : null, $phone !== '' ? $phone : null);

            return $this->respondSuccess(['delivery' => $result], 'Delivery dispatched.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketResendDelivery — ' . $e->getMessage());

            return $this->respondError('Failed to dispatch delivery: ' . $e->getMessage(), 500);
        }
    }

    // ---------- public iCal + wallet ----------

    public function publicTicketIcs(string $code): ResponseInterface
    {
        if (! $this->publicRateLimit('ticket_ics', 60, 60)) {
            return $this->respondError('Too many requests.', 429);
        }
        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->respondError('Invalid ticket code.', 422);
        }

        $row = $this->loadPublicTicketWithProduct($normalized);
        if ($row === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        $ics = $this->buildIcs($row, $normalized);

        return $this->response
            ->setHeader('Content-Type', 'text/calendar; charset=utf-8')
            ->setHeader('Content-Disposition', 'attachment; filename="' . $normalized . '.ics"')
            ->setBody($ics);
    }

    public function publicTicketGoogleWallet(string $code): ResponseInterface
    {
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Wallet endpoints require Phase 3 migration.', 503);
        }
        if (! $this->publicRateLimit('ticket_gwallet', 30, 60)) {
            return $this->respondError('Too many requests.', 429);
        }

        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->respondError('Invalid ticket code.', 422);
        }

        $row = $this->loadPublicTicketWithProduct($normalized);
        if ($row === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        try {
            $product = (object) [
                'ticket_product_id' => $row->ticket_product_id,
                'title'             => $row->title,
                'brand_name'        => $row->brand_name,
                'color'             => $row->color ?? null,
            ];
            $redemptionUrl = service('qr_lib')->build_redemption_url($normalized);
            $saveUrl       = service('google_wallet_lib')->buildSaveUrl($row, $product, $redemptionUrl);

            return $this->respondSuccess(['save_url' => $saveUrl], 'Google Wallet save URL generated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::publicTicketGoogleWallet — ' . $e->getMessage());

            return $this->respondError($e->getMessage(), 503);
        }
    }

    public function publicTicketAppleWallet(string $code): ResponseInterface
    {
        if (! $this->phase3MigrationApplied()) {
            return $this->respondError('Wallet endpoints require Phase 3 migration.', 503);
        }
        if (! $this->publicRateLimit('ticket_apple', 30, 60)) {
            return $this->respondError('Too many requests.', 429);
        }

        $normalized = strtoupper(trim($code));
        if (! preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->respondError('Invalid ticket code.', 422);
        }

        $row = $this->loadPublicTicketWithProduct($normalized);
        if ($row === null) {
            return $this->respondError('Ticket not found.', 404);
        }

        try {
            $product = (object) [
                'ticket_product_id' => $row->ticket_product_id,
                'title'             => $row->title,
                'brand_name'        => $row->brand_name,
                'color'             => $row->color ?? null,
            ];
            $redemptionUrl = service('qr_lib')->build_redemption_url($normalized);
            $pkpass        = service('apple_pkpass_lib')->build($row, $product, $redemptionUrl);

            return $this->response
                ->setHeader('Content-Type', 'application/vnd.apple.pkpass')
                ->setHeader('Content-Disposition', 'attachment; filename="' . $normalized . '.pkpass"')
                ->setBody($pkpass);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::publicTicketAppleWallet — ' . $e->getMessage());

            return $this->respondError($e->getMessage(), 503);
        }
    }

    // ========================================================================
    // Phase 2 + 3 helpers
    // ========================================================================

    private function loadSessionRow(int $productId, int $sessionId): ?array
    {
        $row = $this->db->table('ticket_product_sessions')
            ->where('session_id', $sessionId)
            ->where('ticket_product_id', $productId)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();

        return $row ?: null;
    }

    private function loadTierRow(int $productId, int $tierId): ?array
    {
        $row = $this->db->table('ticket_product_tiers')
            ->where('tier_id', $tierId)
            ->where('ticket_product_id', $productId)
            ->where('deleted', 0)
            ->get()
            ->getRowArray();

        return $row ?: null;
    }

    private function decorateSession(array $row): array
    {
        $quantity                 = $row['quantity'] === null ? null : (int) $row['quantity'];
        $issued                   = (int) ($row['quantity_issued'] ?? 0);
        $row['session_id']        = (int) $row['session_id'];
        $row['ticket_product_id'] = (int) $row['ticket_product_id'];
        $row['quantity']          = $quantity;
        $row['quantity_issued']   = $issued;
        $row['remaining']         = $quantity === null ? null : max(0, $quantity - $issued);
        $row['sold_out']          = $quantity !== null && $issued >= $quantity;

        return $row;
    }

    private function decorateTier(array $row): array
    {
        $quantity                 = $row['quantity'] === null ? null : (int) $row['quantity'];
        $issued                   = (int) ($row['quantity_issued'] ?? 0);
        $row['tier_id']           = (int) $row['tier_id'];
        $row['ticket_product_id'] = (int) $row['ticket_product_id'];
        $row['quantity']          = $quantity;
        $row['quantity_issued']   = $issued;
        $row['remaining']         = $quantity === null ? null : max(0, $quantity - $issued);
        $row['sold_out']          = $quantity !== null && $issued >= $quantity;
        $row['price']             = (string) $row['price'];

        return $row;
    }

    private function validateSessionPayload(array $body, bool $isCreate): string|true
    {
        if ($isCreate || array_key_exists('starts_at', $body)) {
            $startsAt = $this->parseDateTime($body['starts_at'] ?? null);
            if ($isCreate && $startsAt === null) {
                return 'starts_at is required.';
            }
            if (array_key_exists('ends_at', $body) && ! empty($body['ends_at'])) {
                $endsAt = $this->parseDateTime($body['ends_at']);
                if ($endsAt === null) {
                    return 'ends_at is invalid.';
                }
                if ($startsAt !== null && strtotime($endsAt) < strtotime($startsAt)) {
                    return 'ends_at must be after starts_at.';
                }
            }
        }
        if (isset($body['quantity']) && $body['quantity'] !== null && (int) $body['quantity'] < 0) {
            return 'quantity must be a non-negative integer or null.';
        }
        if (isset($body['status']) && ! in_array((string) $body['status'], self::ALLOWED_SESSION_STATUSES, true)) {
            return 'status must be one of: ' . implode(', ', self::ALLOWED_SESSION_STATUSES);
        }

        return true;
    }

    private function buildSessionRow(array $body, int $productId): array
    {
        $row = [
            'ticket_product_id' => $productId,
            'label'             => $this->stringOrNull($body['label'] ?? null, 255),
            'starts_at'         => $this->parseDateTime($body['starts_at'] ?? null),
            'ends_at'           => $this->parseDateTime($body['ends_at'] ?? null),
            'quantity'          => $this->intOrNull($body['quantity'] ?? null),
            'hall'              => $this->stringOrNull($body['hall'] ?? null, 128),
            'gate'              => $this->stringOrNull($body['gate'] ?? null, 128),
            'status'            => isset($body['status']) && in_array((string) $body['status'], self::ALLOWED_SESSION_STATUSES, true)
                ? (string) $body['status']
                : 'scheduled',
        ];
        if (array_key_exists('seat_map', $body)) {
            $row['seat_map_json'] = is_array($body['seat_map']) ? json_encode($body['seat_map']) : null;
        }

        return $row;
    }

    private function validateTierPayload(array $body, bool $isCreate): string|true
    {
        if ($isCreate) {
            $name = trim((string) ($body['name'] ?? ''));
            if ($name === '') {
                return 'name is required.';
            }
        }
        if (isset($body['name']) && mb_strlen((string) $body['name']) > 128) {
            return 'name is too long (max 128).';
        }
        if (isset($body['price']) && ! $this->isValidMoney((string) $body['price'])) {
            return 'price must be a non-negative decimal with up to 2 places.';
        }
        if (isset($body['quantity']) && $body['quantity'] !== null && (int) $body['quantity'] < 0) {
            return 'quantity must be a non-negative integer or null.';
        }

        return true;
    }

    private function buildTierRow(array $body, int $productId): array
    {
        return [
            'ticket_product_id' => $productId,
            'name'              => mb_substr((string) ($body['name'] ?? ''), 0, 128),
            'price'             => $this->parseMoney($body['price'] ?? '0') ?? '0.00',
            'quantity'          => $this->intOrNull($body['quantity'] ?? null),
            'sort_order'        => (int) ($body['sort_order'] ?? 0),
            'color'             => $this->stringOrNull($body['color'] ?? null, 16),
            'description'       => $this->stringOrNull($body['description'] ?? null, 255),
        ];
    }

    private function isValidMoney(string $v): bool
    {
        return preg_match('/^\d+(\.\d{1,2})?$/', trim($v)) === 1;
    }

    private function parseMoney(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return '0.00';
        }
        $s = is_string($v) ? trim($v) : (string) $v;
        $s = str_replace([' ', ','], ['', '.'], $s);
        if (! $this->isValidMoney($s)) {
            return null;
        }

        return bcadd($s, '0', 2);
    }

    private function hashContact(string $contact): string
    {
        $secret = $this->getAppConfig('ticket_transfer_hmac_secret', '');
        if ($secret === '') {
            $secret = 'ticket-transfer-fallback-' . hash('sha256', __FILE__);
        }

        return hash_hmac('sha256', strtolower(trim($contact)), $secret);
    }

    private function getAppConfig(string $key, string $default = ''): string
    {
        try {
            $row = $this->db->table('app_config')->where('key', $key)->get()->getRowArray();

            return $row !== null ? (string) $row['value'] : $default;
        } catch (Throwable $e) {
            return $default;
        }
    }

    private function loadPublicTicketWithProduct(string $code): ?object
    {
        $row = $this->db->table('tickets')
            ->select('tickets.*, ticket_products.title, ticket_products.brand_name, ticket_products.color, ticket_products.notice, ticket_products.description AS product_description')
            ->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left')
            ->where('code', $code)
            ->where('tickets.deleted', 0)
            ->get()
            ->getRow();

        return $row ?: null;
    }

    private function buildIcs(object $row, string $code): string
    {
        $dtFmt = static function (?string $iso): string {
            if ($iso === null || $iso === '') {
                return '';
            }
            $ts = strtotime($iso);
            if ($ts === false) {
                return '';
            }

            return gmdate('Ymd\THis\Z', $ts);
        };
        $esc = static fn (string $s): string => str_replace(['\\', "\n", ',', ';'], ['\\\\', '\\n', '\\,', '\\;'], $s);

        $start = $dtFmt($row->valid_from ?? null);
        $end   = $dtFmt(($row->valid_to ?? null) ?: ($row->valid_from ?? null));
        $title = (string) ($row->title ?? 'Ticket');
        $desc  = (string) ($row->product_description ?? $row->notice ?? '');

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Pesaswap//Tickets//EN',
            'BEGIN:VEVENT',
            'UID:' . $code . '@pesaswap',
            'DTSTAMP:' . gmdate('Ymd\THis\Z'),
        ];
        if ($start !== '') {
            $lines[] = 'DTSTART:' . $start;
        }
        if ($end !== '') {
            $lines[] = 'DTEND:' . $end;
        }
        $lines[] = 'SUMMARY:' . $esc($title);
        if ($desc !== '') {
            $lines[] = 'DESCRIPTION:' . $esc($desc);
        }
        $lines[] = 'END:VEVENT';
        $lines[] = 'END:VCALENDAR';

        return implode("\r\n", $lines) . "\r\n";
    }

    // ========================================================================
    // Phase 4 — scanner devices, dashboard, bulk-issue
    // ========================================================================

    private function phase4MigrationApplied(): bool
    {
        return $this->phase2MigrationApplied()
            && $this->db->tableExists('ticket_scanner_devices');
    }

    public function scannerDeviceIndex(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase4MigrationApplied()) {
            return $this->respondError('Scanner devices migration is required.', 503);
        }

        try {
            $rows = $this->db->table('ticket_scanner_devices')
                ->select('device_id, label, scope_location_ids, scope_product_ids, created_by_employee_id, created_at, last_seen_at, last_seen_ip, revoked_at, revoked_reason')
                ->orderBy('revoked_at', 'ASC')
                ->orderBy('device_id', 'DESC')
                ->limit(200)
                ->get()
                ->getResultArray();

            return $this->respondSuccess(['devices' => array_map(fn (array $r) => $this->decorateDevice($r), $rows)]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::scannerDeviceIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load scanner devices.', 500);
        }
    }

    /**
     * Mint a long-lived RS256 JWT for a new gate scanner device. The
     * token is returned exactly once — the server only stores the jti
     * (so it can be revoked by setting revoked_at without invalidating
     * other devices' tokens) plus the optional scope claims.
     */
    public function scannerDeviceCreate(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase4MigrationApplied()) {
            return $this->respondError('Scanner devices migration is required.', 503);
        }

        $body  = $this->request->getJSON(true) ?? [];
        $label = trim((string) ($body['label'] ?? ''));
        if ($label === '') {
            return $this->respondError('label is required.', 422);
        }
        if (mb_strlen($label) > 128) {
            return $this->respondError('label is too long.', 422);
        }

        $locationIds = $this->sanitiseIdList($body['scope_location_ids'] ?? []);
        $productIds  = $this->sanitiseIdList($body['scope_product_ids'] ?? []);
        $ttlDays     = max(1, min(365 * 2, (int) ($body['ttl_days'] ?? 90)));

        try {
            $jti = bin2hex(random_bytes(16));

            $this->db->table('ticket_scanner_devices')->insert([
                'label'                  => mb_substr($label, 0, 128),
                'jti'                    => $jti,
                'scope_location_ids'     => $locationIds === [] ? null : implode(',', $locationIds),
                'scope_product_ids'      => $productIds === [] ? null : implode(',', $productIds),
                'created_by_employee_id' => $this->session->get('person_id'),
            ]);
            $deviceId = (int) $this->db->insertID();

            $tokenLib = service('ticket_token_lib');
            $expAt    = (new DateTimeImmutable())->modify("+{$ttlDays} days");
            // Re-uses the RS256 issuer with custom claims under "scanner".
            $token = $tokenLib->issueScanner($deviceId, $jti, $locationIds, $productIds, $expAt);

            $row = $this->db->table('ticket_scanner_devices')->where('device_id', $deviceId)->get()->getRowArray();

            return $this->respondSuccess([
                'device' => $this->decorateDevice($row),
                'token'  => $token,
                'note'   => 'This token is shown only once. Configure the scanner with it now.',
            ], 'Scanner device created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::scannerDeviceCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create scanner device.', 500);
        }
    }

    public function scannerDeviceRevoke(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase4MigrationApplied()) {
            return $this->respondError('Scanner devices migration is required.', 503);
        }

        $body   = $this->request->getJSON(true) ?? [];
        $reason = mb_substr(trim((string) ($body['reason'] ?? '')), 0, 255);

        try {
            $existing = $this->db->table('ticket_scanner_devices')->where('device_id', $id)->get()->getRowArray();
            if ($existing === null) {
                return $this->respondError('Scanner device not found.', 404);
            }
            if (! empty($existing['revoked_at'])) {
                return $this->respondError('Scanner device already revoked.', 409);
            }

            $this->db->table('ticket_scanner_devices')->where('device_id', $id)->update([
                'revoked_at'     => date('Y-m-d H:i:s'),
                'revoked_reason' => $reason !== '' ? $reason : 'Manual revocation',
            ]);

            return $this->respondSuccess(['device_id' => $id], 'Scanner device revoked.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::scannerDeviceRevoke — ' . $e->getMessage());

            return $this->respondError('Failed to revoke device.', 500);
        }
    }

    /**
     * Live gate dashboard. Per-product (and optionally per-session)
     * counts: issued, redeemed, refunded, revoked, expired, scan
     * velocity (last 5 min), no-show estimate.
     */
    public function ticketDashboard(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase2MigrationApplied()) {
            return $this->respondError('Phase 2 migration is required.', 503);
        }

        $productId = (int) ($this->request->getGet('ticket_product_id') ?? 0);
        $sessionId = (int) ($this->request->getGet('session_id') ?? 0);

        try {
            $ticketsTable = $this->db->prefixTable('tickets');

            $where  = ['t.deleted = 0'];
            $params = [];
            if ($productId > 0) {
                $where[]  = 't.ticket_product_id = ?';
                $params[] = $productId;
            }
            if ($sessionId > 0) {
                $where[]  = 't.session_id = ?';
                $params[] = $sessionId;
            }
            $whereSql = implode(' AND ', $where);

            $totals = $this->db->query(
                "SELECT
                    SUM(CASE WHEN t.status = 'issued' THEN 1 ELSE 0 END) AS issued,
                    SUM(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN t.status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed,
                    SUM(CASE WHEN t.status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
                    SUM(CASE WHEN t.status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
                    SUM(CASE WHEN t.status = 'expired' THEN 1 ELSE 0 END) AS expired,
                    COUNT(*) AS total
                 FROM {$ticketsTable} t
                 WHERE {$whereSql}",
                $params,
            )->getRowArray() ?? [];

            $redemptionsTable = $this->db->prefixTable('ticket_redemptions');
            $velocity         = $this->db->query(
                "SELECT COUNT(*) AS scans_5m
                 FROM {$redemptionsTable} r
                 JOIN {$ticketsTable} t ON t.ticket_id = r.ticket_id
                 WHERE r.result = 'ok'
                   AND r.occurred_at >= (NOW() - INTERVAL 5 MINUTE)
                   AND {$whereSql}",
                $params,
            )->getRowArray() ?? ['scans_5m' => 0];

            $issued   = (int) ($totals['issued'] ?? 0) + (int) ($totals['active'] ?? 0);
            $redeemed = (int) ($totals['redeemed'] ?? 0);
            $refunded = (int) ($totals['refunded'] ?? 0);
            $revoked  = (int) ($totals['revoked'] ?? 0);
            $expired  = (int) ($totals['expired'] ?? 0);
            $total    = (int) ($totals['total'] ?? 0);
            // No-show estimate: tickets that were sold but never scanned, refunded or revoked.
            // total - redeemed - refunded - revoked - expired = issued + active (still un-used).
            $noShow         = max(0, $total - $redeemed - $refunded - $revoked - $expired);
            $eligible       = max(0, $total - $refunded - $revoked);
            $redemptionRate = $eligible > 0 ? round(($redeemed / $eligible) * 100, 1) : 0.0;

            return $this->respondSuccess([
                'totals' => [
                    'issued'   => (int) ($totals['issued'] ?? 0),
                    'active'   => (int) ($totals['active'] ?? 0),
                    'redeemed' => $redeemed,
                    'refunded' => $refunded,
                    'revoked'  => $revoked,
                    'expired'  => $expired,
                    'total'    => $total,
                ],
                'scans_per_5min'   => (int) ($velocity['scans_5m'] ?? 0),
                'no_show_estimate' => $noShow,
                'redemption_rate'  => $redemptionRate,
                'as_of'            => date('c'),
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketDashboard — ' . $e->getMessage());

            return $this->respondError('Failed to load dashboard.', 500);
        }
    }

    /**
     * Bulk-issue from a JSON array of { ticket_product_id, session_id?,
     * tier_id?, customer_id?, seat_assignment?, issuance_reason }.
     * Each row is issued in its own short transaction so a single
     * sold-out / invalid row doesn't poison the whole batch — the
     * response lists per-row outcomes (ok vs error message).
     */
    public function ticketBulkIssue(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $rows = $body['rows'] ?? null;
        if (! is_array($rows) || $rows === []) {
            return $this->respondError('rows[] is required (array of issue payloads).', 422);
        }
        if (count($rows) > 500) {
            return $this->respondError('Batch size limit is 500 rows per request.', 422);
        }

        $results = [];
        $okCount = 0;

        foreach ($rows as $idx => $payload) {
            if (! is_array($payload)) {
                $results[] = ['index' => $idx, 'status' => 'error', 'message' => 'Row is not an object'];

                continue;
            }
            $payload['issuance_reason'] = (string) ($payload['issuance_reason'] ?? 'comp');
            // Use the existing single-issue path to keep all invariants
            // (atomic counter UPDATE, validation, audit) consistent.
            $fakeRequest = $this->request;
            $original    = $fakeRequest->getBody();
            $fakeRequest->setBody(json_encode($payload));
            $response = $this->ticketIssue();
            $fakeRequest->setBody($original);

            $code = $response->getStatusCode();
            $json = json_decode((string) $response->getBody(), true);
            if ($code >= 200 && $code < 300) {
                $okCount++;
                $results[] = [
                    'index'     => $idx,
                    'status'    => 'ok',
                    'ticket_id' => $json['data']['ticket']['ticket_id'] ?? null,
                    'code'      => $json['data']['ticket']['code'] ?? null,
                ];
            } else {
                $results[] = [
                    'index'   => $idx,
                    'status'  => 'error',
                    'http'    => $code,
                    'message' => $json['message'] ?? 'Issuance failed',
                ];
            }
        }

        return $this->respondSuccess([
            'ok_count'    => $okCount,
            'error_count' => count($rows) - $okCount,
            'results'     => $results,
        ], 'Bulk issuance complete.');
    }

    private function decorateDevice(array $row): array
    {
        return [
            'device_id'              => (int) $row['device_id'],
            'label'                  => (string) $row['label'],
            'scope_location_ids'     => $this->csvToIntList((string) ($row['scope_location_ids'] ?? '')),
            'scope_product_ids'      => $this->csvToIntList((string) ($row['scope_product_ids'] ?? '')),
            'created_by_employee_id' => $row['created_by_employee_id'] !== null ? (int) $row['created_by_employee_id'] : null,
            'created_at'             => (string) $row['created_at'],
            'last_seen_at'           => $row['last_seen_at'],
            'last_seen_ip'           => $row['last_seen_ip'],
            'revoked_at'             => $row['revoked_at'] ?? null,
            'revoked_reason'         => $row['revoked_reason'] ?? null,
            'active'                 => empty($row['revoked_at']),
        ];
    }

    private function sanitiseIdList(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $out = [];

        foreach ($raw as $v) {
            $i = (int) $v;
            if ($i > 0) {
                $out[] = $i;
            }
        }

        return array_values(array_unique($out));
    }

    private function csvToIntList(string $csv): array
    {
        if ($csv === '') {
            return [];
        }

        return array_values(array_filter(array_map(static fn ($v) => (int) trim($v), explode(',', $csv)), static fn ($v) => $v > 0));
    }

    // ========================================================================
    // Phase 5 — promo codes, bundles, seat holds, reports
    // ========================================================================

    private function phase5MigrationApplied(): bool
    {
        return $this->phase2MigrationApplied()
            && $this->db->tableExists('ticket_promo_codes')
            && $this->db->tableExists('ticket_product_bundles')
            && $this->db->tableExists('ticket_seat_holds');
    }

    // ---------- promo codes ----------

    public function promoIndex(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        try {
            $rows = $this->db->table('ticket_promo_codes')
                ->where('deleted', 0)
                ->orderBy('code_id', 'DESC')
                ->limit(200)
                ->get()
                ->getResultArray();

            return $this->respondSuccess(['promos' => array_map(fn (array $r) => $this->decoratePromo($r), $rows)]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::promoIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load promo codes.', 500);
        }
    }

    public function promoCreate(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validatePromoPayload($body, true);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $row = $this->buildPromoRow($body);
            $this->db->table('ticket_promo_codes')->insert($row);
            $id    = (int) $this->db->insertID();
            $fresh = $this->db->table('ticket_promo_codes')->where('code_id', $id)->get()->getRowArray();

            return $this->respondSuccess(['promo' => $fresh ? $this->decoratePromo($fresh) : null], 'Promo code created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::promoCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create promo code.', 500);
        }
    }

    public function promoUpdate(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $err  = $this->validatePromoPayload($body, false);
        if (is_string($err)) {
            return $this->respondError($err, 422);
        }

        try {
            $patch = $this->buildPromoRow($body);
            unset($patch['used_count']);
            $this->db->table('ticket_promo_codes')->where('code_id', $id)->update($patch);
            $fresh = $this->db->table('ticket_promo_codes')->where('code_id', $id)->get()->getRowArray();

            return $this->respondSuccess(['promo' => $fresh ? $this->decoratePromo($fresh) : null], 'Promo code updated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::promoUpdate — ' . $e->getMessage());

            return $this->respondError('Failed to update promo code.', 500);
        }
    }

    public function promoDelete(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        try {
            $this->db->table('ticket_promo_codes')->where('code_id', $id)->update(['deleted' => 1]);

            return $this->respondSuccess(['code_id' => $id], 'Promo code archived.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::promoDelete — ' . $e->getMessage());

            return $this->respondError('Failed to delete promo code.', 500);
        }
    }

    /**
     * Dry-run promo validation. Body: { code, product_id?, tier_id?, amount? }
     * Returns: { valid, reason?, discount_pct, discount_flat, applied_amount }
     */
    public function promoValidate(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        $body      = $this->request->getJSON(true) ?? [];
        $code      = strtoupper(trim((string) ($body['code'] ?? '')));
        $productId = (int) ($body['product_id'] ?? 0);
        $tierId    = (int) ($body['tier_id'] ?? 0);
        $amount    = $this->parseMoney($body['amount'] ?? '0');
        if ($code === '') {
            return $this->respondError('code is required.', 422);
        }

        $promo = $this->db->table('ticket_promo_codes')->where('code', $code)->where('deleted', 0)->get()->getRowArray();
        if ($promo === null) {
            return $this->respondSuccess(['valid' => false, 'reason' => 'not_found']);
        }

        $check = $this->checkPromoEligibility($promo, $productId, $tierId, $amount);
        if ($check !== null) {
            return $this->respondSuccess(['valid' => false, 'reason' => $check]);
        }

        $applied = $this->computePromoAmount($promo, $amount ?? '0.00');

        return $this->respondSuccess([
            'valid'          => true,
            'code_id'        => (int) $promo['code_id'],
            'discount_pct'   => $promo['discount_pct'],
            'discount_flat'  => $promo['discount_flat'],
            'currency'       => $promo['currency'],
            'applied_amount' => $applied,
            'remaining_uses' => $promo['max_uses'] !== null ? max(0, (int) $promo['max_uses'] - (int) $promo['used_count']) : null,
        ]);
    }

    // ---------- bundles ----------

    public function bundleIndex(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        try {
            $bundlesTable  = $this->db->prefixTable('ticket_product_bundles');
            $productsTable = $this->db->prefixTable('ticket_products');
            $rows          = $this->db->query(
                "SELECT b.*, p.title AS child_title
                 FROM {$bundlesTable} b
                 LEFT JOIN {$productsTable} p ON p.ticket_product_id = b.child_product_id
                 WHERE b.parent_product_id = ? AND b.deleted = 0
                 ORDER BY b.sort_order ASC, b.bundle_id ASC",
                [$productId],
            )->getResultArray();

            return $this->respondSuccess(['bundles' => array_map(fn (array $r) => $this->decorateBundle($r), $rows)]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::bundleIndex — ' . $e->getMessage());

            return $this->respondError('Failed to load bundles.', 500);
        }
    }

    public function bundleCreate(int $productId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        $body         = $this->request->getJSON(true) ?? [];
        $childProduct = (int) ($body['child_product_id'] ?? 0);
        if ($childProduct <= 0) {
            return $this->respondError('child_product_id is required.', 422);
        }
        if ($childProduct === $productId) {
            return $this->respondError('Bundle child cannot be the parent.', 422);
        }

        try {
            $this->db->table('ticket_product_bundles')->insert([
                'parent_product_id' => $productId,
                'child_product_id'  => $childProduct,
                'child_tier_id'     => $this->intOrNull($body['child_tier_id'] ?? null),
                'child_session_id'  => $this->intOrNull($body['child_session_id'] ?? null),
                'quantity'          => max(1, (int) ($body['quantity'] ?? 1)),
                'sort_order'        => (int) ($body['sort_order'] ?? 0),
            ]);

            return $this->respondSuccess(['bundle_id' => (int) $this->db->insertID()], 'Bundle entry created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::bundleCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create bundle.', 500);
        }
    }

    public function bundleDelete(int $productId, int $bundleId): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }

        try {
            $this->db->table('ticket_product_bundles')
                ->where('parent_product_id', $productId)
                ->where('bundle_id', $bundleId)
                ->update(['deleted' => 1]);

            return $this->respondSuccess(['bundle_id' => $bundleId], 'Bundle entry deleted.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::bundleDelete — ' . $e->getMessage());

            return $this->respondError('Failed to delete bundle.', 500);
        }
    }

    // ---------- seat holds (public + authenticated) ----------

    /**
     * POST /api/seat-holds — body: { product_id, session_id?, seats: [code,...] }
     * Returns: { hold_token, expires_at, seats }
     *
     * Public so the customer checkout flow can reserve before paying.
     * Rate-limited per IP to defeat seat squatting.
     */
    public function seatHoldCreate(): ResponseInterface
    {
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }
        if (! $this->publicRateLimit('seat_hold', 30, 60)) {
            return $this->respondError('Too many hold requests.', 429);
        }

        $body      = $this->request->getJSON(true) ?? [];
        $productId = (int) ($body['product_id'] ?? 0);
        $sessionId = (int) ($body['session_id'] ?? 0);
        $seats     = is_array($body['seats'] ?? null) ? array_values(array_filter($body['seats'], 'is_string')) : [];
        if ($productId <= 0 || $seats === []) {
            return $this->respondError('product_id and non-empty seats[] are required.', 422);
        }
        if (count($seats) > 20) {
            return $this->respondError('Too many seats per hold (max 20).', 422);
        }

        $ttlMin  = max(1, (int) $this->getAppConfig('ticket_seat_hold_ttl_min', '10'));
        $expires = (new DateTimeImmutable())->modify("+{$ttlMin} minutes");
        $token   = bin2hex(random_bytes(32));

        try {
            $this->db->transBegin();
            $now = date('Y-m-d H:i:s');

            // Conflict check — any active hold or consumed seat for the same session+seat?
            $holdsTable = $this->db->prefixTable('ticket_seat_holds');
            $params     = [$productId, $sessionId > 0 ? $sessionId : null];
            $rows       = $this->db->query(
                "SELECT seat_code FROM {$holdsTable}
                 WHERE product_id = ?
                   AND (session_id <=> ?)
                   AND consumed_at IS NULL
                   AND released_at IS NULL
                   AND held_until > NOW()
                   AND seat_code IN (" . implode(',', array_fill(0, count($seats), '?')) . ')',
                array_merge($params, $seats),
            )->getResultArray();
            if (! empty($rows)) {
                $this->db->transRollback();

                return $this->respondError('Some seats are already held: ' . implode(', ', array_column($rows, 'seat_code')), 409);
            }

            foreach ($seats as $seatCode) {
                $this->db->table('ticket_seat_holds')->insert([
                    'session_id' => $sessionId > 0 ? $sessionId : null,
                    'product_id' => $productId,
                    'seat_code'  => mb_substr($seatCode, 0, 64),
                    'hold_token' => $token,
                    'held_until' => $expires->format('Y-m-d H:i:s'),
                    'held_by_ip' => $this->request->getIPAddress() ?: null,
                    'created_at' => $now,
                ]);
            }

            if (! $this->db->transCommit()) {
                return $this->respondError('Failed to create hold.', 500);
            }

            return $this->respondSuccess([
                'hold_token' => $token,
                'expires_at' => $expires->format('c'),
                'seats'      => $seats,
            ], 'Seats held.', 201);
        } catch (Throwable $e) {
            try {
                $this->db->transRollback();
            } catch (Throwable $ignore) {
            }
            log_message('error', 'TicketsController::seatHoldCreate — ' . $e->getMessage());

            return $this->respondError('Failed to create hold.', 500);
        }
    }

    public function seatHoldRelease(): ResponseInterface
    {
        if (! $this->phase5MigrationApplied()) {
            return $this->respondError('Phase 5 migration is required.', 503);
        }
        $body  = $this->request->getJSON(true) ?? [];
        $token = (string) ($body['hold_token'] ?? '');
        if ($token === '') {
            return $this->respondError('hold_token is required.', 422);
        }

        try {
            $this->db->table('ticket_seat_holds')
                ->where('hold_token', $token)
                ->where('consumed_at IS NULL', null, false)
                ->update(['released_at' => date('Y-m-d H:i:s')]);

            return $this->respondSuccess(['hold_token' => $token], 'Hold released.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::seatHoldRelease — ' . $e->getMessage());

            return $this->respondError('Failed to release hold.', 500);
        }
    }

    // ---------- reports ----------

    /**
     * GET /api/reports/tickets/sales — daily sales count + revenue
     * grouped by product. Optional ?from=&to= filter.
     */
    public function reportsTicketSales(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $from = $this->parseDateTime($this->request->getGet('from')) ?? date('Y-m-d 00:00:00', strtotime('-30 days'));
        $to   = $this->parseDateTime($this->request->getGet('to')) ?? date('Y-m-d 23:59:59');

        try {
            $ticketsTable  = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $rows          = $this->db->query(
                "SELECT
                    p.ticket_product_id, p.title, p.subtype,
                    DATE(t.issued_at) AS day,
                    COUNT(*) AS issued_count
                 FROM {$ticketsTable} t
                 LEFT JOIN {$productsTable} p ON p.ticket_product_id = t.ticket_product_id
                 WHERE t.deleted = 0
                   AND t.issued_at BETWEEN ? AND ?
                 GROUP BY p.ticket_product_id, DATE(t.issued_at)
                 ORDER BY day DESC, issued_count DESC",
                [$from, $to],
            )->getResultArray();

            return $this->respondSuccess(['from' => $from, 'to' => $to, 'rows' => $rows]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::reportsTicketSales — ' . $e->getMessage());

            return $this->respondError('Report failed.', 500);
        }
    }

    /**
     * GET /api/reports/tickets/redemptions — scan velocity + result histogram.
     */
    public function reportsTicketRedemptions(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        $from = $this->parseDateTime($this->request->getGet('from')) ?? date('Y-m-d 00:00:00', strtotime('-7 days'));
        $to   = $this->parseDateTime($this->request->getGet('to')) ?? date('Y-m-d 23:59:59');

        try {
            $redemptionsTable = $this->db->prefixTable('ticket_redemptions');
            $byResult         = $this->db->query(
                "SELECT result, COUNT(*) AS count
                 FROM {$redemptionsTable}
                 WHERE occurred_at BETWEEN ? AND ?
                 GROUP BY result
                 ORDER BY count DESC",
                [$from, $to],
            )->getResultArray();

            $byHour = $this->db->query(
                "SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00') AS hour,
                        SUM(CASE WHEN result = 'ok' THEN 1 ELSE 0 END) AS ok,
                        COUNT(*) AS total
                 FROM {$redemptionsTable}
                 WHERE occurred_at BETWEEN ? AND ?
                 GROUP BY hour
                 ORDER BY hour ASC",
                [$from, $to],
            )->getResultArray();

            return $this->respondSuccess(['from' => $from, 'to' => $to, 'by_result' => $byResult, 'by_hour' => $byHour]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::reportsTicketRedemptions — ' . $e->getMessage());

            return $this->respondError('Report failed.', 500);
        }
    }

    /**
     * GET /api/reports/tickets/no-shows — tickets sold but never scanned,
     * grouped by product. Only counts tickets whose valid_to has passed.
     */
    public function reportsTicketNoShows(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->migrationApplied()) {
            return $this->respondError('Tickets migration is required.', 503);
        }

        try {
            $ticketsTable  = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $rows          = $this->db->query(
                "SELECT
                    p.ticket_product_id, p.title, p.subtype,
                    SUM(CASE WHEN t.status IN ('issued','active') AND (t.valid_to IS NULL OR t.valid_to < NOW()) THEN 1 ELSE 0 END) AS no_shows,
                    SUM(CASE WHEN t.status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed,
                    COUNT(*) AS total
                 FROM {$ticketsTable} t
                 LEFT JOIN {$productsTable} p ON p.ticket_product_id = t.ticket_product_id
                 WHERE t.deleted = 0
                 GROUP BY p.ticket_product_id
                 HAVING total > 0
                 ORDER BY no_shows DESC",
            )->getResultArray();

            return $this->respondSuccess(['rows' => $rows]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::reportsTicketNoShows — ' . $e->getMessage());

            return $this->respondError('Report failed.', 500);
        }
    }

    // --- Phase 5 helpers ---

    private function decoratePromo(array $row): array
    {
        return [
            'code_id'           => (int) $row['code_id'],
            'code'              => (string) $row['code'],
            'description'       => $row['description'],
            'discount_pct'      => $row['discount_pct'] !== null ? (string) $row['discount_pct'] : null,
            'discount_flat'     => $row['discount_flat'] !== null ? (string) $row['discount_flat'] : null,
            'currency'          => $row['currency'],
            'max_uses'          => $row['max_uses'] !== null ? (int) $row['max_uses'] : null,
            'used_count'        => (int) $row['used_count'],
            'remaining_uses'    => $row['max_uses'] !== null ? max(0, (int) $row['max_uses'] - (int) $row['used_count']) : null,
            'starts_at'         => $row['starts_at'],
            'expires_at'        => $row['expires_at'],
            'scope_product_ids' => $this->csvToIntList((string) ($row['scope_product_ids'] ?? '')),
            'scope_tier_ids'    => $this->csvToIntList((string) ($row['scope_tier_ids'] ?? '')),
            'min_amount'        => $row['min_amount'] !== null ? (string) $row['min_amount'] : null,
        ];
    }

    private function decorateBundle(array $row): array
    {
        return [
            'bundle_id'         => (int) $row['bundle_id'],
            'parent_product_id' => (int) $row['parent_product_id'],
            'child_product_id'  => (int) $row['child_product_id'],
            'child_title'       => $row['child_title'] ?? null,
            'child_tier_id'     => $row['child_tier_id'] !== null ? (int) $row['child_tier_id'] : null,
            'child_session_id'  => $row['child_session_id'] !== null ? (int) $row['child_session_id'] : null,
            'quantity'          => (int) $row['quantity'],
            'sort_order'        => (int) $row['sort_order'],
        ];
    }

    private function validatePromoPayload(array $body, bool $isCreate): string|true
    {
        if ($isCreate) {
            $code = strtoupper(trim((string) ($body['code'] ?? '')));
            if ($code === '') {
                return 'code is required.';
            }
            if (! preg_match('/^[A-Z0-9_-]{3,64}$/', $code)) {
                return 'code may only contain A-Z 0-9 _ -, length 3-64.';
            }
        }
        $pct  = $body['discount_pct'] ?? null;
        $flat = $body['discount_flat'] ?? null;
        if ($pct === null && $flat === null) {
            return 'discount_pct or discount_flat is required.';
        }
        if ($pct !== null && (! is_numeric($pct) || (float) $pct <= 0 || (float) $pct > 100)) {
            return 'discount_pct must be a number 0 < pct <= 100.';
        }
        if ($flat !== null && ! $this->isValidMoney((string) $flat)) {
            return 'discount_flat must be a non-negative decimal.';
        }

        return true;
    }

    private function buildPromoRow(array $body): array
    {
        return [
            'code'              => isset($body['code']) ? strtoupper(trim((string) $body['code'])) : null,
            'description'       => $this->stringOrNull($body['description'] ?? null, 255),
            'discount_pct'      => isset($body['discount_pct']) && $body['discount_pct'] !== null ? (string) $body['discount_pct'] : null,
            'discount_flat'     => isset($body['discount_flat']) && $body['discount_flat'] !== null ? $this->parseMoney($body['discount_flat']) : null,
            'currency'          => $this->stringOrNull($body['currency'] ?? null, 8),
            'max_uses'          => $this->intOrNull($body['max_uses'] ?? null),
            'starts_at'         => $this->parseDateTime($body['starts_at'] ?? null),
            'expires_at'        => $this->parseDateTime($body['expires_at'] ?? null),
            'scope_product_ids' => isset($body['scope_product_ids']) && is_array($body['scope_product_ids'])
                ? implode(',', array_map('intval', $body['scope_product_ids']))
                : null,
            'scope_tier_ids' => isset($body['scope_tier_ids']) && is_array($body['scope_tier_ids'])
                ? implode(',', array_map('intval', $body['scope_tier_ids']))
                : null,
            'min_amount' => isset($body['min_amount']) && $body['min_amount'] !== null ? $this->parseMoney($body['min_amount']) : null,
        ];
    }

    private function checkPromoEligibility(array $promo, int $productId, int $tierId, ?string $amount): ?string
    {
        $now = time();
        if (! empty($promo['starts_at']) && strtotime((string) $promo['starts_at']) > $now) {
            return 'not_started';
        }
        if (! empty($promo['expires_at']) && strtotime((string) $promo['expires_at']) < $now) {
            return 'expired';
        }
        if ($promo['max_uses'] !== null && (int) $promo['used_count'] >= (int) $promo['max_uses']) {
            return 'sold_out';
        }
        if (! empty($promo['scope_product_ids']) && $productId > 0) {
            $allowed = $this->csvToIntList((string) $promo['scope_product_ids']);
            if ($allowed !== [] && ! in_array($productId, $allowed, true)) {
                return 'wrong_product';
            }
        }
        if (! empty($promo['scope_tier_ids']) && $tierId > 0) {
            $allowed = $this->csvToIntList((string) $promo['scope_tier_ids']);
            if ($allowed !== [] && ! in_array($tierId, $allowed, true)) {
                return 'wrong_tier';
            }
        }
        if (! empty($promo['min_amount']) && $amount !== null && bccomp($amount, (string) $promo['min_amount'], 2) < 0) {
            return 'below_min';
        }

        return null;
    }

    private function computePromoAmount(array $promo, string $amount): string
    {
        $applied = '0.00';
        if (! empty($promo['discount_pct'])) {
            $pct     = (string) $promo['discount_pct'];
            $applied = bcmul($amount, bcdiv($pct, '100', 4), 2);
        }
        if (! empty($promo['discount_flat'])) {
            $flat    = (string) $promo['discount_flat'];
            $applied = bcadd($applied, $flat, 2);
        }
        if (bccomp($applied, $amount, 2) > 0) {
            $applied = $amount;
        }

        return $applied;
    }
}
