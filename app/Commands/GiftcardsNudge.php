<?php

namespace App\Commands;

use App\Libraries\SmsSender;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Services;
use Throwable;

/**
 * Lifecycle nudges for bound gift cards.
 *
 * Cron-able:
 *   0 9 * * * docker exec ospos_dev php /app/spark giftcards:nudge
 *
 * Picks up four windows:
 *   expiry_30  expires_at within 30 days
 *   expiry_7   expires_at within 7 days
 *   expiry_1   expires_at within 24 hours
 *   idle_60    no spend/topup in 60 days (last giftcard_history.created_at)
 *
 * For each candidate we:
 *   1. Skip if a row in giftcard_nudges already exists for
 *      (giftcard_id, kind) — UNIQUE so the SMS only fires once per
 *      threshold per card.
 *   2. Format the message from the brand + card details.
 *   3. Send via SmsSender (provider = sms_provider config; default mock).
 *   4. Insert a giftcard_nudges row recording the result.
 *
 * Dry-run mode (giftcard_nudge_dryrun=1) skips the SMS call and the
 * insert — just logs what would have been sent. Useful for verifying a
 * new merchant's config without burning real SMS credit.
 */
class GiftcardsNudge extends BaseCommand
{
    protected $group       = 'Giftcards';
    protected $name        = 'giftcards:nudge';
    protected $description = 'Send proactive expiry + idle reminders to bound-card holders via SMS.';
    protected $usage       = 'giftcards:nudge [options]';
    protected $arguments   = [];
    protected $options     = [
        '--limit'  => 'Max nudges to send this run (default 200).',
        '--dryrun' => 'Force dry-run mode for this invocation, regardless of giftcard_nudge_dryrun.',
        '--kind'   => 'Restrict to a single nudge kind (expiry_30|expiry_7|expiry_1|idle_60).',
    ];

    public function run(array $params): int
    {
        $db = \Config\Database::connect();
        if (!$db->tableExists($db->prefixTable('giftcard_nudges'))) {
            CLI::error('giftcard_nudges table missing — run `php spark migrate` first.');
            return 1;
        }

        $enabledRow = $db->table('app_config')->where('key', 'giftcard_nudge_enabled')->get()->getRowArray();
        $enabled = $enabledRow && (string)$enabledRow['value'] === '1';
        if (!$enabled) {
            CLI::write('Nudges disabled in app_config (giftcard_nudge_enabled=0). Skipping.', 'yellow');
            return 0;
        }

        $dryRunRow = $db->table('app_config')->where('key', 'giftcard_nudge_dryrun')->get()->getRowArray();
        $dryRun = ($dryRunRow && (string)$dryRunRow['value'] === '1') || array_key_exists('dryrun', $params) || CLI::getOption('dryrun');

        $brandRow = $db->table('app_config')->where('key', 'giftcard_nudge_brand')->get()->getRowArray();
        $brand = $brandRow ? (string)$brandRow['value'] : 'PESASWAP';

        $maxRow = $db->table('app_config')->where('key', 'giftcard_nudge_max_per_run')->get()->getRowArray();
        $maxPerRun = (int)($params['limit'] ?? CLI::getOption('limit') ?? ($maxRow ? $maxRow['value'] : 200));
        $maxPerRun = max(1, min($maxPerRun, 5000));

        $kindFilter = (string)($params['kind'] ?? CLI::getOption('kind') ?? '');

        $sms = new SmsSender();

        $summary = ['considered' => 0, 'sent' => 0, 'failed' => 0, 'dryrun' => 0, 'skipped' => 0, 'by_kind' => []];

        $windows = [
            'expiry_1'  => ['days_from' => 0,  'days_to' => 1,  'condition' => 'expiry'],
            'expiry_7'  => ['days_from' => 1,  'days_to' => 7,  'condition' => 'expiry'],
            'expiry_30' => ['days_from' => 7,  'days_to' => 30, 'condition' => 'expiry'],
            'idle_60'   => ['days_from' => 60, 'days_to' => null, 'condition' => 'idle'],
        ];
        if ($kindFilter !== '' && !isset($windows[$kindFilter])) {
            CLI::error("Unknown --kind '$kindFilter'. Expected one of: " . implode(', ', array_keys($windows)));
            return 1;
        }

        foreach ($windows as $kind => $window) {
            if ($kindFilter !== '' && $kindFilter !== $kind) continue;
            if ($summary['sent'] + $summary['dryrun'] >= $maxPerRun) break;

            $rows = $this->findCandidates($db, $kind, $window, $maxPerRun - $summary['sent'] - $summary['dryrun']);
            $summary['by_kind'][$kind] = ['considered' => count($rows), 'sent' => 0, 'failed' => 0, 'dryrun' => 0];

            foreach ($rows as $row) {
                $summary['considered']++;

                $phone = (string)$row['mobile_number'];
                $message = $this->buildMessage($kind, $row, $brand);

                if ($dryRun) {
                    $summary['dryrun']++;
                    $summary['by_kind'][$kind]['dryrun']++;
                    CLI::write("DRYRUN  $kind  card={$row['giftcard_number']}  phone={$sms->maskPhone($phone)}", 'blue');
                    if (!$dryRun || (string)(($db->table('app_config')->where('key', 'giftcard_nudge_dryrun')->get()->getRowArray()['value'] ?? '0')) === '1') {
                        // Persist the dryrun marker so we don't repeatedly
                        // dryrun-log the same card on every cron tick when
                        // config is durable-dryrun.
                        $this->recordNudge($db, (int)$row['giftcard_id'], $kind, $phone, 'mock', null, 'dryrun', null, $sms);
                    }
                    continue;
                }

                $result = $sms->send($phone, $message);
                $status = $result['ok'] ? 'sent' : 'failed';
                $this->recordNudge($db, (int)$row['giftcard_id'], $kind, $phone, (string)$result['provider'], $result['message_id'] ?? null, $status, $result['error'] ?? null, $sms);

                if ($result['ok']) {
                    $summary['sent']++;
                    $summary['by_kind'][$kind]['sent']++;
                    CLI::write("OK      $kind  card={$row['giftcard_number']}  phone={$sms->maskPhone($phone)}  msg_id={$result['message_id']}", 'green');
                } else {
                    $summary['failed']++;
                    $summary['by_kind'][$kind]['failed']++;
                    CLI::write("FAIL    $kind  card={$row['giftcard_number']}  phone={$sms->maskPhone($phone)}  err={$result['error']}", 'red');
                }
            }
        }

        CLI::write("\nNudge run complete", 'green');
        CLI::write('  considered: ' . $summary['considered']);
        CLI::write('  sent:       ' . $summary['sent']);
        CLI::write('  failed:     ' . $summary['failed']);
        CLI::write('  dryrun:     ' . $summary['dryrun']);
        CLI::write('  skipped:    ' . $summary['skipped']);
        foreach ($summary['by_kind'] as $kind => $stats) {
            CLI::write('  ' . str_pad($kind, 10) . ' ' . json_encode($stats));
        }
        log_message('info', 'giftcards:nudge — ' . json_encode($summary));
        return 0;
    }

    /**
     * Find candidate cards for a given window kind. SQL is straightforward:
     *   - JOIN giftcards + giftcard_bindings on giftcard_id (active binding).
     *   - For expiry windows: filter on expires_at relative to NOW().
     *   - For idle window: filter on the max(giftcard_history.created_at).
     *   - LEFT JOIN giftcard_nudges (same kind) and exclude already-nudged.
     *   - Status = active, balance > 0, not deleted.
     */
    private function findCandidates($db, string $kind, array $window, int $limit): array
    {
        $nowSql = 'NOW()';
        $base = $db->table('giftcards AS g')
            ->select('g.giftcard_id, g.giftcard_number, g.currency, g.value, g.expires_at, g.recipient_name, b.mobile_number')
            ->join('giftcard_bindings AS b', 'b.giftcard_id = g.giftcard_id AND b.status = "active" AND b.deleted = 0', 'inner')
            ->join('giftcard_nudges AS n', "n.giftcard_id = g.giftcard_id AND n.kind = '" . $db->escapeString($kind) . "'", 'left')
            ->where('n.nudge_id IS NULL', null, false)
            ->where('g.deleted', 0)
            ->where('g.status', 'active')
            ->where('g.value >', 0);

        if ($window['condition'] === 'expiry') {
            $base->where('g.expires_at IS NOT NULL', null, false);
            if ($window['days_from'] > 0) {
                $base->where("g.expires_at > DATE_ADD($nowSql, INTERVAL " . (int)$window['days_from'] . " DAY)", null, false);
            }
            if ($window['days_to'] !== null) {
                $base->where("g.expires_at <= DATE_ADD($nowSql, INTERVAL " . (int)$window['days_to'] . " DAY)", null, false);
            }
            $base->orderBy('g.expires_at', 'ASC');
        } else {
            // idle: subquery for last history.created_at
            $base->where(
                'NOT EXISTS (SELECT 1 FROM ' . $db->prefixTable('giftcard_history') . ' h WHERE h.giftcard_id = g.giftcard_id AND h.created_at > DATE_SUB(NOW(), INTERVAL ' . (int)$window['days_from'] . ' DAY))',
                null,
                false,
            );
            $base->orderBy('g.giftcard_id', 'ASC');
        }

        return $base->limit($limit)->get()->getResultArray();
    }

    private function buildMessage(string $kind, array $row, string $brand): string
    {
        $code = (string)$row['giftcard_number'];
        $currency = (string)($row['currency'] ?? 'KES');
        $balance = (float)($row['value'] ?? 0);
        $balanceStr = $currency . ' ' . number_format($balance, 0);

        switch ($kind) {
            case 'expiry_1':
                return "{$brand} reminder: your {$balanceStr} gift card expires in 24h. Spend it today: /g/{$code}";
            case 'expiry_7':
                return "{$brand} reminder: your {$balanceStr} gift card expires in a week. /g/{$code}";
            case 'expiry_30':
                return "{$brand}: heads up — your {$balanceStr} gift card expires in 30 days. /g/{$code}";
            case 'idle_60':
                return "{$brand}: still got {$balanceStr} sitting on a gift card! /g/{$code}";
            default:
                return "{$brand} update on your gift card. /g/{$code}";
        }
    }

    private function recordNudge($db, int $giftcardId, string $kind, string $phone, string $provider, ?string $messageId, string $status, ?string $error, SmsSender $sms): void
    {
        try {
            $db->table('giftcard_nudges')->insert([
                'giftcard_id'  => $giftcardId,
                'kind'         => $kind,
                'phone_masked' => $sms->maskPhone($phone),
                'provider'     => $provider,
                'message_id'   => $messageId,
                'status'       => $status,
                'error'        => $error,
            ]);
        } catch (Throwable $e) {
            // Duplicate-key collision => another concurrent run already
            // recorded this nudge. Safe to ignore.
            log_message('warning', 'giftcards:nudge insert failed — ' . $e->getMessage());
        }
    }
}
