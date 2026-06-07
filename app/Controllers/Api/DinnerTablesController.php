<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;

class DinnerTablesController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $tables = $this->db->table('dinner_tables')
                ->where('deleted', 0)
                ->orderBy('name', 'ASC')
                ->get()
                ->getResultArray();

            return $this->respondSuccess(array_map(fn($t) => [
                'dinner_table_id' => (int)$t['dinner_table_id'],
                'name' => $t['name'],
                'status' => (int)$t['status'],
            ], $tables));
        } catch (\Throwable $e) {
            return $this->respondError('Error fetching tables: ' . $e->getMessage(), 500);
        }
    }

    public function updateStatus(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $data = $this->getRequestData();
            $status = (int)($data['status'] ?? 0);

            $this->db->table('dinner_tables')
                ->where('dinner_table_id', $id)
                ->update(['status' => $status]);

            return $this->respondSuccess(null, 'Table status updated.');
        } catch (\Throwable $e) {
            return $this->respondError('Error updating table: ' . $e->getMessage(), 500);
        }
    }

    /**
     * POST /api/dinner-tables — create a new table.
     *   { name: "T-1" }
     */
    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        try {
            $data = $this->getRequestData();
            $name = trim((string)($data['name'] ?? ''));
            if ($name === '') {
                return $this->respondError('name is required.', 422);
            }
            $name = mb_substr($name, 0, 30);

            // Disallow duplicates (case-insensitive on the active set).
            $dup = $this->db->table('dinner_tables')
                ->where('LOWER(name)', strtolower($name))
                ->where('deleted', 0)
                ->countAllResults();
            if ($dup > 0) {
                return $this->respondError("A table named '$name' already exists.", 409);
            }

            $this->db->table('dinner_tables')->insert([
                'name'    => $name,
                'status'  => 0,
                'deleted' => 0,
            ]);
            $id = (int) $this->db->insertID();

            return $this->respondSuccess([
                'dinner_table_id' => $id,
                'name'            => $name,
                'status'          => 0,
            ], 'Table created.', 201);
        } catch (\Throwable $e) {
            return $this->respondError('Error creating table: ' . $e->getMessage(), 500);
        }
    }

    /**
     * DELETE /api/dinner-tables/:id — soft delete.
     * Refuses if the table is currently occupied (status=1).
     */
    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        try {
            $row = $this->db->table('dinner_tables')
                ->where('dinner_table_id', $id)
                ->where('deleted', 0)
                ->get()
                ->getRowArray();
            if ($row === null) {
                return $this->respondError('Table not found.', 404);
            }
            if ((int)$row['status'] === 1) {
                return $this->respondError('Cannot delete an occupied table.', 409);
            }

            $this->db->table('dinner_tables')
                ->where('dinner_table_id', $id)
                ->update(['deleted' => 1]);

            return $this->respondSuccess(['dinner_table_id' => $id], 'Table deleted.');
        } catch (\Throwable $e) {
            return $this->respondError('Error deleting table: ' . $e->getMessage(), 500);
        }
    }

    /**
     * POST /api/dinner-tables/bulk — accept either:
     *   { rows: [{ name: "T-1" }, ...] }     ← explicit names
     *   { prefix: "T-", count: 50, start: 1 } ← auto-numbered range
     *
     * Idempotency: a table with the same name (case-insensitive) that
     * isn't deleted is SKIPPED (status='skipped', reason='exists').
     */
    public function bulkImport(): \CodeIgniter\HTTP\ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) return $authResponse;
        $body = $this->request->getJSON(true) ?? [];
        $employeeId = (int)($this->employee->get_logged_in_employee_info()->person_id ?? 0);

        if (!isset($body['rows']) && isset($body['prefix']) && isset($body['count'])) {
            $prefix = mb_substr((string)$body['prefix'], 0, 16);
            $count = max(1, min(500, (int)$body['count']));
            $start = max(1, (int)($body['start'] ?? 1));
            $rows = [];
            for ($i = 0; $i < $count; $i++) {
                $rows[] = ['name' => $prefix . ($start + $i)];
            }
            $body['rows'] = $rows;
        }

        $handler = function (array $row, int $idx, $db) {
            $dryRun = !empty($row['__dry_run']);
            $name = trim((string)($row['name'] ?? ''));
            if ($name === '') {
                return ['status' => 'failed', 'key' => '', 'message' => 'name is required'];
            }
            $name = mb_substr($name, 0, 30);
            $dup = $db->table('dinner_tables')
                ->where('LOWER(name)', strtolower($name))
                ->where('deleted', 0)
                ->countAllResults();
            if ($dup > 0) {
                return ['status' => 'skipped', 'key' => $name, 'reason' => 'already exists'];
            }
            if ($dryRun) {
                return ['status' => 'imported', 'key' => $name, 'reason' => 'would insert'];
            }
            $db->table('dinner_tables')->insert([
                'name' => $name, 'status' => 0, 'deleted' => 0,
            ]);
            return ['status' => 'imported', 'key' => $name, 'reason' => 'inserted'];
        };

        $result = \App\Libraries\BulkImportLib::run(
            $this->db, 'dinner_tables', $body, $employeeId,
            (string)($this->request->getIPAddress() ?: ''),
            (string)$this->request->getUserAgent(),
            $handler,
        );
        if (isset($result['error'])) {
            return $this->respondError((string)$result['error'], (int)($result['http'] ?? 422));
        }
        return $this->respondSuccess($result, 'Bulk import complete.');
    }
}
