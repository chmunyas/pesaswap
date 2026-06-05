<?php

namespace App\Commands;

use App\Controllers\Api\GiftcardsController;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Services;

/**
 * Dispatcher for scheduled gift-card deliveries (`deliver_at`).
 *
 * Designed to be cron-able:
 *   * * * * * docker exec ospos_dev php /app/spark giftcards:dispatch
 *
 * The underlying GiftcardsController::dispatchScheduled() uses an atomic
 * claim (UPDATE ... SET delivery_status='sending' WHERE delivery_status
 * ='pending' ... LIMIT N) so overlapping cron runs cannot double-send.
 */
class DispatchScheduledGiftcards extends BaseCommand
{
    protected $group       = 'Giftcards';
    protected $name        = 'giftcards:dispatch';
    protected $description = 'Send scheduled gift-card deliveries whose deliver_at has fallen due.';
    protected $usage       = 'giftcards:dispatch [options]';
    protected $arguments   = [];
    protected $options     = [
        '--limit' => 'Maximum number of cards to process this run (default 100, max 1000).',
    ];

    public function run(array $params): int
    {
        $limit = (int) ($params['limit'] ?? CLI::getOption('limit') ?? 100);
        $limit = max(1, min($limit, 1000));

        $controller = new GiftcardsController();
        // Minimal init so the controller can read the DB; no HTTP req/resp
        // is required for the dispatcher.
        $request  = Services::request();
        $response = Services::response();
        $logger   = Services::logger();
        $controller->initController($request, $response, $logger);

        $summary = $controller->dispatchScheduled($limit);

        CLI::write('Giftcards dispatch run', 'green');
        foreach ($summary as $key => $value) {
            CLI::write('  ' . str_pad((string) $key, 10) . ' ' . (is_scalar($value) ? (string) $value : json_encode($value)));
        }
        log_message('info', 'giftcards:dispatch — ' . json_encode($summary));

        return isset($summary['error']) ? 1 : 0;
    }
}
