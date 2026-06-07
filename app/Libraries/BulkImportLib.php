<?php

declare(strict_types=1);

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;
use Throwable;

/**
 * BulkImportLib — generic engine for batched JSON imports.
 *
 * Per-entity controllers call BulkImportLib::run() with a row handler
 * closure. The library handles:
 *
 *   1. Envelope validation (rows[] array, max size)
 *   2. Per-row try/catch under skip_on_error mode (or first-error
 *      rollback when skip_on_error=false)
 *   3. Transaction management — the entire batch is wrapped in a single
 *      transStart/transComplete so a hard failure rolls back cleanly.
 *   4. Dry-run mode — no DB writes, just per-row validation reports.
 *   5. Audit-row insert into ospos_bulk_imports (one per batch).
 *   6. Uniform response envelope for all entities.
 *
 * Per-row handler signature:
 *
 *     function (array $row, int $index, BaseConnection $db): array
 *
 * Returns one of:
 *   { 'status' => 'imported', 'key' => string, ... }
 *   { 'status' => 'skipped',  'key' => string, 'reason' => string }
 *   { 'status' => 'failed',   'key' => string, 'message' => string }
 *
 * Throwing from the handler is also valid — it's caught and treated as
 * 'failed' with the exception message.
 *
 * Idempotency:
 *   payload_hash = sha256(json_encode($body)) — if a caller POSTs the
 *   exact same payload twice, the audit table will show two rows with
 *   the same hash so the operator can spot accidental re-imports.
 *   Actual row-level idempotency lives in the per-entity handler via
 *   the entity's natural key.
 */
final class BulkImportLib
{
    public const DEFAULT_MAX_ROWS = 500;

    /**
     * @return array Standard response envelope ready to wrap in respondSuccess.
     */
    public static function run(
        BaseConnection $db,
        string $entity,
        array $body,
        int $operatorId,
        string $ip,
        string $userAgent,
        callable $rowHandler,
        ?int $maxRows = null
    ): array {
        $maxRows = $maxRows ?? self::DEFAULT_MAX_ROWS;
        $dryRun = (bool)($body['dry_run'] ?? false);
        $skipOnError = (bool)($body['skip_on_error'] ?? true);
        $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];

        if (count($rows) === 0) {
            return ['error' => 'rows[] is required (non-empty array).', 'http' => 422];
        }
        if (count($rows) > $maxRows) {
            return ['error' => "Batch size limit is {$maxRows} rows per request.", 'http' => 422];
        }

        $payloadHash = hash('sha256', json_encode($body) ?: '');

        $results = [];
        $errors = [];
        $importedKeys = [];
        $importedCount = 0;
        $skippedCount = 0;
        $failedCount = 0;
        $firstHardError = null;

        // Wrap the whole batch in one transaction. Dry-run also opens
        // the transaction so the handler can do lookups freely; we
        // rollback unconditionally at the end.
        $db->transStart();

        foreach ($rows as $idx => $row) {
            if (!is_array($row)) {
                $msg = 'Row is not an object/dict.';
                $results[] = ['index' => $idx, 'status' => 'failed', 'message' => $msg];
                $errors[] = ['index' => $idx, 'message' => $msg];
                $failedCount++;
                if (!$skipOnError) {
                    $firstHardError = $msg;
                    break;
                }
                continue;
            }

            try {
                if ($dryRun) {
                    $row['__dry_run'] = true;
                }
                $out = call_user_func($rowHandler, $row, $idx, $db);

                $status = (string)($out['status'] ?? 'failed');
                $key    = (string)($out['key']    ?? '');
                $entry  = ['index' => $idx, 'status' => $status, 'key' => $key];
                if (isset($out['reason'])) $entry['reason'] = $out['reason'];
                if (isset($out['message'])) $entry['message'] = $out['message'];
                $results[] = $entry;

                switch ($status) {
                    case 'imported':
                        $importedCount++;
                        if ($key !== '') $importedKeys[] = $key;
                        break;
                    case 'skipped':
                        $skippedCount++;
                        break;
                    default:
                        $failedCount++;
                        $errors[] = ['index' => $idx, 'key' => $key, 'message' => (string)($out['message'] ?? 'failed')];
                        if (!$skipOnError) {
                            $firstHardError = (string)($out['message'] ?? 'failed');
                            break 2;
                        }
                        break;
                }
            } catch (Throwable $e) {
                $msg = $e->getMessage();
                $results[] = ['index' => $idx, 'status' => 'failed', 'message' => $msg];
                $errors[] = ['index' => $idx, 'message' => $msg];
                $failedCount++;
                log_message('warning', "BulkImportLib[{$entity}] row {$idx} — {$msg}");
                if (!$skipOnError) {
                    $firstHardError = $msg;
                    break;
                }
            }
        }

        if ($dryRun || $firstHardError !== null) {
            $db->transRollback();
        } else {
            $db->transComplete();
        }

        // Audit row — always written, even for dry-run.
        $importId = 0;
        if ($db->tableExists('bulk_imports')) {
            try {
                $db->table('bulk_imports')->insert([
                    'entity'         => mb_substr($entity, 0, 64),
                    'operator_id'    => $operatorId,
                    'total_rows'     => count($rows),
                    'imported_count' => $firstHardError !== null ? 0 : $importedCount,
                    'skipped_count'  => $skippedCount,
                    'failed_count'   => $failedCount,
                    'dry_run'        => $dryRun ? 1 : 0,
                    'skip_on_error'  => $skipOnError ? 1 : 0,
                    'payload_hash'   => $payloadHash,
                    'error_summary'  => empty($errors) ? null : json_encode(array_slice($errors, 0, 100)),
                    'ip'             => mb_substr($ip, 0, 64),
                    'user_agent'     => mb_substr($userAgent, 0, 255),
                ]);
                $importId = (int)$db->insertID();
            } catch (Throwable $e) {
                log_message('warning', "BulkImportLib[{$entity}] audit insert failed — {$e->getMessage()}");
            }
        }

        return [
            'import_id'      => $importId,
            'entity'         => $entity,
            'dry_run'        => $dryRun,
            'skip_on_error'  => $skipOnError,
            'total'          => count($rows),
            'imported'       => $firstHardError !== null ? 0 : $importedCount,
            'skipped'        => $skippedCount,
            'failed'         => $failedCount,
            'rolled_back'    => $firstHardError !== null,
            'hard_error'     => $firstHardError,
            'errors'         => array_slice($errors, 0, 100),
            'results'        => $results,
            'imported_keys'  => array_slice($importedKeys, 0, 1000),
        ];
    }
}
