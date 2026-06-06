<?php

namespace App\Commands;

use App\Controllers\Api\TicketsController;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Services;

/**
 * Hourly housekeeper for ticket-related ephemera.
 *
 * Cron-able:
 *   0 * * * * docker exec ospos_dev php /app/spark tickets:cleanup
 *
 * Performs three idempotent SQL passes:
 *   - Releases seat holds past held_until that were never consumed
 *   - Marks delivery attempts that have been 'failed' too long (or exceed
 *     the max retry count) as terminal 'bounced'
 *   - Soft-cleans expired ticket transfers that were never verified
 *
 * Atomic UPDATEs only — safe to overlap with a concurrent run.
 */
class TicketsCleanup extends BaseCommand
{
    protected $group       = 'Tickets';
    protected $name        = 'tickets:cleanup';
    protected $description = 'Release expired seat holds, bounce stale delivery attempts, expire un-verified transfers.';
    protected $usage       = 'tickets:cleanup [options]';
    protected $arguments   = [];
    protected $options     = [
        '--max-retries'  => 'Delivery attempts marked bounced once attempts >= this (default 5).',
        '--failed-ttl'   => 'Delivery attempts marked bounced after this many hours in failed status (default 24).',
        '--limit'        => 'Maximum rows to touch per pass (default 500, max 5000).',
    ];

    public function run(array $params): int
    {
        $maxRetries = (int) ($params['max-retries'] ?? CLI::getOption('max-retries') ?? 5);
        $failedTtl  = (int) ($params['failed-ttl']  ?? CLI::getOption('failed-ttl')  ?? 24);
        $limit      = (int) ($params['limit']       ?? CLI::getOption('limit')       ?? 500);

        $maxRetries = max(1, min($maxRetries, 50));
        $failedTtl  = max(1, min($failedTtl, 720));
        $limit      = max(1, min($limit, 5000));

        $controller = new TicketsController();
        $request    = Services::request();
        $response   = Services::response();
        $logger     = Services::logger();
        $controller->initController($request, $response, $logger);

        $summary = $controller->cleanupExpiredArtifacts([
            'max_retries' => $maxRetries,
            'failed_ttl'  => $failedTtl,
            'limit'       => $limit,
        ]);

        CLI::write('Tickets cleanup run', 'green');
        foreach ($summary as $key => $value) {
            CLI::write('  ' . str_pad((string) $key, 24) . ' ' . (is_scalar($value) ? (string) $value : json_encode($value)));
        }
        log_message('info', 'tickets:cleanup — ' . json_encode($summary));

        return isset($summary['error']) ? 1 : 0;
    }
}
