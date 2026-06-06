<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * Prometheus-compatible metrics endpoint at GET /api/metrics.
 *
 * Emits text/plain in the Prometheus exposition format (v0.0.4) so the
 * standard prometheus.io scraper can ingest it without an exporter.
 *
 * Auth model is intentionally different from the rest of /api:
 *   - Reads a static bearer token from the Secrets_vault under the
 *     logical key 'metrics_scrape_token'
 *   - If absent: refuses with 503 (deny-by-default; metrics shouldn't
 *     leak basic load characteristics to an anonymous internet)
 *   - If present: caller MUST pass Authorization: Bearer <token>
 *
 * Why a static bearer instead of session/JWT?
 *   - Prometheus's scrape_configs.basic_auth/bearer_token are config-file
 *     directives, not refreshable. A long-lived static token is the
 *     standard pattern.
 *   - Rotation = set TOKENS_METRICS_SCRAPE_TOKEN env / mount file and
 *     restart prometheus.
 *
 * Metric set (all gauges except the *_total counters):
 *   - ospos_tickets_total{status}           — count by status
 *   - ospos_tickets_issued_total            — issuance rate (counter)
 *   - ospos_tickets_redeemed_total          — successful redemptions
 *   - ospos_ticket_delivery_attempts{status,channel}
 *   - ospos_scanner_devices_active          — non-revoked count
 *   - ospos_audit_log_recent_count{minutes="60"}
 *   - ospos_seat_holds_active               — non-released, non-consumed
 *   - ospos_app_build_info{version}         — pseudo-info gauge
 */
class MetricsController extends BaseApiController
{
    public function scrape(): ResponseInterface
    {
        $token = service('secrets_vault')->get('metrics_scrape_token');
        if ($token === '') {
            return $this->response
                ->setStatusCode(503)
                ->setContentType('text/plain; charset=utf-8')
                ->setBody("# Metrics endpoint is disabled. Set TOKENS_METRICS_SCRAPE_TOKEN env or app_config['metrics_scrape_token'] to enable.\n");
        }

        $auth     = trim($this->request->getHeaderLine('Authorization'));
        $expected = 'Bearer ' . $token;
        // hash_equals is timing-safe; without it a token-guessing attacker
        // could probe via response-time side channel.
        if ($auth === '' || ! hash_equals($expected, $auth)) {
            return $this->response
                ->setStatusCode(401)
                ->setContentType('text/plain; charset=utf-8')
                ->setBody("# Unauthorized\n");
        }

        $lines = [];
        $lines[] = '# Pesaswap / OSPOS metrics — scrape ' . date('c');
        $lines[] = '';

        $this->emitTicketsByStatus($lines);
        $this->emitTicketsCounter($lines);
        $this->emitDeliveryAttempts($lines);
        $this->emitScannerDevices($lines);
        $this->emitAuditLogActivity($lines);
        $this->emitSeatHolds($lines);
        $this->emitBuildInfo($lines);

        return $this->response
            ->setStatusCode(200)
            ->setContentType('text/plain; version=0.0.4; charset=utf-8')
            ->setBody(implode("\n", $lines) . "\n");
    }

    /**
     * @param list<string> $lines
     */
    private function emitTicketsByStatus(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('tickets')) {
                return;
            }
            $lines[] = '# HELP ospos_tickets_total Count of ticket rows partitioned by status.';
            $lines[] = '# TYPE ospos_tickets_total gauge';
            $rows = $this->db->table('tickets')
                ->select('status, COUNT(*) AS n', false)
                ->where('deleted', 0)
                ->groupBy('status')
                ->get()
                ->getResultArray();
            foreach ($rows as $row) {
                $status = $this->escapeLabel((string) $row['status']);
                $lines[] = sprintf('ospos_tickets_total{status="%s"} %d', $status, (int) $row['n']);
            }
        } catch (Throwable $e) {
            $lines[] = '# ospos_tickets_total scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitTicketsCounter(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('ticket_products')) {
                return;
            }
            $issuedRow = $this->db->table('ticket_products')
                ->selectSum('quantity_issued', 'total')
                ->where('deleted', 0)
                ->get()
                ->getRowArray();
            $issuedTotal = (int) ($issuedRow['total'] ?? 0);

            $lines[] = '# HELP ospos_tickets_issued_total Sum of issued tickets across all products (Counter — monotonic).';
            $lines[] = '# TYPE ospos_tickets_issued_total counter';
            $lines[] = 'ospos_tickets_issued_total ' . $issuedTotal;

            if ($this->db->tableExists('ticket_redemptions')) {
                $redeemedRow = $this->db->table('ticket_redemptions')
                    ->where('result', 'success')
                    ->countAllResults(false);
                $lines[] = '# HELP ospos_tickets_redeemed_total Count of successful ticket redemptions (Counter).';
                $lines[] = '# TYPE ospos_tickets_redeemed_total counter';
                $lines[] = 'ospos_tickets_redeemed_total ' . (int) $redeemedRow;
            }
        } catch (Throwable $e) {
            $lines[] = '# ospos_tickets_*_total scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitDeliveryAttempts(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('ticket_delivery_attempts')) {
                return;
            }
            $lines[] = '# HELP ospos_ticket_delivery_attempts Count of delivery attempts by status+channel.';
            $lines[] = '# TYPE ospos_ticket_delivery_attempts gauge';
            $rows = $this->db->table('ticket_delivery_attempts')
                ->select('status, channel, COUNT(*) AS n', false)
                ->groupBy(['status', 'channel'])
                ->get()
                ->getResultArray();
            foreach ($rows as $row) {
                $lines[] = sprintf(
                    'ospos_ticket_delivery_attempts{status="%s",channel="%s"} %d',
                    $this->escapeLabel((string) $row['status']),
                    $this->escapeLabel((string) $row['channel']),
                    (int) $row['n'],
                );
            }
        } catch (Throwable $e) {
            $lines[] = '# ospos_ticket_delivery_attempts scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitScannerDevices(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('ticket_scanner_devices')) {
                return;
            }
            $active = $this->db->table('ticket_scanner_devices')
                ->where('revoked_at IS NULL', null, false)
                ->countAllResults(false);
            $revoked = $this->db->table('ticket_scanner_devices')
                ->where('revoked_at IS NOT NULL', null, false)
                ->countAllResults(false);
            $lines[] = '# HELP ospos_scanner_devices Count of provisioned scanner devices by revocation state.';
            $lines[] = '# TYPE ospos_scanner_devices gauge';
            $lines[] = 'ospos_scanner_devices{state="active"} ' . (int) $active;
            $lines[] = 'ospos_scanner_devices{state="revoked"} ' . (int) $revoked;
        } catch (Throwable $e) {
            $lines[] = '# ospos_scanner_devices scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitAuditLogActivity(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('admin_audit_log')) {
                return;
            }
            $cutoff = date('Y-m-d H:i:s', time() - 3600);
            $n = $this->db->table('admin_audit_log')
                ->where('created_at >=', $cutoff)
                ->countAllResults(false);
            $lines[] = '# HELP ospos_audit_log_recent_count Audit-log entries in the last N minutes.';
            $lines[] = '# TYPE ospos_audit_log_recent_count gauge';
            $lines[] = 'ospos_audit_log_recent_count{minutes="60"} ' . (int) $n;
        } catch (Throwable $e) {
            $lines[] = '# ospos_audit_log_recent_count scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitSeatHolds(array &$lines): void
    {
        try {
            if (! $this->db->tableExists('ticket_seat_holds')) {
                return;
            }
            $active = $this->db->table('ticket_seat_holds')
                ->where('released_at IS NULL', null, false)
                ->where('consumed_at IS NULL', null, false)
                ->where('held_until >=', date('Y-m-d H:i:s'))
                ->countAllResults(false);
            $lines[] = '# HELP ospos_seat_holds_active Count of seat holds currently held (not released, not consumed, not expired).';
            $lines[] = '# TYPE ospos_seat_holds_active gauge';
            $lines[] = 'ospos_seat_holds_active ' . (int) $active;
        } catch (Throwable $e) {
            $lines[] = '# ospos_seat_holds_active scrape failed: ' . $this->escapeLabel($e->getMessage());
        }
    }

    /**
     * @param list<string> $lines
     */
    private function emitBuildInfo(array &$lines): void
    {
        $version = service('secrets_vault')->get('app_build_version');
        if ($version === '') {
            $version = 'unknown';
        }
        $lines[] = '# HELP ospos_app_build_info Static build-info pseudo-gauge — value is always 1; labels carry the version.';
        $lines[] = '# TYPE ospos_app_build_info gauge';
        $lines[] = sprintf('ospos_app_build_info{version="%s"} 1', $this->escapeLabel($version));
    }

    /**
     * Escape characters reserved by the Prometheus exposition format:
     * backslash, double-quote, newline. (Label values only.)
     */
    private function escapeLabel(string $s): string
    {
        return strtr($s, ['\\' => '\\\\', '"' => '\\"', "\n" => '\\n']);
    }
}
