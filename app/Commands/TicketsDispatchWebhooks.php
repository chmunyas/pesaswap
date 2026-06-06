<?php

namespace App\Commands;

use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Webhook delivery worker. Counterpart to Webhook_dispatcher::publish()
 * which only enqueues — this command does the actual HTTP POST with
 * HMAC signing, response capture, and exponential-backoff retry.
 *
 * Cron schedule (recommend every 1-5 minutes):
 *   "/1 * * * *" → docker exec ospos_dev php /app/spark tickets:dispatch-webhooks
 *
 * Picks up webhook_deliveries where status IN ('queued','failed') AND
 * next_attempt_at <= NOW(). Backoff schedule: 1m, 5m, 15m, 1h, 6h, 24h.
 * Bounces after 8 attempts OR on HTTP 410 Gone (receiver signal that
 * the resource is permanently gone).
 */
class TicketsDispatchWebhooks extends BaseCommand
{
    protected $group       = 'Tickets';
    protected $name        = 'tickets:dispatch-webhooks';
    protected $description = 'Deliver queued + failed webhook events with HMAC signing and exponential backoff.';
    protected $usage       = 'tickets:dispatch-webhooks [options]';
    protected $arguments   = [];
    protected $options     = [
        '--limit' => 'Maximum rows per run (default 100, max 1000).',
    ];

    public function run(array $params): int
    {
        $limit = (int) ($params['limit'] ?? CLI::getOption('limit') ?? 100);
        $limit = max(1, min($limit, 1000));

        $summary = service('webhook_dispatcher')->dispatchPending($limit);

        CLI::write('Tickets webhook dispatch run', 'green');
        foreach ($summary as $key => $value) {
            CLI::write('  ' . str_pad((string) $key, 12) . ' ' . (is_scalar($value) ? (string) $value : json_encode($value)));
        }
        log_message('info', 'tickets:dispatch-webhooks — ' . json_encode($summary));

        return ($summary['errors'] ?? 0) > 0 ? 1 : 0;
    }
}
