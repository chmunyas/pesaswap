<?php

namespace App\Libraries;

use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Common\Version;
use chillerlan\QRCode\Output\QROutputInterface;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use Config\OSPOS;
use RuntimeException;

/**
 * QR code generation utility.
 *
 * Mirrors the structure of Barcode_lib so view code that already understands
 * inline SVG (receipts, invoices, barcode sheets) can render a QR with one
 * call. Output is SVG by default to keep dompdf and print previews crisp.
 *
 * Requires chillerlan/php-qrcode (see composer.json). Run `composer install`
 * after this file is added.
 */
class Qr_lib
{
    private const SUPPORTED_ECC_LEVELS = [
        'L' => EccLevel::L,
        'M' => EccLevel::M,
        'Q' => EccLevel::Q,
        'H' => EccLevel::H,
    ];

    /**
     * Read the global ticket-related QR defaults from app_config.
     *
     * @return array{
     *     base_url:string,
     *     ecc_level:string,
     *     scale:int,
     *     margin:int,
     * }
     */
    public function get_qr_config(): array
    {
        $config = config(OSPOS::class)->settings;

        return [
            'base_url'  => (string) ($config['ticket_qr_base_url'] ?? base_url('t')),
            'ecc_level' => 'M',
            'scale'     => 6,
            'margin'    => 1,
        ];
    }

    /**
     * Build the redemption URL embedded in the QR for a token.
     */
    public function build_redemption_url(string $token): string
    {
        $base = rtrim($this->get_qr_config()['base_url'], '/');
        if ($base === '') {
            $base = rtrim(base_url('t'), '/');
        }

        return $base . '/' . $token;
    }

    /**
     * Generate an SVG QR for the given data. The returned string is safe to
     * inline directly in HTML (it has no XML preamble) and prints crisply via
     * dompdf.
     *
     * @param array{ecc_level?:string, scale?:int, margin?:int} $overrides
     */
    public function generate_svg(string $data, array $overrides = []): string
    {
        $this->assertDependency();

        $options = $this->build_options($overrides, QROutputInterface::MARKUP_SVG, false);

        return (new QRCode($options))->render($data);
    }

    /**
     * Generate a base64 data: URI suitable for use as <img src="...">.
     *
     * @param array{ecc_level?:string, scale?:int, margin?:int} $overrides
     * @param string                                            $format    'svg' (default) or 'png'
     */
    public function generate_data_uri(string $data, array $overrides = [], string $format = 'svg'): string
    {
        $this->assertDependency();

        $type = match ($format) {
            'png'   => QROutputInterface::GDIMAGE_PNG,
            default => QROutputInterface::MARKUP_SVG,
        };

        $options = $this->build_options($overrides, $type, true);

        return (new QRCode($options))->render($data);
    }

    /**
     * Generate raw PNG bytes (requires ext-gd).
     *
     * @param array{ecc_level?:string, scale?:int, margin?:int} $overrides
     */
    public function generate_png(string $data, array $overrides = []): string
    {
        $this->assertDependency();

        if (!extension_loaded('gd')) {
            throw new RuntimeException('ext-gd is required for PNG QR output. Use generate_svg() instead.');
        }

        $options = $this->build_options($overrides, QROutputInterface::GDIMAGE_PNG, false);

        return (new QRCode($options))->render($data);
    }

    private function build_options(array $overrides, string $outputType, bool $base64): QROptions
    {
        $defaults = $this->get_qr_config();

        $eccCode  = $overrides['ecc_level'] ?? $defaults['ecc_level'];
        $eccConst = self::SUPPORTED_ECC_LEVELS[$eccCode] ?? EccLevel::M;

        return new QROptions([
            'outputType'    => $outputType,
            'outputBase64'  => $base64,
            'eccLevel'      => $eccConst,
            'scale'         => (int) ($overrides['scale']  ?? $defaults['scale']),
            'addQuietzone'  => true,
            'quietzoneSize' => (int) ($overrides['margin'] ?? $defaults['margin']),
            'version'       => Version::AUTO,
        ]);
    }

    private function assertDependency(): void
    {
        if (!class_exists(QRCode::class)) {
            throw new RuntimeException(
                'chillerlan/php-qrcode is not installed. Run `composer install` to install QR ticketing dependencies.'
            );
        }
    }
}

