<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;

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
        if (! preg_match('/^[A-Za-z0-9_-]{1,32}$/', $tableId)) {
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
        $items = array_map(static fn (array $row): array => [
            'item_id'     => (int) $row['item_id'],
            'name'        => (string) $row['name'],
            'category'    => (string) ($row['category'] ?? 'Mains'),
            'unit_price'  => (float) $row['unit_price'],
            'description' => (string) ($row['description'] ?? ''),
            'available'   => true,
        ], $rows);

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
        return $this->delegateToGiftcards('publicBalance', $code);
    }

    /**
     * GET /api/public/giftcards/transfer/:token
     * Sanitized preview of a pending send-as-gift transfer.
     */
    public function giftcardTransferLookup(string $token): ResponseInterface
    {
        return $this->delegateToGiftcards('publicTransferLookup', $token);
    }

    /**
     * POST /api/public/giftcards/transfer/:token/accept
     * Recipient accepts the transfer — rotates the giftcard_number, returns
     * the NEW code (one-shot, never re-derivable from the DB).
     */
    public function giftcardTransferAccept(string $token): ResponseInterface
    {
        return $this->delegateToGiftcards('publicTransferAccept', $token);
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
        return $this->delegateToTickets('publicLookup', $code);
    }

    public function ticketTransferRequest(string $code): ResponseInterface
    {
        return $this->delegateToTickets('ticketTransferRequest', $code);
    }

    public function ticketTransferConfirm(string $code): ResponseInterface
    {
        return $this->delegateToTickets('ticketTransferConfirm', $code);
    }

    public function ticketIcs(string $code): ResponseInterface
    {
        return $this->delegateToTickets('publicTicketIcs', $code);
    }

    public function ticketGoogleWallet(string $code): ResponseInterface
    {
        return $this->delegateToTickets('publicTicketGoogleWallet', $code);
    }

    public function ticketAppleWallet(string $code): ResponseInterface
    {
        return $this->delegateToTickets('publicTicketAppleWallet', $code);
    }

    private function delegateToTickets(string $method, string $code): ResponseInterface
    {
        $tk = new TicketsController();
        $tk->initController($this->request, $this->response, service('logger'));

        return $tk->{$method}($code);
    }

    /**
     * POST /api/public/giftcards/:code/disable
     * Self-service disable (freezes balance). OTP-gated; only available when
     * the card has an active phone binding.
     */
    public function giftcardPublicDisable(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicDisable', $code);
    }

    /**
     * GET /api/public/giftcards/:code/binding — sanitised binding lookup.
     * POST /api/public/giftcards/:code/binding/otp — send OTP for unbind/disable.
     * DELETE /api/public/giftcards/:code/binding — OTP-gated customer unbind.
     */
    public function giftcardPublicBinding(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicBinding', $code);
    }

    public function giftcardPublicOtp(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicSendOtp', $code);
    }

    public function giftcardPublicUnbind(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicUnbind', $code);
    }

    /**
     * GET /api/public/giftcards/:code/wallet/google — Save-to-Google-Wallet URL.
     * GET /api/public/giftcards/:code/wallet/apple  — Apple .pkpass download.
     */
    public function giftcardGoogleWallet(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicGoogleWallet', $code);
    }

    public function giftcardAppleWallet(string $code): ResponseInterface
    {
        return $this->delegateToGiftcards('publicAppleWallet', $code);
    }

    private function delegateToGiftcards(string $method, string $arg): ResponseInterface
    {
        $gc = new GiftcardsController();
        $gc->initController($this->request, $this->response, service('logger'));

        return $gc->{$method}($arg);
    }
}
