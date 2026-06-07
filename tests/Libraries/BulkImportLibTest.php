<?php

declare(strict_types=1);

namespace Tests\Libraries;

use App\Libraries\BulkImportLib;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use RuntimeException;

/**
 * Tests for the BulkImportLib engine. Focuses on the invariants every
 * per-entity handler depends on:
 *
 *   1. Empty / over-limit batches reject before the handler is called.
 *   2. dry_run=true never persists any row, even on success.
 *   3. skip_on_error=true continues past per-row failures and reports
 *      all errors at the end.
 *   4. skip_on_error=false rolls back on first failure.
 *   5. A row handler that throws is caught + reported, not bubbled.
 *   6. Audit row is written for every run (including dry-run + rollback).
 */
final class BulkImportLibTest extends CIUnitTestCase
{
    use DatabaseTestTrait;

    protected $migrate         = true;
    protected $migrateOnce     = true;
    protected $refresh         = false;
    protected $namespace;
    protected $useTransactions = false;

    public function testRejectsEmptyRows(): void
    {
        $r = BulkImportLib::run($this->db, 'test', ['rows' => []], 1, '127.0.0.1', 'phpunit', fn() => []);
        $this->assertSame(422, $r['http']);
        $this->assertStringContainsString('non-empty', $r['error']);
    }

    public function testRejectsTooManyRows(): void
    {
        $rows = array_fill(0, 501, ['x' => 1]);
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows], 1, '127.0.0.1', 'phpunit', fn() => [], 500);
        $this->assertSame(422, $r['http']);
        $this->assertStringContainsString('Batch size limit', $r['error']);
    }

    public function testSuccessfulImportReportsImported(): void
    {
        $rows = [['n' => 1], ['n' => 2], ['n' => 3]];
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows], 1, '127.0.0.1', 'phpunit',
            fn($row) => ['status' => 'imported', 'key' => 'k' . $row['n']],
        );
        $this->assertSame(3, $r['total']);
        $this->assertSame(3, $r['imported']);
        $this->assertSame(0, $r['failed']);
        $this->assertSame(['k1', 'k2', 'k3'], $r['imported_keys']);
    }

    public function testSkipOnErrorContinuesPastFailures(): void
    {
        $rows = [['ok' => true], ['ok' => false], ['ok' => true]];
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows, 'skip_on_error' => true], 1, '127.0.0.1', 'phpunit',
            function ($row, $i) {
                if (!$row['ok']) return ['status' => 'failed', 'key' => 'bad', 'message' => 'bad row'];
                return ['status' => 'imported', 'key' => "ok-{$i}"];
            },
        );
        $this->assertSame(3, $r['total']);
        $this->assertSame(2, $r['imported']);
        $this->assertSame(1, $r['failed']);
        $this->assertFalse($r['rolled_back']);
        $this->assertCount(1, $r['errors']);
    }

    public function testNoSkipOnErrorRollsBackOnFirstFailure(): void
    {
        $rows = [['ok' => true], ['ok' => false], ['ok' => true]];
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows, 'skip_on_error' => false], 1, '127.0.0.1', 'phpunit',
            function ($row) {
                if (!$row['ok']) return ['status' => 'failed', 'key' => 'bad', 'message' => 'bad row'];
                return ['status' => 'imported', 'key' => 'ok'];
            },
        );
        $this->assertTrue($r['rolled_back']);
        $this->assertSame(0, $r['imported']);
        $this->assertSame('bad row', $r['hard_error']);
    }

    public function testHandlerThrowsAreCaughtAsFailures(): void
    {
        $rows = [['x' => 1], ['x' => 2]];
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows, 'skip_on_error' => true], 1, '127.0.0.1', 'phpunit',
            function ($row, $i) {
                if ($i === 1) throw new RuntimeException('boom');
                return ['status' => 'imported', 'key' => 'ok'];
            },
        );
        $this->assertSame(1, $r['imported']);
        $this->assertSame(1, $r['failed']);
        $this->assertStringContainsString('boom', $r['errors'][0]['message']);
    }

    public function testDryRunReportsButDoesNotPersist(): void
    {
        // Use a temporary scratch table to verify nothing was written.
        $this->db->query('CREATE TEMPORARY TABLE IF NOT EXISTS bulk_test_scratch (n INT)');
        $this->db->query('DELETE FROM bulk_test_scratch');
        $rows = [['n' => 1], ['n' => 2]];
        $r = BulkImportLib::run($this->db, 'test', ['rows' => $rows, 'dry_run' => true], 1, '127.0.0.1', 'phpunit',
            function ($row, $i, $db) {
                // Handler attempts a write but library should rollback.
                $db->query('INSERT INTO bulk_test_scratch (n) VALUES (?)', [(int)$row['n']]);
                return ['status' => 'imported', 'key' => 'r' . $i];
            },
        );
        $this->assertTrue($r['dry_run']);
        $count = (int)($this->db->query('SELECT COUNT(*) AS c FROM bulk_test_scratch')->getRowArray()['c'] ?? 0);
        $this->assertSame(0, $count, 'dry-run must roll back any inserts performed in the handler');
    }

    public function testAuditRowIsWritten(): void
    {
        if (! $this->db->tableExists('bulk_imports')) {
            $this->markTestSkipped('bulk_imports table not migrated in this test DB');
        }
        $beforeCount = (int)($this->db->query('SELECT COUNT(*) AS c FROM ' . $this->db->prefixTable('bulk_imports'))->getRowArray()['c'] ?? 0);
        BulkImportLib::run($this->db, 'audit_smoke', ['rows' => [['x' => 1]]], 99, '10.0.0.1', 'phpunit',
            fn() => ['status' => 'imported', 'key' => 'k']);
        $afterCount = (int)($this->db->query('SELECT COUNT(*) AS c FROM ' . $this->db->prefixTable('bulk_imports'))->getRowArray()['c'] ?? 0);
        $this->assertSame($beforeCount + 1, $afterCount);
        $row = $this->db->query('SELECT * FROM ' . $this->db->prefixTable('bulk_imports') . " WHERE entity = 'audit_smoke' ORDER BY import_id DESC LIMIT 1")->getRowArray();
        $this->assertNotNull($row);
        $this->assertSame(99, (int)$row['operator_id']);
        $this->assertSame('10.0.0.1', (string)$row['ip']);
    }
}
