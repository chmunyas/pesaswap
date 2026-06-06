<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Webhook fan-out for ticket lifecycle events.
 *
 * Two tables — a configuration table (webhook_subscriptions, edited by
 * the merchant once) and an outbox/queue table (webhook_deliveries,
 * one row per outbound HTTP attempt).
 *
 *   webhook_subscriptions
 *     - target_url           — POST destination
 *     - secret_hash          — HMAC-SHA256 key (vault-resolvable key id)
 *     - event_mask           — comma list of subscribed events
 *     - active               — kill switch without deleting the row
 *
 *   webhook_deliveries
 *     - status               — queued | sent | failed | bounced
 *     - attempts             — retry counter (cleanup bounces past max)
 *     - last_response_code   — HTTP status from last attempt
 *     - next_attempt_at      — earliest re-try time (exponential backoff)
 *
 * Read side: webhook_deliveries serves as an audit trail too — we don't
 * delete sent rows for at least N days (retention is a separate todo).
 */
class AddWebhookSubscriptions extends Migration
{
    public function up(): void
    {
        helper('migration');
        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.11_webhooks.sql');
    }

    public function down(): void
    {
        $prefix = $this->db->getPrefix();
        $this->db->query('DROP TABLE IF EXISTS `' . $prefix . 'webhook_deliveries`');
        $this->db->query('DROP TABLE IF EXISTS `' . $prefix . 'webhook_subscriptions`');
    }
}
