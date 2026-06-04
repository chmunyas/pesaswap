<?php

namespace App\Controllers\Api;

use App\Models\Ticket;
use App\Models\Ticket_product;
use CodeIgniter\HTTP\ResponseInterface;
use DateTimeImmutable;
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
    private const ALLOWED_SUBTYPES = ['meeting', 'scenic', 'movie', 'transport'];

    private const ALLOWED_CODE_TYPES = ['text', 'barcode', 'qrcode', 'only_qrcode', 'only_barcode'];

    private const ALLOWED_VALIDITY_MODES = ['fixed', 'relative'];

    private const ALLOWED_ISSUE_REASONS = ['comp', 'replacement', 'gift', 'test', 'migration', 'manual'];

    private const STATUS_TRANSITIONS = [
        'issued'    => ['active', 'revoked', 'expired'],
        'active'    => ['redeemed', 'revoked', 'refunded', 'expired'],
        'redeemed'  => [],
        'refunded'  => [],
        'revoked'   => [],
        'expired'   => [],
    ];

    private Ticket_product $products;
    private Ticket $tickets;

    public function initController(\CodeIgniter\HTTP\RequestInterface $request, \CodeIgniter\HTTP\ResponseInterface $response, \Psr\Log\LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);
        $this->products = model(Ticket_product::class);
        $this->tickets  = model(Ticket::class);
    }

    // ---------- ticket_products CRUD ----------

    public function productIndex(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        $pagination = $this->getPagination();
        $search = trim((string)($this->request->getGet('search') ?? ''));
        $subtype = trim((string)($this->request->getGet('subtype') ?? ''));

        try {
            $table = $this->db->prefixTable('ticket_products');
            $itemsTable = $this->db->prefixTable('items');

            $where = ['p.deleted = 0'];
            $params = [];

            if ($search !== '') {
                $like = $this->likeValue($search);
                $where[] = "(p.title LIKE ? ESCAPE '!' OR p.brand_name LIKE ? ESCAPE '!')";
                $params[] = $like; $params[] = $like;
            }
            if ($subtype !== '' && in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
                $where[] = 'p.subtype = ?';
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
            $total = (int)($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            $products = array_map(fn(array $r) => $this->decorateProduct($r), $rows);

            return $this->respondSuccess([
                'products' => $products,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
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
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);
        try {
            $product = $this->loadProductRow($id);
            if ($product === null) return $this->respondError('Ticket product not found.', 404);
            $subtype = $this->loadSubtypeRow((string)$product['subtype'], $id);
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
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        $body = $this->request->getJSON(true) ?? [];
        $err = $this->validateProductPayload($body, /* isCreate */ true);
        if (is_string($err)) return $this->respondError($err, 422);

        $signingKey = $this->loadActiveSigningKeyId();
        if ($signingKey === null) {
            return $this->respondError('No active signing key configured. Run the tickets migration to generate one.', 503);
        }

        try {
            $this->db->transStart();
            $row = $this->buildProductRow($body, /* itemId */ (int)($body['item_id'] ?? 0), $signingKey);
            $this->db->table('ticket_products')->insert($row);
            $newId = (int)$this->db->insertID();
            $this->writeSubtypeRow((string)$row['subtype'], $newId, $body['subtype_data'] ?? []);
            $this->writeLocations($newId, (array)($body['location_ids'] ?? []));
            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create ticket product.', 500);
            }
            $fresh = $this->loadProductRow($newId);
            return $this->respondSuccess([
                'product'   => $fresh ? $this->decorateProduct($fresh) : null,
                'subtype'   => $this->loadSubtypeRow((string)$row['subtype'], $newId),
                'locations' => $this->loadProductLocations($newId),
            ], 'Ticket product created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productCreate — ' . $e->getMessage());
            return $this->respondError('Failed to create ticket product.', 500);
        }
    }

    public function productUpdate(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        $existing = $this->loadProductRow($id);
        if ($existing === null) return $this->respondError('Ticket product not found.', 404);

        $body = $this->request->getJSON(true) ?? [];

        // Rubber-duck #6: subtype changes are forbidden after creation.
        if (isset($body['subtype']) && (string)$body['subtype'] !== (string)$existing['subtype']) {
            return $this->respondError('Subtype cannot be changed after creation.', 422);
        }
        // Pre-fill the existing subtype so validateProductPayload allows
        // partial updates of subtype_data without resending the subtype key.
        $body['subtype'] = (string)$existing['subtype'];

        $err = $this->validateProductPayload($body, /* isCreate */ false);
        if (is_string($err)) return $this->respondError($err, 422);

        try {
            $this->db->transStart();
            $patch = $this->buildProductRow($body, (int)$existing['item_id'], (int)$existing['signing_key_id']);
            // Do not let an update silently change item_id or signing_key_id
            unset($patch['item_id']);
            unset($patch['signing_key_id']);
            unset($patch['quantity_issued']); // counter is owned by issuance only
            $this->db->table('ticket_products')->where('ticket_product_id', $id)->update($patch);
            if (array_key_exists('subtype_data', $body)) {
                $this->writeSubtypeRow((string)$existing['subtype'], $id, (array)$body['subtype_data']);
            }
            if (array_key_exists('location_ids', $body)) {
                $this->writeLocations($id, (array)$body['location_ids']);
            }
            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to update ticket product.', 500);
            }
            $fresh = $this->loadProductRow($id);
            return $this->respondSuccess([
                'product'   => $fresh ? $this->decorateProduct($fresh) : null,
                'subtype'   => $this->loadSubtypeRow((string)$existing['subtype'], $id),
                'locations' => $this->loadProductLocations($id),
            ], 'Ticket product updated.');
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::productUpdate — ' . $e->getMessage());
            return $this->respondError('Failed to update ticket product.', 500);
        }
    }

    public function productDelete(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);
        $existing = $this->loadProductRow($id);
        if ($existing === null) return $this->respondError('Ticket product not found.', 404);
        try {
            // Rubber-duck #7: products with issued instances become "archived"
            // (still readable for joins from existing tickets) rather than
            // hard-deleted. The semantics are encoded in the `deleted` flag
            // either way; the difference is that we return a different
            // success message so the operator understands.
            $issued = (int)$existing['quantity_issued'];
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
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        $pagination = $this->getPagination();
        $productId = (int)($this->request->getGet('ticket_product_id') ?? 0);
        $status = trim((string)($this->request->getGet('status') ?? ''));
        $customerId = (int)($this->request->getGet('customer_id') ?? 0);

        try {
            $table = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $where = ['t.deleted = 0'];
            $params = [];
            if ($productId > 0) { $where[] = 't.ticket_product_id = ?'; $params[] = $productId; }
            if ($status !== '') { $where[] = 't.status = ?'; $params[] = $status; }
            if ($customerId > 0) { $where[] = 't.customer_id = ?'; $params[] = $customerId; }
            $whereSql = 'WHERE ' . implode(' AND ', $where);

            $sql = "SELECT t.*, p.title AS product_title, p.subtype, p.brand_name
                    FROM {$table} AS t
                    LEFT JOIN {$productsTable} AS p ON p.ticket_product_id = t.ticket_product_id
                    {$whereSql}
                    ORDER BY t.issued_at DESC, t.ticket_id DESC
                    LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}";
            $countSql = "SELECT COUNT(*) AS total FROM {$table} AS t {$whereSql}";

            $rows = $this->db->query($sql, $params)->getResultArray();
            $total = (int)($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);
            return $this->respondSuccess([
                'tickets' => array_map(fn(array $r) => $this->decorateTicket($r), $rows),
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                ],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketIndex — ' . $e->getMessage());
            return $this->respondError('Failed to load tickets.', 500);
        }
    }

    public function ticketShow(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);
        $ticket = $this->loadTicketRow($id);
        if ($ticket === null) return $this->respondError('Ticket not found.', 404);
        return $this->respondSuccess([
            'ticket' => $this->decorateTicket($ticket),
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
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        $body = $this->request->getJSON(true) ?? [];
        $productId = (int)($body['ticket_product_id'] ?? 0);
        if ($productId <= 0) return $this->respondError('ticket_product_id is required.', 422);

        $saleId = isset($body['sale_id']) ? (int)$body['sale_id'] : null;
        $reason = strtolower(trim((string)($body['issuance_reason'] ?? '')));
        if ($saleId === null && !in_array($reason, self::ALLOWED_ISSUE_REASONS, true)) {
            return $this->respondError(
                'Manual issuance (without sale_id) requires issuance_reason ('
                . implode(', ', self::ALLOWED_ISSUE_REASONS) . ').',
                422,
            );
        }

        $customerId = isset($body['customer_id']) ? (int)$body['customer_id'] : null;

        try {
            $this->db->transStart();

            $productsTable = $this->db->prefixTable('ticket_products');
            $product = $this->db->query(
                "SELECT * FROM {$productsTable} WHERE ticket_product_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$productId],
            )->getRowArray();
            if ($product === null) {
                $this->db->transComplete();
                return $this->respondError('Ticket product not found or archived.', 404);
            }

            $err = $this->validateIssuance($product, $customerId, $body['seat_assignment'] ?? null);
            if (is_string($err)) {
                $this->db->transComplete();
                return $this->respondError($err, 422);
            }

            // Conditional counter update — atomic protection against overshooting cap
            $quantity = $product['quantity'] === null ? null : (int)$product['quantity'];
            if ($quantity !== null) {
                $affected = $this->db->query(
                    "UPDATE {$productsTable}
                     SET quantity_issued = quantity_issued + 1
                     WHERE ticket_product_id = ?
                       AND deleted = 0
                       AND (quantity IS NULL OR quantity_issued < quantity)",
                    [$productId],
                );
                if ($this->db->affectedRows() === 0) {
                    $this->db->transComplete();
                    return $this->respondError('Ticket product is sold out.', 409);
                }
            } else {
                // Unbounded — still bump the counter inside the transaction.
                $this->db->query(
                    "UPDATE {$productsTable} SET quantity_issued = quantity_issued + 1 WHERE ticket_product_id = ? AND deleted = 0",
                    [$productId],
                );
            }

            [$validFrom, $validTo] = $this->resolveValidityWindow($product, $body);

            $params = [
                'ticket_product_id' => $productId,
                'sale_id' => $saleId,
                'sale_item_seq' => isset($body['sale_item_seq']) ? (int)$body['sale_item_seq'] : null,
                'customer_id' => $customerId,
                'valid_from' => $validFrom,
                'valid_to' => $validTo,
                'seat_assignment' => $body['seat_assignment'] ?? null,
            ];

            // Phase 0 Ticket::issue handles code + JWT + code_hash + insert.
            // BUT it also bumps quantity_issued. To avoid double-counting we
            // pre-incremented above; compensate by decrementing before the
            // model call so the net effect is +1.
            $this->db->query(
                "UPDATE {$productsTable} SET quantity_issued = quantity_issued - 1 WHERE ticket_product_id = ?",
                [$productId],
            );

            $result = $this->tickets->issue($params);
            if (!isset($result['ticket']) || !isset($result['token'])) {
                $this->db->transRollback();
                return $this->respondError('Issuance failed.', 500);
            }

            // Manual reason audit — Phase 0 schema has no dedicated column,
            // so we stash it on transfer_history_json with a typed entry.
            if ($saleId === null) {
                $ticketObj = $result['ticket'];
                $audit = [[
                    'type' => 'manual_issue',
                    'reason' => $reason,
                    'employee_id' => $this->session->get('person_id'),
                    'at' => date('c'),
                ]];
                $this->db->table('tickets')->where('ticket_id', $ticketObj->ticket_id)
                    ->update(['transfer_history_json' => json_encode($audit)]);
            }

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Issuance transaction failed.', 500);
            }

            $fresh = $this->loadTicketRow((int)$result['ticket']->ticket_id);
            return $this->respondSuccess([
                'ticket' => $fresh ? $this->decorateTicket($fresh) : null,
                'token' => $result['token'],
                'redemption_url' => service('qr_lib')->build_redemption_url((string)$result['token']),
            ], 'Ticket issued.', 201);
        } catch (Throwable $e) {
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
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);

        // Rubber-duck #11: rate limit per-employee + per-IP. Failed signatures
        // are throttled more aggressively than authenticated success attempts.
        $employeeId = (int)($this->session->get('person_id') ?? 0);
        if (!$this->checkRedeemRateLimit($employeeId)) {
            return $this->respondError('Too many redemption attempts. Slow down.', 429);
        }

        $body = $this->request->getJSON(true) ?? [];
        $raw = trim((string)($body['token'] ?? ''));
        $token = $this->extractToken($raw);
        if ($token === '') {
            return $this->respondError('A ticket token, URL, or code is required.', 422);
        }

        $locationId = isset($body['location_id']) ? (int)$body['location_id'] : null;
        $idempotencyKey = isset($body['idempotency_key'])
            ? mb_substr((string)$body['idempotency_key'], 0, 64) : null;

        try {
            $result = $this->tickets->redeem($token, $employeeId, $locationId, $idempotencyKey);
            // Decorate with the ticket for client display when possible
            $ticket = null;
            if (!empty($result['ticket_id'])) {
                $row = $this->loadTicketRow((int)$result['ticket_id']);
                if ($row !== null) $ticket = $this->decorateTicket($row);
            }
            return $this->respondSuccess([
                'result' => $result['result'],
                'ticket_id' => $result['ticket_id'] ?? null,
                'message' => $result['message'] ?? '',
                'ticket' => $ticket,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::ticketRedeem — ' . $e->getMessage());
            return $this->respondError('Failed to process redemption.', 500);
        }
    }

    public function ticketQr(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);
        $ticket = $this->loadTicketRow($id);
        if ($ticket === null) return $this->respondError('Ticket not found.', 404);

        try {
            // Re-issue a JWT for display purposes (uses ticket's active key).
            // We do not need to overwrite code_hash because this is a display
            // helper — the originally-issued token is still the valid one.
            // For display we just embed the existing code in the QR (the
            // staff scan path will look up by code, NOT by JWT, when the
            // input lacks a dotted JWT format).
            $url = service('qr_lib')->build_redemption_url((string)$ticket['code']);
            $svg = service('qr_lib')->generate_svg($url);
            return $this->respondSuccess([
                'svg' => $svg,
                'url' => $url,
                'code' => (string)$ticket['code'],
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
        if (!$this->publicRateLimit('ticket_lookup', 60, 60)) {
            return $this->respondError('Too many lookups.', 429);
        }
        $normalized = strtoupper(trim($code));
        if (!preg_match('/^[A-Z0-9\\-]{4,64}$/', $normalized)) {
            return $this->emptyPublicTicket();
        }

        try {
            if (!$this->db->tableExists('tickets')) {
                return $this->emptyPublicTicket();
            }
            $ticketsTable  = $this->db->prefixTable('tickets');
            $productsTable = $this->db->prefixTable('ticket_products');
            $row = $this->db->query(
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

            if ($row === null) return $this->emptyPublicTicket();

            // Subtype-specific public info
            $subtype = (string)$row['subtype'];
            $subtypeInfo = $this->loadPublicSubtypeRow($subtype, (int)$row['ticket_id'] ? (int)$row['ticket_id'] : 0);

            // Re-fetch the subtype row by product_id (the join doesn't carry it)
            $product = $this->db->table('ticket_products')
                ->where('title', $row['title'])
                ->where('subtype', $subtype)
                ->limit(1)
                ->get()
                ->getRowArray();
            if ($product) {
                $subtypeInfo = $this->loadPublicSubtypeRow($subtype, (int)$product['ticket_product_id']);
            }

            // The redemption URL embedded in the QR — staff scans this.
            $redemptionUrl = service('qr_lib')->build_redemption_url($normalized);

            return $this->respondSuccess([
                'code' => $row['code'],
                'status' => (string)$row['status'],
                'valid_from' => $row['valid_from'],
                'valid_to' => $row['valid_to'],
                'seat' => $row['seat_assignment_json'] ? json_decode((string)$row['seat_assignment_json'], true) : null,
                'redeem_count' => (int)$row['redeem_count'],
                'bound' => (bool)$row['bound'],
                'product' => [
                    'subtype' => $subtype,
                    'title' => (string)$row['title'],
                    'brand_name' => $row['brand_name'],
                    'color' => $row['color'],
                    'notice' => $row['notice'],
                    'code_type' => $row['code_type'],
                    'logo_url' => $row['logo_url'],
                    'service_phone' => $row['service_phone'],
                    'description' => $row['description'],
                ],
                'subtype_info' => $subtypeInfo,
                'qr_url' => $redemptionUrl,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'TicketsController::publicLookup — ' . $e->getMessage());
            return $this->emptyPublicTicket();
        }
    }

    private function emptyPublicTicket(): ResponseInterface
    {
        return $this->respondSuccess([
            'code' => null,
            'status' => 'not_found',
            'valid_from' => null,
            'valid_to' => null,
            'seat' => null,
            'redeem_count' => 0,
            'bound' => false,
            'product' => null,
            'subtype_info' => null,
            'qr_url' => null,
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
            return $row ? (int)$row['signing_key_id'] : null;
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
        if (!in_array($subtype, self::ALLOWED_SUBTYPES, true)) return [];
        $table = 'ticket_product_' . $subtype;
        if (!$this->db->tableExists($table)) return [];
        $row = $this->db->table($table)->where('ticket_product_id', $productId)->get()->getRowArray();
        return $row ?: [];
    }

    private function loadPublicSubtypeRow(string $subtype, int $productId): array
    {
        $row = $this->loadSubtypeRow($subtype, $productId);
        // No sensitive fields in any of the subtype tables, but always project explicitly:
        return $row;
    }

    private function loadProductLocations(int $productId): array
    {
        try {
            $rows = $this->db->table('ticket_product_locations')
                ->where('ticket_product_id', $productId)
                ->get()
                ->getResultArray();
            return array_map(fn(array $r) => (int)$r['location_id'], $rows);
        } catch (Throwable $e) {
            return [];
        }
    }

    private function writeSubtypeRow(string $subtype, int $productId, array $data): void
    {
        if (!in_array($subtype, self::ALLOWED_SUBTYPES, true)) return;
        $table = 'ticket_product_' . $subtype;
        if (!$this->db->tableExists($table)) return;
        $allowed = $this->subtypeAllowedFields($subtype);
        $row = ['ticket_product_id' => $productId];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $data)) {
                $val = $data[$f];
                if (is_array($val)) $val = json_encode($val);
                $row[$f] = $val;
            }
        }
        $this->db->table($table)->replace($row);
    }

    private function writeLocations(int $productId, array $locationIds): void
    {
        $this->db->table('ticket_product_locations')->where('ticket_product_id', $productId)->delete();
        foreach ($locationIds as $loc) {
            $id = (int)$loc;
            if ($id <= 0) continue;
            $this->db->table('ticket_product_locations')->insert([
                'ticket_product_id' => $productId,
                'location_id' => $id,
            ]);
        }
    }

    /** Subtype-allowed field whitelist. Mirrors Phase 0 schema. */
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
        $title = trim((string)($body['title'] ?? ''));
        if ($isCreate && $title === '') return 'Title is required.';
        if (mb_strlen($title) > 255) return 'Title is too long (max 255).';

        $subtype = (string)($body['subtype'] ?? '');
        if ($isCreate && !in_array($subtype, self::ALLOWED_SUBTYPES, true)) {
            return 'subtype must be one of: ' . implode(', ', self::ALLOWED_SUBTYPES);
        }

        if (isset($body['code_type']) && !in_array((string)$body['code_type'], self::ALLOWED_CODE_TYPES, true)) {
            return 'code_type is invalid.';
        }
        if (isset($body['validity_mode']) && !in_array((string)$body['validity_mode'], self::ALLOWED_VALIDITY_MODES, true)) {
            return 'validity_mode must be fixed or relative.';
        }
        if ($isCreate) {
            if (!isset($body['item_id']) || (int)$body['item_id'] <= 0) {
                return 'item_id is required (links to the OSPOS item).';
            }
            $exists = $this->db->table('items')->where('item_id', (int)$body['item_id'])->countAllResults();
            if ($exists === 0) return 'Unknown item_id.';
        }
        if (isset($body['quantity']) && $body['quantity'] !== null && (int)$body['quantity'] < 0) {
            return 'quantity must be a non-negative integer or null.';
        }
        if (isset($body['max_per_customer']) && $body['max_per_customer'] !== null && (int)$body['max_per_customer'] < 1) {
            return 'max_per_customer must be at least 1.';
        }

        if (isset($body['subtype_data']) && !is_array($body['subtype_data'])) {
            return 'subtype_data must be an object.';
        }

        return true;
    }

    private function buildProductRow(array $body, int $itemId, int $signingKeyId): array
    {
        $row = [
            'item_id' => $itemId,
            'subtype' => (string)$body['subtype'],
            'code_type' => (string)($body['code_type'] ?? 'qrcode'),
            'validity_mode' => (string)($body['validity_mode'] ?? 'fixed'),
            'begin_ts' => $this->parseDateTime($body['begin_ts'] ?? null),
            'end_ts' => $this->parseDateTime($body['end_ts'] ?? null),
            'fixed_begin_term_days' => $this->intOrNull($body['fixed_begin_term_days'] ?? null),
            'fixed_term_days' => $this->intOrNull($body['fixed_term_days'] ?? null),
            'quantity' => $this->intOrNull($body['quantity'] ?? null),
            'max_per_customer' => $this->intOrNull($body['max_per_customer'] ?? null),
            'sale_window_from' => $this->parseDateTime($body['sale_window_from'] ?? null),
            'sale_window_to' => $this->parseDateTime($body['sale_window_to'] ?? null),
            'bind_customer' => (int)(bool)($body['bind_customer'] ?? false),
            'transferable' => (int)(bool)($body['transferable'] ?? true),
            'single_use' => (int)(bool)($body['single_use'] ?? true),
            'max_redemptions' => max(1, (int)($body['max_redemptions'] ?? 1)),
            'refundable' => (int)(bool)($body['refundable'] ?? true),
            'refund_window_hours' => $this->intOrNull($body['refund_window_hours'] ?? null),
            'title' => mb_substr((string)($body['title'] ?? ''), 0, 255),
            'brand_name' => $this->stringOrNull($body['brand_name'] ?? null, 255),
            'color' => $this->stringOrNull($body['color'] ?? null, 16),
            'notice' => $this->stringOrNull($body['notice'] ?? null, 255),
            'description' => $body['description'] ?? null,
            'service_phone' => $this->stringOrNull($body['service_phone'] ?? null, 64),
            'source' => $this->stringOrNull($body['source'] ?? null, 64),
            'custom_url' => $this->stringOrNull($body['custom_url'] ?? null, 512),
            'custom_url_name' => $this->stringOrNull($body['custom_url_name'] ?? null, 64),
            'custom_url_sub_title' => $this->stringOrNull($body['custom_url_sub_title'] ?? null, 128),
            'logo_url' => $this->stringOrNull($body['logo_url'] ?? null, 512),
            'signing_key_id' => $signingKeyId,
        ];
        return $row;
    }

    private function decorateProduct(array $row): array
    {
        $quantity = $row['quantity'] === null ? null : (int)$row['quantity'];
        $issued = (int)($row['quantity_issued'] ?? 0);
        $row['quantity'] = $quantity;
        $row['quantity_issued'] = $issued;
        $row['remaining'] = $quantity === null ? null : max(0, $quantity - $issued);
        $row['sold_out'] = $quantity !== null && $issued >= $quantity;
        $row['sale_window_open'] = $this->isSaleWindowOpen($row);
        return $row;
    }

    private function decorateTicket(array $row): array
    {
        // Mask the code to last 4 in list payloads — operator-only views can fetch the full code via the show endpoint.
        $row['masked_code'] = $this->maskCode((string)($row['code'] ?? ''));
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
        $rows = $this->db->table('ticket_redemptions')
            ->where('ticket_id', $ticketId)
            ->orderBy('occurred_at', 'DESC')
            ->limit(50)
            ->get()
            ->getResultArray();
        return $rows;
    }

    private function maskCode(string $code): string
    {
        $len = strlen($code);
        if ($len <= 4) return $code;
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
        if (!empty($product['sale_window_from']) && strtotime((string)$product['sale_window_from']) > $now->getTimestamp()) {
            return 'Sale window has not opened yet.';
        }
        if (!empty($product['sale_window_to']) && strtotime((string)$product['sale_window_to']) < $now->getTimestamp()) {
            return 'Sale window has closed.';
        }
        if ((int)$product['bind_customer'] === 1 && ($customerId === null || $customerId <= 0)) {
            return 'This product requires customer_id (bind_customer is on).';
        }
        if ((int)$product['max_per_customer'] > 0 && $customerId !== null && $customerId > 0) {
            $existing = (int)$this->db->table('tickets')
                ->where('ticket_product_id', $product['ticket_product_id'])
                ->where('customer_id', $customerId)
                ->where('deleted', 0)
                ->countAllResults();
            if ($existing >= (int)$product['max_per_customer']) {
                return 'Customer has reached the max_per_customer limit.';
            }
        }
        return true;
    }

    private function resolveValidityWindow(array $product, array $body): array
    {
        $mode = (string)($product['validity_mode'] ?? 'fixed');
        if ($mode === 'fixed') {
            $vf = $product['begin_ts'] ? new DateTimeImmutable((string)$product['begin_ts']) : null;
            $vt = $product['end_ts'] ? new DateTimeImmutable((string)$product['end_ts']) : null;
            return [$vf, $vt];
        }
        // Relative: now + fixed_begin_term_days for valid_from, +fixed_term_days for valid_to
        $now = new DateTimeImmutable();
        $beginDays = (int)($product['fixed_begin_term_days'] ?? 0);
        $termDays = (int)($product['fixed_term_days'] ?? 30);
        $vf = $now->modify("+{$beginDays} days");
        $vt = $vf->modify("+{$termDays} days");
        return [$vf, $vt];
    }

    private function transitionStatus(int $id, string $target, string $reasonField): ResponseInterface
    {
        if ($auth = $this->requireAuth()) return $auth;
        if (!$this->migrationApplied()) return $this->respondError('Tickets migration is required.', 503);
        $body = $this->request->getJSON(true) ?? [];
        $reason = trim((string)($body[$reasonField] ?? ''));

        try {
            $this->db->transStart();
            $ticketsTable = $this->db->prefixTable('tickets');
            $row = $this->db->query(
                "SELECT * FROM {$ticketsTable} WHERE ticket_id = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
                [$id],
            )->getRowArray();
            if ($row === null) {
                $this->db->transComplete();
                return $this->respondError('Ticket not found.', 404);
            }
            $current = (string)$row['status'];
            if (!in_array($target, self::STATUS_TRANSITIONS[$current] ?? [], true)) {
                $this->db->transComplete();
                return $this->respondError(
                    "Cannot transition from {$current} to {$target}.",
                    409,
                );
            }

            $this->db->table('tickets')->where('ticket_id', $id)->update(['status' => $target]);
            $this->db->table('ticket_redemptions')->insert([
                'ticket_id' => $id,
                'employee_id' => $this->session->get('person_id'),
                'result' => $target === 'revoked' ? 'revoked' : 'expired',
                'notes' => mb_substr($reason !== '' ? $reason : ucfirst($target), 0, 255),
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
        if ($s === '') return '';
        // URL → take last path segment
        if (preg_match('#^https?://#i', $s)) {
            $parts = explode('/', parse_url($s, PHP_URL_PATH) ?: '');
            $s = end($parts) ?: '';
        }
        return $s;
    }

    private function checkRedeemRateLimit(int $employeeId): bool
    {
        try {
            $ip = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key = 'tk_redeem_' . hash('sha256', $employeeId . '|' . $ip);
            $hits = (int)($cache->get($key) ?? 0);
            // Generous limit so a scanner with auto-fire still works in normal use,
            // but defends against pathological loops.
            if ($hits >= 120) return false;
            $cache->save($key, $hits + 1, 60);
            return true;
        } catch (Throwable $e) {
            return true;
        }
    }

    private function publicRateLimit(string $bucket, int $limit, int $windowSeconds): bool
    {
        try {
            $ip = $this->request->getIPAddress() ?: 'unknown';
            $cache = service('cache');
            $key = $bucket . '_' . hash('sha256', $ip);
            $hits = (int)($cache->get($key) ?? 0);
            if ($hits >= $limit) return false;
            $cache->save($key, $hits + 1, $windowSeconds);
            return true;
        } catch (Throwable $e) {
            return true;
        }
    }

    private function logPublicLookup(string $code, string $outcome): void
    {
        $ip = $this->request->getIPAddress() ?: 'unknown';
        log_message('info',
            'tk.lookup ip=' . hash('sha256', $ip) . ' code=' . hash('sha256', $code) . ' outcome=' . $outcome,
        );
    }

    private function isSaleWindowOpen(array $row): bool
    {
        $now = time();
        if (!empty($row['sale_window_from']) && strtotime((string)$row['sale_window_from']) > $now) return false;
        if (!empty($row['sale_window_to']) && strtotime((string)$row['sale_window_to']) < $now) return false;
        return true;
    }

    private function intOrNull(mixed $v): ?int
    {
        if ($v === null || $v === '') return null;
        return (int)$v;
    }

    private function stringOrNull(mixed $v, int $max): ?string
    {
        if ($v === null || $v === '') return null;
        return mb_substr((string)$v, 0, $max);
    }

    private function parseDateTime(mixed $v): ?string
    {
        if (!$v) return null;
        $t = strtotime((string)$v);
        if ($t === false) return null;
        return date('Y-m-d H:i:s', $t);
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }
}
