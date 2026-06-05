<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Phase 2 of the QR Ticketing feature.
 *
 * Adds:
 *   - ticket_product_sessions: dated/recurring occurrences of a product
 *     (multi-night concerts, daily museum entry, movie showtimes, transport
 *     departures). Each session has its own quantity cap + counter.
 *   - ticket_product_tiers: priced SKUs per product (Adult/Child/VIP/Early
 *     Bird). Each tier has its own price, quantity cap + counter.
 *   - ticket_transfers: audit trail + two-step verification state machine
 *     for customer-initiated transfers. Contact PII is HMAC-hashed; only
 *     last 4 chars retained in plaintext for support.
 *   - tickets.session_id + tickets.tier_id (nullable FKs). Existing tickets
 *     remain NULL — interpreted as "legacy, product-level validity only".
 *
 * Bootstraps a random HMAC secret for transfer contact hashing if the
 * operator hasn't set one.
 *
 * Refs:
 *   - app/Database/Migrations/20260604213000_AddTickets.php — Phase 0 baseline
 *   - app/Database/Migrations/sqlscripts/3.4.4_add_ticket_sessions_tiers.sql
 */
class AddTicketSessionsTiers extends Migration
{
    private const NEW_TABLES = [
        'ticket_transfers',
        'ticket_product_tiers',
        'ticket_product_sessions',
    ];
    private const NEW_TICKETS_COLUMNS = ['session_id', 'tier_id'];
    private const NEW_APP_CONFIG_KEYS = [
        'ticket_transfer_hmac_secret',
        'ticket_transfer_verify_ttl_min',
        'ticket_transfer_max_per_ticket',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.4_add_ticket_sessions_tiers.sql');

        $this->seedHmacSecret();
    }

    public function down(): void
    {
        $this->db->query('SET FOREIGN_KEY_CHECKS = 0');

        $ticketsTable = $this->db->prefixTable('tickets');

        foreach (self::NEW_TICKETS_COLUMNS as $col) {
            $fkName = $col === 'session_id' ? 'fk_tk_session' : 'fk_tk_tier';
            $this->db->query("ALTER TABLE `{$ticketsTable}` DROP FOREIGN KEY `{$fkName}`");
            $this->db->query("ALTER TABLE `{$ticketsTable}` DROP COLUMN `{$col}`");
        }

        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }

        $this->db->query('SET FOREIGN_KEY_CHECKS = 1');

        $this->db->table('app_config')
            ->whereIn('key', self::NEW_APP_CONFIG_KEYS)
            ->delete();
    }

    /**
     * Generate a 32-byte random HMAC secret on first run, so the operator
     * doesn't have to manage one manually. Subsequent rotation is a manual
     * UPDATE on app_config (re-keying invalidates existing transfer hashes,
     * which is acceptable since they're audit-only).
     */
    private function seedHmacSecret(): void
    {
        $existing = $this->db->table('app_config')
            ->where('key', 'ticket_transfer_hmac_secret')
            ->get()
            ->getRowArray();

        if ($existing === null) {
            return;
        }

        if (! empty($existing['value'])) {
            return;
        }

        $this->db->table('app_config')
            ->where('key', 'ticket_transfer_hmac_secret')
            ->update(['value' => bin2hex(random_bytes(32))]);
    }
}
