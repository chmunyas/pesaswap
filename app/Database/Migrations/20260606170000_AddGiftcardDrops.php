<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Gift Drops (hongbao-style) — Slice E.4 of the gift cards modernization.
 *
 * Adds:
 *   - ospos_giftcard_drops: parent drop record (total, slots, distribution,
 *     memorable-phrase share token).
 *   - ospos_giftcard_drop_claims: per-slot claim record (mints a fresh
 *     gift card per claim, idempotent on phone).
 *
 * Schema lives in sqlscripts/3.4.10_giftcard_drops.sql so the same DDL
 * can be applied via spark migrate or psql/mysql client during disaster
 * recovery without re-running the PHP migration runner.
 */
class AddGiftcardDrops extends Migration
{
    private const NEW_TABLES = [
        'giftcard_drop_claims',
        'giftcard_drops',
    ];

    private const NEW_APP_CONFIG_KEYS = [
        'giftcard_drop_default_ttl_hours',
        'giftcard_drop_max_slots',
        'giftcard_drop_min_slice',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.10_giftcard_drops.sql');
    }

    public function down(): void
    {
        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }

        $this->db->table('app_config')
            ->whereIn('key', self::NEW_APP_CONFIG_KEYS)
            ->delete();
    }
}
