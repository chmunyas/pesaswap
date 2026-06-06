<?php

namespace App\Commands;

use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Database;

/**
 * Retry worker for queued + failed email/SMS ticket deliveries.
 *
 * Pairs with `tickets:cleanup`:
 *   - retry  → flips queued/failed rows to sent (or back to failed)
 *   - cleanup → flips long-failed/over-retried rows to terminal bounced
 *
 * Cron-able alongside `tickets:cleanup`. Recommended schedule:
 *   "/5 * * * *" → docker exec ospos_dev php /app/spark tickets:retry-deliveries
 *   "0  * * * *" → docker exec ospos_dev php /app/spark tickets:cleanup
 *
 * Picks up rows where:
 *   - status IN ('queued', 'failed')
 *   - attempts < --max-retries (default 5; matches tickets:cleanup default)
 *   - last_attempt_at IS NULL OR last_attempt_at < (NOW() - INTERVAL --min-age MIN)
 *     (rate-limits retries so a transient SMTP outage doesn't get hammered)
 *
 * Uses retryRow() which increments attempts on the existing row + updates
 * status in place — no duplicate ticket_delivery_attempts rows are
 * created (the legacy retry() method was broken because dispatch()
 * inserted a fresh row instead).
 */
class TicketsRetryDeliveries extends BaseCommand
{
    protected $group       = 'Tickets';
    protected $name        = 'tickets:retry-deliveries';
    protected $description = 'Retry queued and failed email/SMS ticket delivery attempts.';
    protected $usage       = 'tickets:retry-deliveries [options]';
    protected $arguments   = [];
    protected $options     = [
        '--max-retries' => 'Skip rows with attempts >= this (default 5).',
        '--min-age'     => 'Minutes since last_attempt_at before retrying (default 5).',
        '--limit'       => 'Maximum rows to process per run (default 100, max 1000).',
        '--dry-run'     => 'Print what would be retried, do not call the transports.',
    ];

    public function run(array $params): int
    {
        $maxRetries = (int) ($params['max-retries'] ?? CLI::getOption('max-retries') ?? 5);
        $minAge     = (int) ($params['min-age']     ?? CLI::getOption('min-age')     ?? 5);
        $limit      = (int) ($params['limit']       ?? CLI::getOption('limit')       ?? 100);
        $dryRun     = isset($params['dry-run']) || CLI::getOption('dry-run');

        $maxRetries = max(1, min($maxRetries, 50));
        $minAge     = max(0, min($minAge, 1440));
        $limit      = max(1, min($limit, 1000));

        $summary = [
            'considered' => 0,
            'sent'       => 0,
            'failed'     => 0,
            'bounced'    => 0,
            'skipped'    => 0,
            'errors'     => 0,
        ];

        try {
            $db = Database::connect();
            if (! $db->tableExists('ticket_delivery_attempts')) {
                CLI::error('ticket_delivery_attempts table not present — run the Phase 3 migration first.');

                return 1;
            }

            $builder = $db->table('ticket_delivery_attempts')
                ->select('delivery_id, channel, address, attempts, last_attempt_at')
                ->whereIn('status', ['queued', 'failed'])
                ->where('attempts <', $maxRetries);
            if ($minAge > 0) {
                $builder->groupStart()
                    ->where('last_attempt_at IS NULL', null, false)
                    ->orWhere('last_attempt_at <', date('Y-m-d H:i:s', time() - $minAge * 60))
                    ->groupEnd();
            }
            $rows = $builder->orderBy('delivery_id', 'ASC')->limit($limit)->get()->getResultArray();

            $summary['considered'] = count($rows);

            if ($dryRun) {
                CLI::write('Tickets retry-deliveries (dry-run)', 'yellow');
                foreach ($rows as $row) {
                    CLI::write(sprintf(
                        '  would retry id=%d channel=%s attempts=%d',
                        $row['delivery_id'],
                        $row['channel'],
                        $row['attempts'],
                    ));
                }
                CLI::write('  Total: ' . $summary['considered']);

                return 0;
            }

            $lib = service('ticket_delivery_lib');
            foreach ($rows as $row) {
                try {
                    $result = $lib->retryRow((int) $row['delivery_id']);
                    $status = (string) ($result['status'] ?? 'unknown');
                    if ($status === 'sent') {
                        $summary['sent']++;
                    } elseif ($status === 'failed') {
                        $summary['failed']++;
                    } elseif ($status === 'bounced') {
                        $summary['bounced']++;
                    } else {
                        $summary['skipped']++;
                    }
                } catch (\Throwable $e) {
                    $summary['errors']++;
                    log_message('error', 'tickets:retry-deliveries id=' . $row['delivery_id'] . ' — ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'tickets:retry-deliveries top-level: ' . $e->getMessage());
            $summary['fatal'] = $e->getMessage();
        }

        CLI::write('Tickets retry-deliveries run', 'green');
        foreach ($summary as $key => $value) {
            CLI::write('  ' . str_pad((string) $key, 14) . ' ' . (is_scalar($value) ? (string) $value : json_encode($value)));
        }
        log_message('info', 'tickets:retry-deliveries — ' . json_encode($summary));

        return isset($summary['fatal']) ? 1 : 0;
    }
}
