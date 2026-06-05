<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Phase 5 of the QR Ticketing feature.
 *
 * Adds:
 *   - ticket_promo_codes + ticket_promo_redemptions
 *   - ticket_product_bundles (parent product → child product+tier+session+qty)
 *   - ticket_seat_holds (10-minute checkout seat reservations)
 *   - app_config default: ticket_seat_hold_ttl_min
 */
class AddTicketPromosBundlesSeatHolds extends Migration
{
    private const NEW_TABLES = [
        'ticket_seat_holds',
        'ticket_product_bundles',
        'ticket_promo_redemptions',
        'ticket_promo_codes',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.7_add_ticket_promos_bundles_seat_holds.sql');
    }

    public function down(): void
    {
        $this->db->query('SET FOREIGN_KEY_CHECKS = 0');

        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }

        $this->db->query('SET FOREIGN_KEY_CHECKS = 1');

        $this->db->table('app_config')->where('key', 'ticket_seat_hold_ttl_min')->delete();
    }
}
