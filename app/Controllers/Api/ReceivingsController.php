<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class ReceivingsController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();

        try {
            if (!$this->db->tableExists('receivings')) {
                return $this->respondSuccess([
                    'receivings' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0
                    ]
                ], 'Receivings table is not available.');
            }

            $receivingsTable = $this->db->prefixTable('receivings');
            $peopleTable = $this->db->prefixTable('people');
            $suppliersTable = $this->db->prefixTable('suppliers');
            $select = [
                'receivings.receiving_id',
                'receivings.receiving_time',
                'receivings.supplier_id',
                'receivings.employee_id',
                'receivings.comment',
                'receivings.payment_type',
                'receivings.reference'
            ];
            $joins = '';

            if ($this->db->tableExists('suppliers') && $this->db->tableExists('people')) {
                $select[] = 'suppliers.company_name AS supplier_company_name';
                $select[] = "TRIM(CONCAT(COALESCE(supplier_people.first_name, ''), ' ', COALESCE(supplier_people.last_name, ''))) AS supplier_name";
                $joins .= "\n                    LEFT JOIN {$suppliersTable} AS suppliers ON suppliers.person_id = receivings.supplier_id";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS supplier_people ON supplier_people.person_id = suppliers.person_id";
            }

            if ($this->db->tableExists('people')) {
                $select[] = "TRIM(CONCAT(COALESCE(employee_people.first_name, ''), ' ', COALESCE(employee_people.last_name, ''))) AS employee_name";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS employee_people ON employee_people.person_id = receivings.employee_id";
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$receivingsTable} AS receivings{$joins}
                ORDER BY receivings.receiving_time DESC, receivings.receiving_id DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "SELECT COUNT(*) AS total FROM {$receivingsTable}";
            $receivings = $this->db->query($sql)->getResultArray();
            $total = (int) ($this->db->query($countSql)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'receivings' => $receivings,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load receivings.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->db->tableExists('receivings')) {
                return $this->respondError('Receivings table is not available.', 503);
            }

            $receivingsTable = $this->db->prefixTable('receivings');
            $peopleTable = $this->db->prefixTable('people');
            $suppliersTable = $this->db->prefixTable('suppliers');
            $select = [
                'receivings.receiving_id',
                'receivings.receiving_time',
                'receivings.supplier_id',
                'receivings.employee_id',
                'receivings.comment',
                'receivings.payment_type',
                'receivings.reference'
            ];
            $joins = '';

            if ($this->db->tableExists('suppliers') && $this->db->tableExists('people')) {
                $select[] = 'suppliers.company_name AS supplier_company_name';
                $select[] = "TRIM(CONCAT(COALESCE(supplier_people.first_name, ''), ' ', COALESCE(supplier_people.last_name, ''))) AS supplier_name";
                $select[] = 'supplier_people.email AS supplier_email';
                $select[] = 'supplier_people.phone_number AS supplier_phone_number';
                $joins .= "\n                    LEFT JOIN {$suppliersTable} AS suppliers ON suppliers.person_id = receivings.supplier_id";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS supplier_people ON supplier_people.person_id = suppliers.person_id";
            }

            if ($this->db->tableExists('people')) {
                $select[] = "TRIM(CONCAT(COALESCE(employee_people.first_name, ''), ' ', COALESCE(employee_people.last_name, ''))) AS employee_name";
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS employee_people ON employee_people.person_id = receivings.employee_id";
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$receivingsTable} AS receivings{$joins}
                WHERE receivings.receiving_id = ?
                LIMIT 1
            ";

            $receiving = $this->db->query($sql, [$id])->getRowArray();
            if ($receiving === null) {
                return $this->respondError('Receiving not found.', 404);
            }

            $items = [];
            if ($this->db->tableExists('receivings_items')) {
                $receivingsItemsTable = $this->db->prefixTable('receivings_items');
                $itemsTable = $this->db->prefixTable('items');
                $itemSelect = [
                    'receivings_items.receiving_id',
                    'receivings_items.item_id',
                    'receivings_items.line',
                    'receivings_items.description',
                    'receivings_items.serialnumber',
                    'receivings_items.quantity_purchased',
                    'receivings_items.item_cost_price',
                    'receivings_items.item_unit_price',
                    'receivings_items.discount',
                    'receivings_items.discount_type',
                    'receivings_items.item_location',
                    'receivings_items.receiving_quantity'
                ];
                $itemJoin = '';

                if ($this->db->tableExists('items')) {
                    $itemSelect[] = 'items.name AS item_name';
                    $itemSelect[] = 'items.item_number';
                    $itemJoin = "\n                        LEFT JOIN {$itemsTable} AS items ON items.item_id = receivings_items.item_id";
                }

                $itemSql = "
                    SELECT
                        " . implode(",\n                        ", $itemSelect) . "
                    FROM {$receivingsItemsTable} AS receivings_items{$itemJoin}
                    WHERE receivings_items.receiving_id = ?
                    ORDER BY receivings_items.line ASC, receivings_items.item_id ASC
                ";

                $items = $this->db->query($itemSql, [$id])->getResultArray();
            }

            return $this->respondSuccess([
                'receiving' => $receiving,
                'items' => $items
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load receiving.', 500);
        }
    }
}
