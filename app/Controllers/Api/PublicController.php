<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\HTTP\RequestInterface;
use Psr\Log\LoggerInterface;

/**
 * PublicController — exposes customer-safe endpoints that do NOT require a
 * merchant session. Used by the customer-facing mobile pages
 * (/menu/:tableId, /pay, /t/:tableId) which are scanned by walk-in
 * customers without a login.
 *
 * Only returns minimal customer-safe fields (id, name, price, category,
 * description, availability). Never exposes cost prices, supplier info,
 * employee data, or other merchant-only fields.
 *
 * Designed to be cacheable by the PWA service worker (per-tableId URL means
 * different tables / merchants can be cached independently without leaking
 * across each other).
 */
class PublicController extends BaseApiController
{
    /**
     * GET /api/public/menu/:tableId
     *
     * Returns the catalogue of items available for ordering at a given table.
     * The tableId is treated as opaque — in this v1 we return all available
     * items regardless of table; in a multi-tenant deployment this would
     * resolve the table -> merchant and scope items accordingly.
     */
    public function menu(string $tableId): ResponseInterface
    {
        // Sanitize: tableId must be 1-32 chars, alphanumeric + dash/underscore only
        if (!preg_match('/^[A-Za-z0-9_-]{1,32}$/', $tableId)) {
            return $this->respondError('Invalid table identifier.', 400);
        }

        $rows = $this->db->table('items')
            ->select('item_id, name, category, unit_price, description')
            ->where('deleted', 0)
            ->orderBy('category', 'ASC')
            ->orderBy('name', 'ASC')
            ->limit(200)
            ->get()
            ->getResultArray();

        // Project to a customer-safe shape only (no cost_price, no supplier, etc.)
        // Stock-level availability is intentionally omitted here — the menu
        // is meant to show the catalogue; live availability is shown at the
        // point of order placement.
        $items = array_map(static function (array $row): array {
            return [
                'item_id'     => (int)$row['item_id'],
                'name'        => (string)$row['name'],
                'category'    => (string)($row['category'] ?? 'Mains'),
                'unit_price'  => (float)$row['unit_price'],
                'description' => (string)($row['description'] ?? ''),
                'available'   => true,
            ];
        }, $rows);

        return $this->respondSuccess([
            'table_id' => $tableId,
            'items'    => $items,
        ]);
    }

    /**
     * GET /api/public/giftcards/balance/:code
     *
     * Customer-facing balance lookup. Delegates to GiftcardsController which
     * handles the rate limiting, sanitization, and audit logging.
     */
    public function giftcardBalance(string $code): ResponseInterface
    {
        $gc = new GiftcardsController();
        $gc->initController($this->request, $this->response, service('logger'));
        return $gc->publicBalance($code);
    }

    /**
     * GET /api/public/tickets/:code
     *
     * Customer-facing ticket lookup (delegates to TicketsController). Uses
     * the short human-readable ticket code, NOT the JWT — the JWT stays
     * inside the QR payload so it doesn't leak via URL logs.
     */
    public function ticketLookup(string $code): ResponseInterface
    {
        $tk = new TicketsController();
        $tk->initController($this->request, $this->response, service('logger'));
        return $tk->publicLookup($code);
    }
}
