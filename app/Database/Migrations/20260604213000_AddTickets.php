<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use RuntimeException;

/**
 * Phase 0 of the QR Ticketing feature.
 *
 * Adds:
 *   - schema for ticket products, ticket instances, redemptions, signing keys,
 *     webhook subscriptions and webhook delivery queue
 *   - the `tickets` module and its `tickets_redeem` submodule (+ default admin
 *     grants) using the same convention as `giftcards`, `items_stock`, etc.
 *   - app_config defaults for the QR base URL and default code type
 *   - an initial RS256 RSA signing key pair (generated at migration time so it
 *     never ends up in source control)
 *
 * Refs:
 *   - app/Database/Migrations/sqlscripts/initial_schema.sql:311 (modules seed)
 *   - app/Database/Migrations/sqlscripts/initial_schema.sql:372 (permissions seed)
 *   - app/Database/Migrations/sqlscripts/initial_schema.sql:418 (grants seed)
 *   - app/Database/Migrations/20260506000000_AddShortcutKeys.php (data-seed pattern)
 */
class AddTickets extends Migration
{
    /**
     * Tables this migration creates, in dependency-safe drop order.
     */
    private const TICKET_TABLES = [
        'ticket_webhook_deliveries',
        'ticket_webhooks',
        'ticket_redemptions',
        'tickets',
        'ticket_product_transport',
        'ticket_product_movie',
        'ticket_product_scenic',
        'ticket_product_meeting',
        'ticket_product_locations',
        'ticket_products',
        'ticket_signing_keys',
    ];

    /**
     * Permission rows this migration adds, keyed by permission_id.
     * `null` location_id means a global permission, an int means location-scoped.
     */
    private const TICKET_PERMISSIONS = [
        'tickets'        => null,
        'tickets_redeem' => null,
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.3_add_tickets.sql');

        $this->seedModule();
        $this->seedPermissions();
        $this->seedAppConfig();
        $this->seedInitialSigningKey();
    }

    public function down(): void
    {
        $this->db->query('SET FOREIGN_KEY_CHECKS = 0');

        foreach (self::TICKET_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }

        $this->db->query('SET FOREIGN_KEY_CHECKS = 1');

        $this->db->table('grants')
            ->whereIn('permission_id', array_keys(self::TICKET_PERMISSIONS))
            ->delete();

        $this->db->table('permissions')
            ->whereIn('permission_id', array_keys(self::TICKET_PERMISSIONS))
            ->delete();

        $this->db->table('modules')
            ->whereIn('module_id', ['tickets'])
            ->delete();

        $this->db->table('app_config')
            ->whereIn('key', [
                'ticket_qr_base_url',
                'ticket_default_code_type',
                'ticket_default_color',
                'ticket_default_notice',
                'ticket_jwt_issuer',
                'ticket_redemption_rate_limit_per_min',
            ])
            ->delete();
    }

    private function seedModule(): void
    {
        $this->db->table('modules')->ignore(true)->insert([
            'module_id'     => 'tickets',
            'name_lang_key' => 'module_tickets',
            'desc_lang_key' => 'module_tickets_desc',
            'sort'          => 95,
        ]);
    }

    private function seedPermissions(): void
    {
        foreach (self::TICKET_PERMISSIONS as $permissionId => $locationId) {
            $this->db->table('permissions')->ignore(true)->insert([
                'permission_id' => $permissionId,
                'module_id'     => 'tickets',
                'location_id'   => $locationId,
            ]);

            $this->db->table('grants')->ignore(true)->insert([
                'permission_id' => $permissionId,
                'person_id'     => 1,
            ]);
        }
    }

    private function seedAppConfig(): void
    {
        $defaults = [
            ['key' => 'ticket_qr_base_url',                   'value' => ''],
            ['key' => 'ticket_default_code_type',             'value' => 'qrcode'],
            ['key' => 'ticket_default_color',                 'value' => 'Color010'],
            ['key' => 'ticket_default_notice',                'value' => 'Present this QR code at the entrance for entry.'],
            ['key' => 'ticket_jwt_issuer',                    'value' => 'ospos'],
            ['key' => 'ticket_redemption_rate_limit_per_min', 'value' => '60'],
        ];

        $this->db->table('app_config')->ignore(true)->insertBatch($defaults);
    }

    /**
     * Generate the first RS256 key pair so the system is usable immediately
     * after the migration runs. Subsequent rotation is performed at runtime by
     * Ticket_token_lib::rotateKey().
     *
     * Skip if a key already exists (re-running a migration on an existing DB).
     */
    private function seedInitialSigningKey(): void
    {
        $existing = $this->db->table('ticket_signing_keys')->countAll();
        if ($existing > 0) {
            return;
        }

        if (!function_exists('openssl_pkey_new')) {
            throw new RuntimeException('ext-openssl is required to generate the initial ticket signing key.');
        }

        $resource = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);

        if ($resource === false) {
            throw new RuntimeException('Failed to generate RSA key pair for ticket signing: ' . openssl_error_string());
        }

        if (!openssl_pkey_export($resource, $privateKeyPem)) {
            throw new RuntimeException('Failed to export RSA private key: ' . openssl_error_string());
        }

        $details      = openssl_pkey_get_details($resource);
        $publicKeyPem = $details['key'] ?? null;
        if ($publicKeyPem === null) {
            throw new RuntimeException('Failed to extract RSA public key.');
        }

        $this->db->table('ticket_signing_keys')->insert([
            'algorithm'       => 'RS256',
            'public_key_pem'  => $publicKeyPem,
            'private_key_pem' => $privateKeyPem,
        ]);
    }
}
