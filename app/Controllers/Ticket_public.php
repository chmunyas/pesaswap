<?php

namespace App\Controllers;

use App\Models\Ticket;
use App\Models\Ticket_product;

/**
 * Public, unauthenticated ticket claim/verify page.
 *
 * Reached via /t/{token}. The token is the full JWT — never expose the raw
 * code_hash here. The page renders a static, printable summary of the ticket
 * with an embedded SVG QR so customers don't have to keep the paper receipt.
 *
 * Does NOT redeem — this is a customer-side view. Redemption is gated behind
 * the authenticated /tickets/redeem endpoint, scanned by a cashier.
 *
 * Rate-limit recommendation (config-driven, enforced in a Filter — Phase 2):
 *   ticket_redemption_rate_limit_per_min applies to /tickets/redeem
 *   we apply the same limit here per-IP to slow down enumeration attempts.
 */
class Ticket_public extends BaseController
{
    public function show(string $token = ''): string
    {
        if ($token === '') {
            return view('tickets/public_show', ['error' => 'missing_token']);
        }

        $payload = service('ticket_token_lib')->verify($token);
        if ($payload === null || !isset($payload['tid'])) {
            return view('tickets/public_show', ['error' => 'invalid']);
        }

        $ticketId = (int) $payload['tid'];

        $row = db_connect()->table('tickets')
            ->select('tickets.*, ticket_products.title AS product_title, ticket_products.subtype, ticket_products.notice, ticket_products.description, ticket_products.color, ticket_products.brand_name, ticket_products.logo_url, ticket_products.service_phone, ticket_products.custom_url, ticket_products.custom_url_name')
            ->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left')
            ->where('tickets.ticket_id', $ticketId)
            ->where('tickets.deleted', 0)
            ->get()
            ->getRow();

        if ($row === null) {
            return view('tickets/public_show', ['error' => 'not_found']);
        }

        $qrSvg = service('qr_lib')->generate_svg(
            service('qr_lib')->build_redemption_url($token)
        );

        return view('tickets/public_show', [
            'ticket' => $row,
            'qr_svg' => $qrSvg,
            'error'  => null,
        ]);
    }
}
