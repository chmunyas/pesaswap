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

    /**
     * Create a goods-received entry plus its line items in one atomic
     * transaction. Updates each item's `quantity` in `ospos_items` so
     * stock-on-hand stays in sync (the legacy OSPOS receivings flow
     * does the same).
     *
     * POST /api/receivings
     *   {
     *     supplier_id?: int,           # optional walk-in supplier
     *     payment_type?: string,
     *     reference?: string,
     *     comment?: string,
     *     items: [
     *       { item_id, quantity, cost_price, unit_price?, description?, serialnumber?, discount?, discount_type? }
     *     ]
     *   }
     *
     * Returns { receiving_id, line_count, total_cost }.
     */
    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->db->tableExists('receivings') || !$this->db->tableExists('receivings_items')) {
            return $this->respondError('Receivings tables are not available.', 503);
        }

        $body = $this->request->getJSON(true) ?? [];
        $items = is_array($body['items'] ?? null) ? $body['items'] : [];
        if (count($items) === 0) {
            return $this->respondError('At least one line item is required.', 422);
        }

        // Pre-validate each line so we never get a half-written receipt.
        foreach ($items as $i => $line) {
            if (!isset($line['item_id']) || (int) $line['item_id'] <= 0) {
                return $this->respondError("items[$i].item_id is required (positive int).", 422);
            }
            if (!isset($line['quantity']) || (float) $line['quantity'] <= 0) {
                return $this->respondError("items[$i].quantity must be > 0.", 422);
            }
            if (!isset($line['cost_price']) || (float) $line['cost_price'] < 0) {
                return $this->respondError("items[$i].cost_price must be >= 0.", 422);
            }
        }

        try {
            $this->db->transStart();

            $employeeId = (int) ($this->employee->get_logged_in_employee_info()->person_id ?? 0);
            $totalCost = 0.0;
            $supplierId = isset($body['supplier_id']) ? (int) $body['supplier_id'] : null;

            $this->db->table('receivings')->insert([
                'receiving_time' => date('Y-m-d H:i:s'),
                'supplier_id'    => $supplierId,
                'employee_id'    => $employeeId,
                'comment'        => mb_substr((string) ($body['comment'] ?? ''), 0, 8192),
                'payment_type'   => mb_substr((string) ($body['payment_type'] ?? ''), 0, 20),
                'reference'      => mb_substr((string) ($body['reference'] ?? ''), 0, 32),
            ]);
            $receivingId = (int) $this->db->insertID();

            $line = 1;
            foreach ($items as $row) {
                $itemId = (int) $row['item_id'];
                $qty = (float) $row['quantity'];
                $cost = (float) $row['cost_price'];
                $unit = isset($row['unit_price']) ? (float) $row['unit_price'] : $cost;
                $totalCost += $qty * $cost;

                $this->db->table('receivings_items')->insert([
                    'receiving_id'        => $receivingId,
                    'item_id'             => $itemId,
                    'line'                => $line++,
                    'description'         => mb_substr((string) ($row['description'] ?? ''), 0, 30),
                    'serialnumber'        => mb_substr((string) ($row['serialnumber'] ?? ''), 0, 30),
                    'quantity_purchased'  => number_format($qty, 3, '.', ''),
                    'item_cost_price'     => number_format($cost, 2, '.', ''),
                    'item_unit_price'     => number_format($unit, 2, '.', ''),
                    'discount'            => number_format((float) ($row['discount'] ?? 0), 2, '.', ''),
                    'discount_type'       => (int) ($row['discount_type'] ?? 0),
                    'item_location'       => (int) ($row['item_location'] ?? 0),
                    'receiving_quantity'  => number_format($qty, 3, '.', ''),
                ]);

                // Adjust on-hand stock (matches legacy receivings behaviour).
                if ($this->db->tableExists('item_quantities')) {
                    $loc = (int) ($row['item_location'] ?? 0);
                    $existing = $this->db->table('item_quantities')
                        ->where('item_id', $itemId)
                        ->where('location_id', $loc ?: 1)
                        ->get()
                        ->getRowArray();
                    if ($existing !== null) {
                        $this->db->table('item_quantities')
                            ->where('item_id', $itemId)
                            ->where('location_id', $loc ?: 1)
                            ->update(['quantity' => (float) $existing['quantity'] + $qty]);
                    } else {
                        $this->db->table('item_quantities')->insert([
                            'item_id'     => $itemId,
                            'location_id' => $loc ?: 1,
                            'quantity'    => number_format($qty, 3, '.', ''),
                        ]);
                    }
                }
            }

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to record receipt.', 500);
            }

            return $this->respondSuccess([
                'receiving_id' => $receivingId,
                'line_count'   => count($items),
                'total_cost'   => $totalCost,
            ], 'Receiving recorded.', 201);
        } catch (Throwable $e) {
            log_message('error', 'ReceivingsController::create — ' . $e->getMessage());
            return $this->respondError('Failed to record receipt.', 500);
        }
    }
}
