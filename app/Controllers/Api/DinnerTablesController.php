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
}
