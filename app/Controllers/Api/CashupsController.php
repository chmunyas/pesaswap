<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class CashupsController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();

        try {
            if (!$this->db->tableExists('cash_up')) {
                return $this->respondSuccess([
                    'cashups' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0
                    ]
                ], 'Cashups table is not available.');
            }

            $cashupsTable = $this->db->prefixTable('cash_up');
            $peopleTable = $this->db->prefixTable('people');
            $select = [
                'cash_up.cashup_id',
                'cash_up.open_date',
                'cash_up.close_date',
                'cash_up.open_amount_cash',
                'cash_up.transfer_amount_cash',
                'cash_up.closed_amount_cash',
                'cash_up.closed_amount_due',
                'cash_up.closed_amount_card',
                'cash_up.closed_amount_check',
                'cash_up.closed_amount_total',
                'cash_up.description',
                'cash_up.note',
                'cash_up.open_employee_id',
                'cash_up.close_employee_id',
                'cash_up.close_employee_id AS closed_employee_id',
                'cash_up.deleted'
            ];
            $joins = '';

            if ($this->db->tableExists('people')) {
                $select[] = "TRIM(CONCAT(COALESCE(open_people.first_name, ''), ' ', COALESCE(open_people.last_name, ''))) AS open_employee_name";
                $select[] = "TRIM(CONCAT(COALESCE(close_people.first_name, ''), ' ', COALESCE(close_people.last_name, ''))) AS close_employee_name";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS open_people ON open_people.person_id = cash_up.open_employee_id";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS close_people ON close_people.person_id = cash_up.close_employee_id";
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$cashupsTable} AS cash_up{$joins}
                WHERE cash_up.deleted = 0
                ORDER BY cash_up.open_date DESC, cash_up.cashup_id DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "SELECT COUNT(*) AS total FROM {$cashupsTable} AS cash_up WHERE cash_up.deleted = 0";
            $cashups = $this->db->query($sql)->getResultArray();
            $total = (int) ($this->db->query($countSql)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'cashups' => $cashups,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load cashups.', 500);
        }
    }
}
