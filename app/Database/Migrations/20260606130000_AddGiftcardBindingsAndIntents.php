<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Phase 6 of the gift cards modernization.
 *
 * Adds:
 *   - ospos_giftcard_bindings: NFC-style card↔phone↔MNO link.
 *   - ospos_giftcard_payment_intents: async authorisation lifecycle for the
 *     multi-tender flow (card balance / MNO / wallet / Co-op / BNPL).
 *   - ospos_pesaswap_wallets: customer wallets, one row per (person, currency).
 *   - ospos_giftcard_otps: hashed OTPs with attempt counters for self-service
 *     unbind/disable verbs.
 *
 * Concurrency invariants enforced via MariaDB generated-column partial uniques:
 *   - one active binding per card
 *   - one in-flight intent per card
 *   - one wallet per (person, currency, not-deleted)
 *
 * Refs:
 *   - app/Database/Migrations/sqlscripts/3.4.9_giftcard_bindings_and_intents.sql
 *   - app/Controllers/Api/GiftcardsController.php (bind/intent surface)
 */
class AddGiftcardBindingsAndIntents extends Migration
{
    private const NEW_TABLES = [
        'giftcard_otps',
        'pesaswap_wallets',
        'giftcard_payment_intents',
        'giftcard_bindings',
    ];

    private const NEW_APP_CONFIG_KEYS = [
        'giftcard_mno_webhook_secret',
        'giftcard_otp_inline_return',
        'giftcard_otp_ttl_minutes',
        'giftcard_intent_ttl_seconds',
        'giftcard_binding_ttl_minutes',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.9_giftcard_bindings_and_intents.sql');
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
