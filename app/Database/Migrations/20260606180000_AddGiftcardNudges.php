<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lifecycle nudges + SMS provider config — Slice E.5.
 *
 * Adds:
 *   - ospos_giftcard_nudges: dedupe table for proactive SMS reminders
 *     (expiry_30/7/1, idle_60), UNIQUE on (giftcard_id, kind).
 *   - app_config entries for the SmsSender library + nudge feature flags.
 *
 * The actual sweep logic lives in App\Commands\GiftcardsNudgeCommand
 * (spark giftcards:nudge).
 */
class AddGiftcardNudges extends Migration
{
    private const NEW_TABLES = ['giftcard_nudges'];

    private const NEW_APP_CONFIG_KEYS = [
        'giftcard_nudge_enabled',
        'giftcard_nudge_dryrun',
        'giftcard_nudge_brand',
        'giftcard_nudge_max_per_run',
        'receipt_regift_qr_enabled',
        'sms_provider',
        'sms_sender_id',
        'sms_at_username',
        'sms_at_api_key',
        'sms_twilio_account_sid',
        'sms_twilio_auth_token',
        'sms_twilio_from',
        'sms_proxy_url',
        'sms_proxy_auth_header',
    ];

    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.11_giftcard_nudges.sql');
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
