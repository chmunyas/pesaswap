<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Correlation-ID + structured access-log filter.
 *
 * before():
 *   - Honors an inbound X-Request-ID header (validated as 8-64 chars,
 *     alphanumeric + dash/underscore), else mints a fresh UUID v4
 *   - Stashes the id on the shared Services request so downstream code
 *     can include it in log_message() calls
 *   - Records request start time for duration calculation
 *
 * after():
 *   - Sets X-Request-ID on the response so callers can correlate
 *   - Emits a single JSON-formatted access-log line containing
 *     method, path, status, duration_ms, request_id, user_id, ip,
 *     user_agent — appended to writable/logs/access-YYYY-MM-DD.log
 *
 * Registered globally so EVERY request gets a correlation id, even the
 * 404 responses. To read the id from controller code:
 *   $rid = \Config\Services::request()->getHeaderLine('X-Request-ID');
 */
class CorrelationId implements FilterInterface
{
    /**
     * @param list<string>|null $arguments
     */
    public function before(RequestInterface $request, $arguments = null)
    {
        $inbound  = trim($request->getHeaderLine('X-Request-ID'));
        $valid    = $inbound !== '' && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $inbound) === 1;
        $rid      = $valid ? $inbound : $this->generateUuidV4();
        $startSec = microtime(true);

        // Stash on the request itself so the after() filter (different
        // instance) and any controller can read it back from one place.
        $request->setHeader('X-Request-ID', $rid);

        // Globals are the only practical channel for filter→filter state
        // in CI4 4.x without registering a new service.
        $GLOBALS['__ospos_rid']   = $rid;
        $GLOBALS['__ospos_start'] = $startSec;

        return null;
    }

    /**
     * @param list<string>|null $arguments
     */
    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        $rid      = $GLOBALS['__ospos_rid']   ?? $this->generateUuidV4();
        $startSec = $GLOBALS['__ospos_start'] ?? microtime(true);
        $duration = (int) round((microtime(true) - $startSec) * 1000);

        $response->setHeader('X-Request-ID', $rid);

        // Emit a single structured access log entry. Failures are swallowed
        // (logging must NEVER break the response).
        try {
            $entry = [
                'timestamp'   => date('c'),
                'request_id'  => $rid,
                'method'      => $request->getMethod(),
                'path'        => (string) $request->getUri()->getPath(),
                'status'      => $response->getStatusCode(),
                'duration_ms' => $duration,
                'ip'          => $request->getIPAddress(),
                'user_id'     => (int) (session()->get('person_id') ?? 0) ?: null,
                'user_agent'  => substr((string) $request->getUserAgent(), 0, 256),
            ];
            $path = rtrim(WRITEPATH, '/') . '/logs/access-' . date('Y-m-d') . '.log';
            @file_put_contents($path, json_encode($entry, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        } catch (\Throwable $e) {
            // suppress
        }

        return $response;
    }

    /**
     * RFC 4122 v4 UUID — 122 bits of entropy from random_bytes, formatted
     * as 8-4-4-4-12. Falls back to a non-RFC random hex if random_bytes
     * throws (which only happens on broken /dev/urandom).
     */
    private function generateUuidV4(): string
    {
        try {
            $b = random_bytes(16);
        } catch (\Throwable $e) {
            return bin2hex(openssl_random_pseudo_bytes(16) ?: str_pad('', 16, chr(0)));
        }
        // RFC 4122 §4.4: set version (top 4 bits of byte 6) to 0100,
        // set variant (top 2 bits of byte 8) to 10.
        $b[6] = chr((ord($b[6]) & 0x0F) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3F) | 0x80);
        $h = bin2hex($b);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20, 12));
    }
}
