<?php

namespace App\Controllers\Api;

use App\Libraries\Graceful_shutdown;
use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * Health + readiness probe endpoint for load balancers and orchestrators.
 *
 *   GET /api/health    →  200 if process is healthy and not draining
 *                      →  503 if Graceful_shutdown lockfile is present
 *                          (set by k8s preStop / systemd ExecStop)
 *
 * The 503 response is the standard signal to a k8s readiness probe or
 * an ALB target group: "this pod is draining, stop sending traffic".
 * In-flight requests continue to be served; only NEW connections get
 * routed elsewhere. After the drain timeout the orchestrator SIGTERMs
 * the worker daemons (which use Graceful_shutdown::isStopping() to
 * exit cleanly between rows).
 *
 * Also returns a JSON body with:
 *   - app build version (from secrets_vault['app_build_version'])
 *   - DB ping (SELECT 1 → 'ok' | 'fail')
 *   - draining flag + lockfile contents if present
 *
 * No auth — readiness probes can't authenticate. Don't leak anything
 * sensitive in the body.
 */
class HealthController extends BaseApiController
{
    public function check(): ResponseInterface
    {
        $draining = file_exists(Graceful_shutdown::SHUTDOWN_LOCK);
        $drainMeta = null;
        if ($draining) {
            $raw = @file_get_contents(Graceful_shutdown::SHUTDOWN_LOCK);
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $drainMeta = $decoded;
                }
            }
        }

        $dbStatus = 'unknown';
        try {
            $row = $this->db->query('SELECT 1 AS ok')->getRow();
            $dbStatus = (isset($row->ok) && (int) $row->ok === 1) ? 'ok' : 'fail';
        } catch (Throwable $e) {
            $dbStatus = 'fail';
        }

        $version = service('secrets_vault')->get('app_build_version');
        if ($version === '') {
            $version = 'unknown';
        }

        $body = [
            'status'   => $draining ? 'draining' : ($dbStatus === 'ok' ? 'ok' : 'degraded'),
            'version'  => $version,
            'db'       => $dbStatus,
            'draining' => $draining,
            'time'     => date('c'),
        ];
        if ($drainMeta !== null) {
            $body['drain_info'] = $drainMeta;
        }

        // 503 for draining (LB drain signal) OR if DB is unreachable
        // (the API can't actually serve requests without the DB).
        $statusCode = ($draining || $dbStatus !== 'ok') ? 503 : 200;

        return $this->response
            ->setStatusCode($statusCode)
            ->setJSON($body);
    }
}
