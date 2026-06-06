<?php

namespace App\Libraries;

/**
 * Graceful-shutdown helper for long-running CLI loops (spark commands,
 * worker daemons, batch operations).
 *
 * Usage in a spark command body:
 *
 *   $shutdown = Graceful_shutdown::install();
 *   foreach ($rows as $row) {
 *       if ($shutdown->isStopping()) { break; }
 *       $this->processRow($row);
 *   }
 *
 * isStopping() returns true once any of SIGTERM / SIGINT / SIGHUP has
 * been seen. The signal handler is installed via pcntl_signal() (if
 * pcntl is loaded — which it usually is in CLI mode but not always in
 * fpm). When pcntl is missing the helper degrades gracefully: every
 * call to isStopping() returns false (the loop runs to completion as
 * it did before).
 *
 * Also exposes a process-wide health flag readable by the HTTP-side
 * /api/health endpoint via the file at writable/runtime/shutdown.lock.
 * When a deployment is about to terminate the container, an
 * orchestrator (k8s preStop hook, systemd ExecStop) can:
 *   1. `touch writable/runtime/shutdown.lock` so /api/health returns 503
 *   2. wait for the load balancer to drain (5-10 seconds)
 *   3. SIGTERM the workers
 *
 * Static singleton so the same handler isn't installed twice in a
 * single process.
 */
class Graceful_shutdown
{
    private static ?self $instance = null;

    private bool $stopping = false;
    private bool $pcntlAvailable;

    /**
     * Path to the lockfile that /api/health checks. Touched by an
     * orchestrator preStop hook to drain traffic.
     */
    public const SHUTDOWN_LOCK = WRITEPATH . 'runtime' . DIRECTORY_SEPARATOR . 'shutdown.lock';

    private function __construct()
    {
        $this->pcntlAvailable = extension_loaded('pcntl') && function_exists('pcntl_signal');

        if ($this->pcntlAvailable) {
            // Defer signals between pcntl_signal_dispatch() calls so we
            // don't get interrupted mid-syscall — async signals (PHP 7.1+)
            // do this correctly but we re-enable explicitly for clarity.
            pcntl_async_signals(true);

            $handler = function (int $signo): void {
                $this->stopping = true;
                // Write a marker so the next health check returns 503 even
                // before the worker loop has had a chance to notice.
                $this->writeMarker((string) $signo);
            };
            pcntl_signal(SIGTERM, $handler);
            pcntl_signal(SIGINT, $handler);
            pcntl_signal(SIGHUP, $handler);
        }
    }

    /**
     * Install (or return the existing) singleton. Idempotent.
     */
    public static function install(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * True once a shutdown signal has been received OR an external
     * touch of the lockfile has happened. The file check is cached
     * per-call only — cheap (single stat()), so even tight loops can
     * call this every iteration without measurable overhead.
     */
    public function isStopping(): bool
    {
        if ($this->stopping) {
            return true;
        }
        if (@file_exists(self::SHUTDOWN_LOCK)) {
            $this->stopping = true;

            return true;
        }

        return false;
    }

    /**
     * For tests: forget the singleton + clear the lockfile.
     */
    public static function resetForTest(): void
    {
        @unlink(self::SHUTDOWN_LOCK);
        self::$instance = null;
    }

    private function writeMarker(string $reason): void
    {
        $dir = dirname(self::SHUTDOWN_LOCK);
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        @file_put_contents(self::SHUTDOWN_LOCK, json_encode([
            'shut_down_at' => date('c'),
            'reason'       => $reason,
            'pid'          => getmypid(),
        ]) . "\n");
    }
}
