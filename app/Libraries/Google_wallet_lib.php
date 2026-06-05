<?php

namespace App\Libraries;

use Firebase\JWT\JWT;
use RuntimeException;
use Throwable;

/**
 * Google_wallet_lib — issues "Add to Google Wallet" save links for tickets.
 *
 * Implements the EventTicketObject save flow:
 *   1. Class (created once by the merchant) describes the brand/event.
 *   2. Object (per-ticket) carries the holder-specific data (barcode,
 *      seat, ticket number).
 *   3. We sign a JWT containing the object as payload; the customer taps
 *      https://pay.google.com/gp/v/save/{jwt} which opens the wallet
 *      with a one-tap "Save" action.
 *
 * Configuration (app_config keys, all required):
 *   - ticket_google_service_account_json: full JSON contents of the
 *     Google service-account key. The library extracts client_email +
 *     private_key from it.
 *   - ticket_google_issuer_id: numeric issuer id from the Google Pay &
 *     Wallet Console (the merchant's account).
 *
 * Limitation: this is the JWT generator only — it does NOT call the
 * Google REST API to upsert the class/object on the server side. For
 * Phase 3, we rely on the "skinny JWT" flow which embeds the full
 * EventTicketObject in the JWT payload; Google creates it on first
 * scan. This avoids needing a Google API client dependency.
 *
 * Ref: https://developers.google.com/wallet/tickets/events/web/jwt
 */
class Google_wallet_lib
{
    /**
     * Build a Save-to-Google-Wallet URL for the given issued ticket.
     *
     * @param object $ticket        Hydrated tickets row (with product joined).
     * @param object $product       ospos_ticket_products row.
     * @param string $redemptionUrl Full URL the customer / staff can visit
     *                              (also embedded in the QR barcode).
     *
     * @return string Save-to-wallet URL.
     *
     * @throws RuntimeException If the merchant hasn't configured wallet
     *                          credentials.
     */
    public function buildSaveUrl(object $ticket, object $product, string $redemptionUrl): string
    {
        [$privateKey, $clientEmail, $issuerId] = $this->loadCredentials();

        $classId  = $issuerId . '.ticket_class_' . (int) $product->ticket_product_id;
        $objectId = $issuerId . '.ticket_' . (int) $ticket->ticket_id;

        $eventClass = [
            'id'        => $classId,
            'eventName' => [
                'defaultValue' => [
                    'language' => 'en-US',
                    'value'    => (string) ($product->title ?? 'Ticket'),
                ],
            ],
            'issuerName'         => (string) ($product->brand_name ?? 'Tickets'),
            'reviewStatus'       => 'UNDER_REVIEW',
            'hexBackgroundColor' => $this->normalizeColor((string) ($product->color ?? '#a855f7')),
        ];

        $eventObject = [
            'id'               => $objectId,
            'classId'          => $classId,
            'state'            => 'ACTIVE',
            'ticketHolderName' => '',
            'ticketNumber'     => (string) ($ticket->code ?? ''),
            'barcode'          => [
                'type'          => 'QR_CODE',
                'value'         => $redemptionUrl,
                'alternateText' => (string) ($ticket->code ?? ''),
            ],
        ];

        if (! empty($ticket->valid_from)) {
            $eventObject['validTimeInterval'] = [
                'start' => ['date' => $this->isoDate($ticket->valid_from)],
            ];
            if (! empty($ticket->valid_to)) {
                $eventObject['validTimeInterval']['end'] = ['date' => $this->isoDate($ticket->valid_to)];
            }
        }

        $payload = [
            'iss'     => $clientEmail,
            'aud'     => 'google',
            'typ'     => 'savetowallet',
            'iat'     => time(),
            'payload' => [
                'eventTicketClasses' => [$eventClass],
                'eventTicketObjects' => [$eventObject],
            ],
        ];

        $jwt = JWT::encode($payload, $privateKey, 'RS256');

        return 'https://pay.google.com/gp/v/save/' . $jwt;
    }

    private function loadCredentials(): array
    {
        $db        = db_connect();
        $jsonRow   = $db->table('app_config')->where('key', 'ticket_google_service_account_json')->get()->getRowArray();
        $issuerRow = $db->table('app_config')->where('key', 'ticket_google_issuer_id')->get()->getRowArray();

        $json     = $jsonRow !== null ? (string) $jsonRow['value'] : '';
        $issuerId = $issuerRow !== null ? trim((string) $issuerRow['value']) : '';

        if ($json === '' || $issuerId === '') {
            throw new RuntimeException('Google Wallet is not configured. Set ticket_google_service_account_json and ticket_google_issuer_id.');
        }

        try {
            $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable $e) {
            throw new RuntimeException('ticket_google_service_account_json is not valid JSON: ' . $e->getMessage());
        }

        $privateKey  = (string) ($decoded['private_key'] ?? '');
        $clientEmail = (string) ($decoded['client_email'] ?? '');

        if ($privateKey === '' || $clientEmail === '') {
            throw new RuntimeException('Google service-account JSON is missing private_key or client_email.');
        }

        return [$privateKey, $clientEmail, $issuerId];
    }

    private function normalizeColor(string $color): string
    {
        $c = trim($color);
        if ($c === '' || ! str_starts_with($c, '#')) {
            // OSPOS uses WeChat-style "Color020" labels — map to a neutral fuchsia.
            return '#a855f7';
        }

        return $c;
    }

    private function isoDate(string $datetime): string
    {
        // EventTicketObject.validTimeInterval expects ISO 8601 yyyy-mm-ddT...
        $ts = strtotime($datetime);
        if ($ts === false) {
            return $datetime;
        }

        return gmdate('c', $ts);
    }
}
