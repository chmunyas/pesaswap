<?php

namespace App\Libraries;

use RuntimeException;
use ZipArchive;

/**
 * Apple_pkpass_lib — builds a signed Apple Wallet (.pkpass) bundle for
 * an issued ticket.
 *
 * A .pkpass is a ZIP containing:
 *   - pass.json      (the pass content: barcode, fields, brand colors)
 *   - manifest.json  (sha1 of every file in the bundle)
 *   - signature      (CMS / PKCS#7 detached signature of manifest.json)
 *   - icon.png       (29x29, required)
 *   - icon@2x.png    (58x58, optional but recommended)
 *   - logo.png       (variable, optional)
 *
 * Signing requires:
 *   - The merchant's Pass Type ID certificate (PEM)
 *   - The matching private key (PEM, optionally password-protected)
 *   - The Apple WWDR intermediate certificate (PEM)
 *
 * All three live in app_config keys ticket_apple_pass_cert_pem,
 * ticket_apple_pass_key_pem, ticket_apple_wwdr_cert_pem (+
 * ticket_apple_pass_key_password if the key is encrypted). If any are
 * empty, build() throws a RuntimeException — the endpoint that calls it
 * should turn that into a clean 503 response so the operator knows the
 * feature is gated on configuration.
 *
 * Icons: a 1x1 transparent PNG fallback is used if no merchant logo is
 * available. This keeps the pass schema-valid even in the bare-bones
 * default deployment.
 */
class Apple_pkpass_lib
{
    /**
     * Build a .pkpass bundle as a binary string.
     *
     * @param object $ticket        Hydrated tickets row.
     * @param object $product       ospos_ticket_products row.
     * @param string $redemptionUrl Full URL embedded in the QR.
     *
     * @return string Binary .pkpass content (a ZIP archive).
     */
    public function build(object $ticket, object $product, string $redemptionUrl): string
    {
        [$certPem, $keyPem, $keyPassword, $wwdrPem, $passTypeId, $teamId] = $this->loadCredentials();

        $passJson    = $this->buildPassJson($ticket, $product, $redemptionUrl, $passTypeId, $teamId);
        $passJsonStr = json_encode($passJson, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($passJsonStr === false) {
            throw new RuntimeException('Failed to encode pass.json');
        }

        $iconPng = $this->fallbackIcon();

        $files = [
            'pass.json'   => $passJsonStr,
            'icon.png'    => $iconPng,
            'icon@2x.png' => $iconPng,
            'logo.png'    => $iconPng,
        ];

        $manifest = [];

        foreach ($files as $name => $contents) {
            $manifest[$name] = sha1($contents);
        }
        $manifestJson = json_encode($manifest, JSON_UNESCAPED_SLASHES);
        if ($manifestJson === false) {
            throw new RuntimeException('Failed to encode manifest.json');
        }

        $signature = $this->signManifest($manifestJson, $certPem, $keyPem, $keyPassword, $wwdrPem);

        return $this->buildZip([
            'pass.json'     => $passJsonStr,
            'manifest.json' => $manifestJson,
            'signature'     => $signature,
            'icon.png'      => $iconPng,
            'icon@2x.png'   => $iconPng,
            'logo.png'      => $iconPng,
        ]);
    }

    /**
     * Build a .pkpass bundle representing a GIFT CARD (Apple's `storeCard`
     * style). Same crypto pipeline as `build()` — same pass type id, same
     * signing chain — only the pass.json schema differs.
     *
     * @param object $card          Hydrated giftcards row. Expects:
     *                              giftcard_number, value, currency,
     *                              recipient_name, sender_name, message,
     *                              expires_at.
     * @param string $redemptionUrl Full URL embedded in the QR (typically
     *                              the public balance page /g/:code).
     * @param string $brand         Merchant display name (e.g. PESASWAP).
     *
     * @return string Binary .pkpass content (a ZIP archive).
     */
    public function buildGiftCard(object $card, string $redemptionUrl, string $brand = 'PESASWAP'): string
    {
        [$certPem, $keyPem, $keyPassword, $wwdrPem, $passTypeId, $teamId] = $this->loadCredentials();

        $passJson    = $this->buildGiftCardPassJson($card, $redemptionUrl, $passTypeId, $teamId, $brand);
        $passJsonStr = json_encode($passJson, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($passJsonStr === false) {
            throw new RuntimeException('Failed to encode gift-card pass.json');
        }

        $iconPng = $this->fallbackIcon();

        $files = [
            'pass.json'   => $passJsonStr,
            'icon.png'    => $iconPng,
            'icon@2x.png' => $iconPng,
            'logo.png'    => $iconPng,
        ];

        $manifest = [];
        foreach ($files as $name => $contents) {
            $manifest[$name] = sha1($contents);
        }
        $manifestJson = json_encode($manifest, JSON_UNESCAPED_SLASHES);
        if ($manifestJson === false) {
            throw new RuntimeException('Failed to encode gift-card manifest.json');
        }

        $signature = $this->signManifest($manifestJson, $certPem, $keyPem, $keyPassword, $wwdrPem);

        return $this->buildZip([
            'pass.json'     => $passJsonStr,
            'manifest.json' => $manifestJson,
            'signature'     => $signature,
            'icon.png'      => $iconPng,
            'icon@2x.png'   => $iconPng,
            'logo.png'      => $iconPng,
        ]);
    }

    /**
     * Gift-card pass.json. Uses Apple's `storeCard` style: a primary
     * balance field on the front + secondary holder/sender + auxiliary
     * code/expiry. Background defaults to the brand emerald gradient
     * (rgb(16,185,129)) to match the in-app card.
     */
    private function buildGiftCardPassJson(object $card, string $redemptionUrl, string $passTypeId, string $teamId, string $brand): array
    {
        $currency = (string) ($card->currency ?? 'KES');
        $balance  = (float) ($card->value ?? 0);
        $code     = (string) ($card->giftcard_number ?? '');

        $secondary = [];
        if (! empty($card->recipient_name)) {
            $secondary[] = [
                'key'   => 'recipient',
                'label' => 'FOR',
                'value' => (string) $card->recipient_name,
            ];
        }
        if (! empty($card->sender_name)) {
            $secondary[] = [
                'key'   => 'sender',
                'label' => 'FROM',
                'value' => (string) $card->sender_name,
            ];
        }

        $auxiliary = [
            [
                'key'   => 'code',
                'label' => 'CODE',
                'value' => $code,
            ],
        ];
        if (! empty($card->expires_at)) {
            $auxiliary[] = [
                'key'       => 'expires',
                'label'     => 'EXPIRES',
                'value'     => $this->w3cDate($card->expires_at),
                'dateStyle' => 'PKDateStyleMedium',
            ];
        }

        return [
            'formatVersion'      => 1,
            'passTypeIdentifier' => $passTypeId,
            'teamIdentifier'     => $teamId,
            'serialNumber'       => $code !== '' ? $code : (string) ($card->giftcard_id ?? ''),
            'organizationName'   => $brand,
            'description'        => 'Gift card',
            'logoText'           => $brand,
            'foregroundColor'    => 'rgb(255,255,255)',
            'backgroundColor'    => 'rgb(16,185,129)',
            'labelColor'         => 'rgb(255,255,255)',
            'storeCard'          => [
                'headerFields'    => [
                    [
                        'key'   => 'kind',
                        'label' => 'GIFT CARD',
                        'value' => $brand,
                    ],
                ],
                'primaryFields'   => [
                    [
                        'key'          => 'balance',
                        'label'        => 'BALANCE',
                        'value'        => $balance,
                        'currencyCode' => $currency,
                    ],
                ],
                'secondaryFields' => $secondary,
                'auxiliaryFields' => $auxiliary,
                'backFields'      => array_values(array_filter([
                    ! empty($card->message) ? [
                        'key'   => 'message',
                        'label' => 'MESSAGE',
                        'value' => (string) $card->message,
                    ] : null,
                    [
                        'key'   => 'redeem',
                        'label' => 'CHECK BALANCE',
                        'value' => $redemptionUrl,
                    ],
                ])),
            ],
            'barcodes' => [
                [
                    'format'          => 'PKBarcodeFormatQR',
                    'message'         => $redemptionUrl,
                    'messageEncoding' => 'iso-8859-1',
                    'altText'         => $code,
                ],
            ],
        ];
    }

    /**
     * @return array{0:string,1:string,2:string,3:string,4:string,5:string}
     */
    private function loadCredentials(): array
    {
        $db = db_connect();

        $get = static function (string $key) use ($db): string {
            $row = $db->table('app_config')->where('key', $key)->get()->getRowArray();

            return $row !== null ? (string) $row['value'] : '';
        };

        $cert       = $get('ticket_apple_pass_cert_pem');
        $key        = $get('ticket_apple_pass_key_pem');
        $keyPwd     = $get('ticket_apple_pass_key_password');
        $wwdr       = $get('ticket_apple_wwdr_cert_pem');
        $passTypeId = $get('ticket_apple_pass_type_id');
        $teamId     = $get('ticket_apple_team_id');

        if ($cert === '' || $key === '' || $wwdr === '' || $passTypeId === '' || $teamId === '') {
            throw new RuntimeException(
                'Apple Wallet is not configured. Set ticket_apple_pass_cert_pem, '
                . 'ticket_apple_pass_key_pem, ticket_apple_wwdr_cert_pem, '
                . 'ticket_apple_pass_type_id and ticket_apple_team_id.',
            );
        }

        return [$cert, $key, $keyPwd, $wwdr, $passTypeId, $teamId];
    }

    private function buildPassJson(object $ticket, object $product, string $redemptionUrl, string $passTypeId, string $teamId): array
    {
        $bgColor = $this->cssToAppleColor((string) ($product->color ?? ''));

        return [
            'formatVersion'      => 1,
            'passTypeIdentifier' => $passTypeId,
            'teamIdentifier'     => $teamId,
            'serialNumber'       => (string) ($ticket->code ?? (string) $ticket->ticket_id),
            'organizationName'   => (string) ($product->brand_name ?? 'Tickets'),
            'description'        => (string) ($product->title ?? 'Ticket'),
            'logoText'           => (string) ($product->brand_name ?? 'Ticket'),
            'foregroundColor'    => 'rgb(255,255,255)',
            'backgroundColor'    => $bgColor,
            'labelColor'         => 'rgb(255,255,255)',
            'eventTicket'        => [
                'headerFields' => [
                    [
                        'key'   => 'event',
                        'label' => 'EVENT',
                        'value' => (string) ($product->title ?? ''),
                    ],
                ],
                'primaryFields'   => [],
                'secondaryFields' => array_values(array_filter([
                    ! empty($ticket->valid_from) ? [
                        'key'       => 'starts',
                        'label'     => 'STARTS',
                        'value'     => $this->w3cDate($ticket->valid_from),
                        'dateStyle' => 'PKDateStyleMedium',
                        'timeStyle' => 'PKDateStyleShort',
                    ] : null,
                    ! empty($ticket->valid_to) ? [
                        'key'       => 'ends',
                        'label'     => 'ENDS',
                        'value'     => $this->w3cDate($ticket->valid_to),
                        'dateStyle' => 'PKDateStyleMedium',
                        'timeStyle' => 'PKDateStyleShort',
                    ] : null,
                ])),
                'auxiliaryFields' => [
                    [
                        'key'   => 'code',
                        'label' => 'CODE',
                        'value' => (string) $ticket->code,
                    ],
                ],
            ],
            'barcodes' => [
                [
                    'format'          => 'PKBarcodeFormatQR',
                    'message'         => $redemptionUrl,
                    'messageEncoding' => 'iso-8859-1',
                    'altText'         => (string) $ticket->code,
                ],
            ],
            'relevantDate' => ! empty($ticket->valid_from) ? $this->w3cDate($ticket->valid_from) : null,
        ];
    }

    /**
     * Sign manifest.json with the merchant's Pass Type ID cert + key,
     * including the Apple WWDR intermediate cert in the CMS chain. Returns
     * the raw DER signature bytes.
     */
    private function signManifest(string $manifestJson, string $certPem, string $keyPem, string $keyPassword, string $wwdrPem): string
    {
        if (! function_exists('openssl_pkcs7_sign')) {
            throw new RuntimeException('ext-openssl is required to sign .pkpass bundles.');
        }

        $manifestTmp  = tempnam(sys_get_temp_dir(), 'pkpass_manifest_');
        $signatureTmp = tempnam(sys_get_temp_dir(), 'pkpass_signature_');
        $wwdrTmp      = tempnam(sys_get_temp_dir(), 'pkpass_wwdr_');

        try {
            file_put_contents($manifestTmp, $manifestJson);
            file_put_contents($wwdrTmp, $wwdrPem);

            $key = $keyPassword !== '' ? [$keyPem, $keyPassword] : $keyPem;
            $ok  = openssl_pkcs7_sign(
                $manifestTmp,
                $signatureTmp,
                $certPem,
                $key,
                [],
                PKCS7_BINARY | PKCS7_DETACHED,
                $wwdrTmp,
            );
            if (! $ok) {
                throw new RuntimeException('openssl_pkcs7_sign failed: ' . openssl_error_string());
            }

            $signedSmime = (string) file_get_contents($signatureTmp);
            // PKCS#7 S/MIME has a multipart structure — extract the binary signature blob.
            if (! preg_match('/^Content-Disposition: attachment;.*?\r?\n\r?\n(.*?)\r?\n-----END/ms', $signedSmime, $matches)) {
                throw new RuntimeException('Could not extract DER signature from S/MIME output.');
            }
            $b64 = preg_replace('/\s+/', '', $matches[1]);
            $der = base64_decode($b64, true);
            if ($der === false) {
                throw new RuntimeException('Failed to base64-decode S/MIME signature.');
            }

            return $der;
        } finally {
            @unlink($manifestTmp);
            @unlink($signatureTmp);
            @unlink($wwdrTmp);
        }
    }

    private function buildZip(array $files): string
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('ext-zip is required to build .pkpass bundles.');
        }

        $zipPath = tempnam(sys_get_temp_dir(), 'pkpass_');

        try {
            $zip = new ZipArchive();
            if ($zip->open($zipPath, ZipArchive::OVERWRITE) !== true) {
                throw new RuntimeException('Could not create .pkpass ZIP archive.');
            }

            foreach ($files as $name => $contents) {
                $zip->addFromString($name, $contents);
            }
            $zip->close();

            return (string) file_get_contents($zipPath);
        } finally {
            @unlink($zipPath);
        }
    }

    /**
     * Apple wants colors in rgb(r,g,b) form. Accept hex (#rrggbb) or
     * already-formatted rgb(...) strings; fall back to fuchsia.
     */
    private function cssToAppleColor(string $color): string
    {
        $c = trim($color);
        if ($c === '') {
            return 'rgb(168,85,247)';
        }
        if (preg_match('/^#([0-9a-fA-F]{6})$/', $c, $m)) {
            $hex = $m[1];

            return 'rgb(' . hexdec(substr($hex, 0, 2)) . ',' . hexdec(substr($hex, 2, 2)) . ',' . hexdec(substr($hex, 4, 2)) . ')';
        }
        if (str_starts_with($c, 'rgb(')) {
            return $c;
        }

        return 'rgb(168,85,247)';
    }

    private function w3cDate(string $datetime): string
    {
        $ts = strtotime($datetime);
        if ($ts === false) {
            return $datetime;
        }

        // Apple wants W3C / ISO 8601 with TZ offset (e.g. 2026-07-01T09:00:00+00:00)
        return gmdate('c', $ts);
    }

    /**
     * 1x1 transparent PNG used when no merchant logo is uploaded. Keeps
     * the pass schema-valid (icon.png is mandatory) without requiring
     * deployment-time assets.
     */
    private function fallbackIcon(): string
    {
        // Pre-built 1x1 transparent PNG
        return base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=',
            true,
        );
    }
}
