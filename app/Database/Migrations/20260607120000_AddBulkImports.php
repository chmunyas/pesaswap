<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Slice F.1 — Bulk-import audit log.
 *
 * Adds:
 *   - ospos_bulk_imports: one row per batched POST /api/{entity}/bulk.
 *
 * Used by App\Libraries\BulkImportLib::run() to record every batch.
 */
class AddBulkImports extends Migration
{
    private const NEW_TABLES = ['bulk_imports'];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.12_bulk_imports.sql');
    }

    public function down(): void
    {
        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }
    }
}
