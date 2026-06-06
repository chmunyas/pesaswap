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

    /**
     * Build a Save-to-Google-Wallet URL for a GIFT CARD.
     *
     * Uses Google Wallet's GiftCardObject / GiftCardClass passes
     * instead of the EventTicket flow. Same JWT signing path + same
     * credentials, so configuration is shared with the ticket pipeline.
     *
     * @param object $card          Hydrated giftcards row. Expects:
     *                              giftcard_id, giftcard_number, value,
     *                              currency, recipient_name, sender_name,
     *                              message, expires_at.
     * @param string $redemptionUrl Full URL embedded in the QR (typically
     *                              the public balance page /g/:code).
     * @param string $brand         Merchant display name (e.g. PESASWAP).
     *
     * @return string Save-to-wallet URL.
     */
    public function buildGiftCardSaveUrl(object $card, string $redemptionUrl, string $brand = 'PESASWAP'): string
    {
        [$privateKey, $clientEmail, $issuerId] = $this->loadCredentials();

        // One class per merchant brand is enough — gift cards don't have
        // "products" the way tickets do. We bucket all gift cards under a
        // single class so the merchant only has to approve it once.
        $classId  = $issuerId . '.giftcard_class_default';
        $objectId = $issuerId . '.giftcard_' . (int) ($card->giftcard_id ?? 0);

        $giftCardClass = [
            'id'                 => $classId,
            'issuerName'         => $brand,
            'reviewStatus'       => 'UNDER_REVIEW',
            'hexBackgroundColor' => '#10b981',
            'cardTitle'          => [
                'defaultValue' => ['language' => 'en-US', 'value' => 'Gift Card'],
            ],
        ];

        $balance     = (float) ($card->value ?? 0);
        $currency    = (string) ($card->currency ?? 'KES');
        $code        = (string) ($card->giftcard_number ?? '');
        $recipient   = trim((string) ($card->recipient_name ?? ''));
        $sender      = trim((string) ($card->sender_name ?? ''));
        $displayName = $recipient !== '' && $sender !== ''
            ? "{$sender} → {$recipient}"
            : ($recipient !== '' ? "Gift for {$recipient}" : ($sender !== '' ? "Gift from {$sender}" : 'Gift card'));

        $giftCardObject = [
            'id'           => $objectId,
            'classId'      => $classId,
            'state'        => 'ACTIVE',
            'cardNumber'   => $code,
            'eventNumber'  => $code,
            // Google Wallet expects micros (1/1,000,000 of a unit).
            // For a KES 1,000 card this is 1_000_000_000 (1 KES = 10^6 micros).
            'balance'      => [
                'micros'       => (int) round($balance * 1_000_000),
                'currencyCode' => $currency,
            ],
            'balanceUpdateTime' => [
                'date' => gmdate('c'),
            ],
            'header' => [
                'defaultValue' => ['language' => 'en-US', 'value' => $displayName],
            ],
            'barcode' => [
                'type'          => 'QR_CODE',
                'value'         => $redemptionUrl,
                'alternateText' => $code,
            ],
            'textModulesData' => array_values(array_filter([
                ! empty($card->message) ? [
                    'id'     => 'message',
                    'header' => 'Message',
                    'body'   => (string) $card->message,
                ] : null,
                [
                    'id'     => 'redeem',
                    'header' => 'Redeem',
                    'body'   => "Show this card at any {$brand} merchant or check your balance at the link below.",
                ],
            ])),
            'linksModuleData' => [
                'uris' => [
                    [
                        'uri'         => $redemptionUrl,
                        'description' => 'Check balance',
                    ],
                ],
            ],
        ];

        if (! empty($card->expires_at)) {
            $giftCardObject['validTimeInterval'] = [
                'end' => ['date' => $this->isoDate($card->expires_at)],
            ];
        }

        $payload = [
            'iss'     => $clientEmail,
            'aud'     => 'google',
            'typ'     => 'savetowallet',
            'iat'     => time(),
            'payload' => [
                'giftCardClasses' => [$giftCardClass],
                'giftCardObjects' => [$giftCardObject],
            ],
        ];

        $jwt = JWT::encode($payload, $privateKey, 'RS256');

        return 'https://pay.google.com/gp/v/save/' . $jwt;
    }

    private function loadCredentials(): array
    {
        $vault    = service('secrets_vault');
        $json     = $vault->get('ticket_google_service_account_json');
        $issuerId = trim($vault->get('ticket_google_issuer_id'));

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
