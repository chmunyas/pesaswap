<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * QR Ticketing — MNO refund audit table (ent-mno-refund / phase5-refund-mno).
 *
 * Closes the long-standing refund gap. Until now ticketRefund just flipped
 * status='refunded' without reversing the original tender. This migration
 * adds the audit substrate; the TicketsController::ticketRefund rewrite
 * (same commit) wires the actual reversal.
 */
class AddTicketRefundPayments extends Migration
{
    public function up(): void
    {
        helper('migration');

        execute_script(APPPATH . 'Database/Migrations/sqlscripts/3.4.9_add_ticket_refund_payments.sql');
    }

    public function down(): void
    {
        $this->db->query('DROP TABLE IF EXISTS `' . $this->db->getPrefix() . 'ticket_refund_payments`');
    }
}
