<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Phase 4 of the QR Ticketing feature.
 *
 * Adds:
 *   - ticket_scanner_devices: per-device JWT registry for door / gate
 *     staff scanners. Each device gets a long-lived RS256 token scoped
 *     to specific stock_locations and/or ticket_products. Revocation
 *     by setting revoked_at, no global key rotation required.
 *   - ticket_redemptions.scanner_device_id (nullable FK) so individual
 *     scans can be correlated back to the device that produced them
 *     (gate reconciliation, fraud detection).
 */
class AddTicketScannerDevices extends Migration
{
    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.6_add_ticket_scanner_devices.sql');
    }

    public function down(): void
    {
        $this->db->query('SET FOREIGN_KEY_CHECKS = 0');

        $redemptionsTable = $this->db->prefixTable('ticket_redemptions');
        $this->db->query("ALTER TABLE `{$redemptionsTable}` DROP FOREIGN KEY `fk_tr_scanner`");
        $this->db->query("ALTER TABLE `{$redemptionsTable}` DROP COLUMN `scanner_device_id`");

        $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . 'ticket_scanner_devices`');

        $this->db->query('SET FOREIGN_KEY_CHECKS = 1');
    }
}
