<?php

namespace App\Commands;

use App\Controllers\Api\GiftcardsController;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Services;

/**
 * Sweeper for stale gift-card payment intents + pending bindings.
 *
 * Cron-able alongside DispatchScheduledGiftcards:
 *   * * * * * docker exec ospos_dev php /app/spark giftcards:sweep-intents
 *
 * Flips any awaiting_pin intent past its expires_at to 'expired' (with
 * failure_code=TIMEOUT) and any pending binding past its expires_at to
 * 'disabled'. Atomic UPDATE — safe to overlap.
 */
class SweepStaleGiftcardIntents extends BaseCommand
{
    protected $group       = 'Giftcards';
    protected $name        = 'giftcards:sweep-intents';
    protected $description = 'Expire awaiting_pin payment intents + pending bindings past their TTL.';
    protected $usage       = 'giftcards:sweep-intents [options]';
    protected $arguments   = [];
    protected $options     = [
        '--limit' => 'Maximum number of intents to expire per run (default 100, max 1000).',
    ];

    public function run(array $params): int
    {
        $limit = (int) ($params['limit'] ?? CLI::getOption('limit') ?? 100);
        $limit = max(1, min($limit, 1000));

        $controller = new GiftcardsController();
        $request  = Services::request();
        $response = Services::response();
        $logger   = Services::logger();
        $controller->initController($request, $response, $logger);

        $summary = $controller->sweepStaleIntents($limit);

        CLI::write('Giftcards intent-sweep run', 'green');
        foreach ($summary as $key => $value) {
            CLI::write('  ' . str_pad((string) $key, 18) . ' ' . (is_scalar($value) ? (string) $value : json_encode($value)));
        }
        log_message('info', 'giftcards:sweep-intents — ' . json_encode($summary));

        return isset($summary['error']) ? 1 : 0;
    }
}
