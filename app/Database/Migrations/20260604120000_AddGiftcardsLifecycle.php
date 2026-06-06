<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * PESASWAP gift cards lifecycle migration.
 *
 * Extracts the previously-docs-only SQL at
 * `docs/migrations/2026_06_04_giftcards_lifecycle.sql` into a real CI4
 * migration so that:
 *   - the test DB (ospos_test) picks up the schema automatically via
 *     DatabaseTestTrait's refresh=true → migrate flow
 *   - the subsequent 20260605210000_AddGiftcardSkinsTransferDelivery
 *     migration's `ALTER TABLE ospos_giftcards ADD COLUMN ... AFTER currency`
 *     doesn't fail with "Unknown column 'currency'"
 *   - fresh installations land the lifecycle schema without an
 *     out-of-band manual step
 *
 * Timestamp 20260604120000 places it BEFORE the tickets Phase 0
 * (20260604213000) so it lands before any of the ticket / skins
 * migrations that depend on the giftcards lifecycle columns.
 *
 * Refs:
 *   - app/Database/Migrations/sqlscripts/3.4.2_giftcards_lifecycle.sql
 *   - docs/migrations/2026_06_04_giftcards_lifecycle.sql (original docs-only SQL)
 *   - app/Database/Migrations/20260605210000_AddGiftcardSkinsTransferDelivery.php
 *     (the dependent migration that needed `currency` column)
 */
class AddGiftcardsLifecycle extends Migration
{
    private const NEW_GIFTCARD_COLUMNS = [
        'initial_value', 'status', 'recipient_name', 'recipient_email',
        'sender_name', 'sender_email', 'message', 'currency', 'expires_at',
        'email_status', 'email_sent_at', 'updated_at',
    ];

    private const NEW_GIFTCARD_INDEXES = [
        'idx_giftcards_status',
        'idx_giftcards_recipient_email',
        'idx_giftcards_expires_at',
    ];

    public function up(): void
    {
        helper('migration');

        // Guard: if the columns are already present (existing OSPOS installs
        // that ran the docs/migrations/ SQL manually) skip the ALTER to avoid
        // a duplicate-column error. Test DBs land fresh and pick up the SQL.
        if (! $this->columnExists('giftcards', 'currency')) {
            execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.2_giftcards_lifecycle.sql');
        }
    }

    public function down(): void
    {
        $giftcardsTable = $this->db->prefixTable('giftcards');

        // Drop the history table first (no FK but ordering keeps the
        // rollback inspectable).
        $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . 'giftcard_history`');

        // Drop indexes (ignore errors if they don't exist).
        foreach (self::NEW_GIFTCARD_INDEXES as $idx) {
            try {
                $this->db->query("ALTER TABLE `{$giftcardsTable}` DROP INDEX `{$idx}`");
            } catch (\Throwable $e) {
                // Index didn't exist — fine.
            }
        }

        // Drop columns.
        foreach (self::NEW_GIFTCARD_COLUMNS as $col) {
            try {
                $this->db->query("ALTER TABLE `{$giftcardsTable}` DROP COLUMN `{$col}`");
            } catch (\Throwable $e) {
                // Column didn't exist — fine.
            }
        }
    }

    private function columnExists(string $table, string $column): bool
    {
        $prefixed = $this->db->getPrefix() . $table;
        $row      = $this->db->query(
            "SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [$prefixed, $column],
        )->getRowArray();

        return (int) ($row['n'] ?? 0) > 0;
    }
}
