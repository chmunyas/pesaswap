<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Phase 3 of the QR Ticketing feature.
 *
 * Adds:
 *   - ticket_product_translations: per-locale localised title/notice/
 *     description for the customer claim page.
 *   - ticket_delivery_attempts: full audit trail of email/SMS/Apple
 *     wallet/Google wallet delivery attempts with retry metadata.
 *   - app_config defaults for Apple Pass + Google Wallet credentials,
 *     auto-delivery toggles and email/SMS templates.
 *
 * Refs:
 *   - app/Database/Migrations/20260605000000_AddTicketSessionsTiers.php
 *   - app/Database/Migrations/sqlscripts/3.4.5_add_ticket_delivery_translations.sql
 */
class AddTicketDeliveryTranslations extends Migration
{
    private const NEW_TABLES = [
        'ticket_delivery_attempts',
        'ticket_product_translations',
    ];
    private const NEW_APP_CONFIG_KEYS = [
        'ticket_apple_pass_cert_pem',
        'ticket_apple_pass_key_pem',
        'ticket_apple_pass_key_password',
        'ticket_apple_pass_type_id',
        'ticket_apple_team_id',
        'ticket_apple_wwdr_cert_pem',
        'ticket_google_service_account_json',
        'ticket_google_issuer_id',
        'ticket_delivery_email_enabled',
        'ticket_delivery_sms_enabled',
        'ticket_delivery_from_email',
        'ticket_delivery_email_subject',
        'ticket_delivery_sms_template',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.5_add_ticket_delivery_translations.sql');
    }

    public function down(): void
    {
        $this->db->query('SET FOREIGN_KEY_CHECKS = 0');

        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }

        $this->db->query('SET FOREIGN_KEY_CHECKS = 1');

        $this->db->table('app_config')
            ->whereIn('key', self::NEW_APP_CONFIG_KEYS)
            ->delete();
    }
}
