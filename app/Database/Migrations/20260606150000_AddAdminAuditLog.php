<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Admin audit log — generic, append-only event store for tracking every
 * privileged mutation across the application. Initial consumers: TicketsController
 * (product/session/tier/promo/bundle CRUD, ticket revoke/refund, scanner-device
 * mint+revoke). Schema kept deliberately generic so other controllers
 * (Giftcards, Employees, Config) can adopt without further migrations.
 *
 *  entity_type / entity_id  — what was touched (e.g. 'ticket_product', 42)
 *  action                   — verb (e.g. 'create', 'update', 'revoke', 'refund')
 *  actor_employee_id        — who did it; NULL for system/cron-driven mutations
 *  actor_scanner_device_id  — set when a scanner JWT authenticated the request
 *  before_json / after_json — full row snapshots for diff reconstruction
 *  ip / user_agent          — request context
 *  request_id               — correlation id stamped by CorrelationId filter
 *
 * Read-side queries are by entity (lookup the change history of a single row),
 * by actor (audit a user's activity), and by time window (compliance reports).
 * Indexes cover all three.
 */
class AddAdminAuditLog extends Migration
{
    public function up(): void
    {
        helper('migration');
        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.10_admin_audit_log.sql');
    }

    public function down(): void
    {
        $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . 'admin_audit_log`');
    }
}
