<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Gift Cards WeChat-parity Phase.
 *
 * Adds:
 *   - giftcard_designs: visual skins (gradient + icon) pickable when issuing.
 *   - giftcard_denominations: preset amounts per currency for one-tap issuance.
 *   - giftcard_transfers: send-as-gift flow. Mirrors ticket_transfers but with
 *     code rotation on accept (the only way to make ownership transfer real
 *     on a bearer instrument that legacy POS redeems by code alone).
 *   - giftcards.design_id, denomination_amount_snapshot,
 *     denomination_label_snapshot, deliver_at, delivered_at, delivery_status.
 *
 * Refs:
 *   - app/Database/Migrations/sqlscripts/3.4.8_giftcards_skins_transfer_delivery_denominations.sql
 *   - app/Controllers/Api/GiftcardsController.php
 */
class AddGiftcardSkinsTransferDelivery extends Migration
{
    private const NEW_TABLES = [
        'giftcard_transfers',
        'giftcard_denominations',
        'giftcard_designs',
    ];

    private const NEW_GIFTCARD_COLUMNS = [
        'delivery_status',
        'delivered_at',
        'deliver_at',
        'denomination_label_snapshot',
        'denomination_amount_snapshot',
        'design_id',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.8_giftcards_skins_transfer_delivery_denominations.sql');
    }

    public function down(): void
    {
        $giftcardsTable = $this->db->prefixTable('giftcards');

        // Drop the indexes we added before dropping columns
        $this->db->query("ALTER TABLE `{$giftcardsTable}` DROP KEY IF EXISTS `idx_delivery_due`");
        $this->db->query("ALTER TABLE `{$giftcardsTable}` DROP KEY IF EXISTS `idx_design`");

        foreach (self::NEW_GIFTCARD_COLUMNS as $col) {
            $this->db->query("ALTER TABLE `{$giftcardsTable}` DROP COLUMN IF EXISTS `{$col}`");
        }

        foreach (self::NEW_TABLES as $table) {
            $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . $table . '`');
        }
    }
}
