<?php

namespace App\Libraries;

use Config\Database;
use Throwable;

/**
 * Webhook publisher + delivery worker.
 *
 * publish() is the API the rest of the codebase calls — it enqueues
 * one ticket_webhook_deliveries row per matching active subscription,
 * never blocks the caller on the outbound HTTP, never throws.
 *
 * dispatchPending() is the cron-callable worker that picks up queued+
 * failed rows where next_attempt_at <= NOW(), POSTs them with HMAC
 * signature, updates the row with the response, and schedules the next
 * retry on exponential backoff (1m, 5m, 15m, 1h, 6h, 24h).
 *
 * Signature contract (X-Pesaswap-Signature header):
 *   t=<unix_ts>,v1=<hex hmac_sha256(secret, "<t>.<raw_body>")>
 * Pattern modeled on Stripe webhooks — receivers must verify the t
 * is within a tolerance window (5 min) to prevent replay.
 */
class Webhook_dispatcher
{
    private const MAX_ATTEMPTS  = 8;
    private const TIMEOUT_SEC   = 10;

    // Backoff schedule in seconds; clamped to last value past index 5.
    private const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600, 86400];

    /**
     * Enqueue one delivery per active subscription whose event_mask
     * matches $event. Returns the count of rows enqueued.
     *
     * @param array<string, mixed> $payload  Will be JSON-encoded; ALWAYS
     *                                       includes 'event' and 'sent_at'.
     */
    public function publish(string $event, array $payload): int
    {
        try {
            $db = Database::connect();
            if (! $db->tableExists('webhook_subscriptions')) {
                return 0;
            }

            $subs = $db->table('webhook_subscriptions')
                ->where('active', 1)
                ->get()
                ->getResultArray();

            $matching = array_values(array_filter($subs, static function (array $s) use ($event): bool {
                $mask = trim((string) $s['event_mask']);
                if ($mask === '' || $mask === '*') {
                    return true;
                }
                foreach (explode(',', $mask) as $glob) {
                    if (self::matchesGlob(trim($glob), $event)) {
                        return true;
                    }
                }

                return false;
            }));

            if ($matching === []) {
                return 0;
            }

            $envelope = [
                'event'   => $event,
                'sent_at' => date('c'),
                'data'    => $payload,
            ];
            $payloadJson = json_encode($envelope, JSON_UNESCAPED_SLASHES);
            if ($payloadJson === false) {
                $payloadJson = '{}';
            }

            $rid = isset($GLOBALS['__ospos_rid']) && is_string($GLOBALS['__ospos_rid'])
                ? substr($GLOBALS['__ospos_rid'], 0, 64) : null;

            $now = date('Y-m-d H:i:s');
            $rows = [];
            foreach ($matching as $sub) {
                $rows[] = [
                    'subscription_id' => (int) $sub['subscription_id'],
                    'event'           => substr($event, 0, 64),
                    'payload_json'    => $payloadJson,
                    'status'          => 'queued',
                    'attempts'        => 0,
                    'next_attempt_at' => $now,
                    'request_id'      => $rid,
                ];
            }
            if ($rows !== []) {
                $db->table('webhook_deliveries')->insertBatch($rows);
            }

            return count($rows);
        } catch (Throwable $e) {
            log_message('warning', 'Webhook_dispatcher::publish failed for event=' . $event . ': ' . $e->getMessage());

            return 0;
        }
    }

    /**
     * Picks up queued+failed deliveries whose next_attempt_at <= NOW()
     * and POSTs them. Returns a counts summary suitable for spark output.
     *
     * Respects graceful shutdown — if the optional \\App\\Libraries\\Graceful_shutdown
     * helper has been installed and signals a stop mid-batch, breaks out
     * after the current row finishes so the next process can drain the
     * remainder. (Each row is its own transactional unit, so partial
     * progress is safe.)
     *
     * @return array{considered:int,sent:int,failed:int,bounced:int,errors:int}
     */
    public function dispatchPending(int $limit = 100): array
    {
        $summary = ['considered' => 0, 'sent' => 0, 'failed' => 0, 'bounced' => 0, 'errors' => 0];
        $shutdown = class_exists(\App\Libraries\Graceful_shutdown::class)
            ? \App\Libraries\Graceful_shutdown::install()
            : null;

        try {
            $db = Database::connect();
            if (! $db->tableExists('webhook_deliveries') || ! $db->tableExists('webhook_subscriptions')) {
                return $summary;
            }

            $now    = date('Y-m-d H:i:s');
            $rows   = $db->table('webhook_deliveries')
                ->whereIn('status', ['queued', 'failed'])
                ->where('next_attempt_at <=', $now)
                ->orderBy('delivery_id', 'ASC')
                ->limit(max(1, min($limit, 1000)))
                ->get()
                ->getResultArray();

            $summary['considered'] = count($rows);

            foreach ($rows as $row) {
                if ($shutdown !== null && $shutdown->isStopping()) {
                    break;
                }
                try {
                    $outcome = $this->deliverOne($db, $row);
                    $summary[$outcome]++;
                } catch (Throwable $e) {
                    $summary['errors']++;
                    log_message('error', 'Webhook_dispatcher::dispatchPending row=' . $row['delivery_id'] . ' — ' . $e->getMessage());
                }
            }
        } catch (Throwable $e) {
            log_message('error', 'Webhook_dispatcher::dispatchPending top-level: ' . $e->getMessage());
            $summary['errors']++;
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $row
     * @return 'sent'|'failed'|'bounced'
     */
    private function deliverOne($db, array $row): string
    {
        $sub = $db->table('webhook_subscriptions')
            ->where('subscription_id', (int) $row['subscription_id'])
            ->get()
            ->getRowArray();
        if ($sub === null || (int) ($sub['active'] ?? 0) === 0) {
            // Subscription was deleted or paused — bounce so we stop trying.
            $db->table('webhook_deliveries')
                ->where('delivery_id', $row['delivery_id'])
                ->update([
                    'status'             => 'bounced',
                    'last_response_body' => 'Subscription deleted or inactive',
                    'last_attempt_at'    => date('Y-m-d H:i:s'),
                ]);

            return 'bounced';
        }

        $attempts = ((int) ($row['attempts'] ?? 0)) + 1;
        $secret   = service('secrets_vault')->get((string) $sub['secret_vault_key']);
        $body     = (string) $row['payload_json'];

        $ts        = time();
        $signature = $secret !== ''
            ? sprintf('t=%d,v1=%s', $ts, hash_hmac('sha256', $ts . '.' . $body, $secret))
            : sprintf('t=%d,v1=unsigned', $ts);

        $result = $this->httpPost(
            (string) $sub['target_url'],
            $body,
            [
                'Content-Type: application/json',
                'X-Pesaswap-Event: ' . $row['event'],
                'X-Pesaswap-Signature: ' . $signature,
                'X-Pesaswap-Delivery-Id: ' . $row['delivery_id'],
                'X-Request-ID: ' . (string) ($row['request_id'] ?? ''),
                'User-Agent: Pesaswap-Webhook/1.0',
            ],
        );

        $code = (int) ($result['code'] ?? 0);
        $resp = mb_substr((string) ($result['body'] ?? ($result['error'] ?? '')), 0, 2000);

        // Anything 2xx is success. 410 Gone is a permanent signal — bounce.
        if ($code >= 200 && $code < 300) {
            $db->table('webhook_deliveries')
                ->where('delivery_id', $row['delivery_id'])
                ->update([
                    'status'             => 'sent',
                    'attempts'           => $attempts,
                    'last_response_code' => $code,
                    'last_response_body' => $resp,
                    'last_attempt_at'    => date('Y-m-d H:i:s'),
                    'sent_at'            => date('Y-m-d H:i:s'),
                ]);

            return 'sent';
        }
        if ($code === 410 || $attempts >= self::MAX_ATTEMPTS) {
            $db->table('webhook_deliveries')
                ->where('delivery_id', $row['delivery_id'])
                ->update([
                    'status'             => 'bounced',
                    'attempts'           => $attempts,
                    'last_response_code' => $code ?: null,
                    'last_response_body' => $resp,
                    'last_attempt_at'    => date('Y-m-d H:i:s'),
                ]);

            return 'bounced';
        }

        $delay   = self::BACKOFF_SECONDS[min($attempts - 1, count(self::BACKOFF_SECONDS) - 1)];
        $nextAt  = date('Y-m-d H:i:s', time() + $delay);
        $db->table('webhook_deliveries')
            ->where('delivery_id', $row['delivery_id'])
            ->update([
                'status'             => 'failed',
                'attempts'           => $attempts,
                'last_response_code' => $code ?: null,
                'last_response_body' => $resp,
                'last_attempt_at'    => date('Y-m-d H:i:s'),
                'next_attempt_at'    => $nextAt,
            ]);

        return 'failed';
    }

    /**
     * Simple cURL POST. Returns ['code' => int, 'body' => string]
     * or ['error' => string] on network failure.
     *
     * @param array<int, string> $headers
     * @return array{code?:int, body?:string, error?:string}
     */
    private function httpPost(string $url, string $body, array $headers): array
    {
        $ch = curl_init();
        if ($ch === false) {
            return ['error' => 'curl_init failed'];
        }
        try {
            curl_setopt_array($ch, [
                CURLOPT_URL            => $url,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => self::TIMEOUT_SEC,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            $body = curl_exec($ch);
            $err  = curl_error($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($body === false) {
                return ['error' => $err !== '' ? $err : 'unknown curl error'];
            }

            return ['code' => $code, 'body' => (string) $body];
        } finally {
            curl_close($ch);
        }
    }

    /**
     * Glob match for event masks: 'ticket.*' matches 'ticket.issued',
     * 'ticket.refunded', etc. '*' alone matches everything. Exact match
     * for no-wildcard masks.
     */
    private static function matchesGlob(string $glob, string $event): bool
    {
        if ($glob === '' || $glob === $event) {
            return $glob === $event;
        }
        if (! str_contains($glob, '*')) {
            return false;
        }
        $regex = '/^' . str_replace('\*', '.*', preg_quote($glob, '/')) . '$/';

        return (bool) preg_match($regex, $event);
    }
}
