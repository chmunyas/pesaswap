<?php

namespace App\Controllers\Api;

use App\Libraries\BulkImportLib;
use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class ExpensesController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string) ($this->request->getGet('search') ?? ''));

        try {
            if (!$this->db->tableExists('expenses')) {
                return $this->respondSuccess([
                    'expenses' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0,
                        'search' => $search
                    ]
                ], 'Expenses table is not available.');
            }

            $expensesTable = $this->db->prefixTable('expenses');
            $categoriesTable = $this->db->prefixTable('expense_categories');
            $peopleTable = $this->db->prefixTable('people');
            $select = [
                'expenses.expense_id',
                'expenses.date',
                'expenses.amount',
                'expenses.payment_type',
                'expenses.description',
                'expenses.employee_id',
                'expenses.deleted',
                'expenses.expense_category_id'
            ];
            $joins = '';
            $searchParts = [
                "expenses.description LIKE ? ESCAPE '!'",
                "expenses.payment_type LIKE ? ESCAPE '!'",
                "CAST(expenses.amount AS CHAR) LIKE ? ESCAPE '!'"
            ];

            if ($this->db->tableExists('expense_categories')) {
                $select[] = 'expense_categories.category_name';
                $select[] = 'expense_categories.category_description';
                $joins .= "\n                    LEFT JOIN {$categoriesTable} AS expense_categories ON expense_categories.expense_category_id = expenses.expense_category_id";
                $searchParts[] = "expense_categories.category_name LIKE ? ESCAPE '!'";
            } else {
                $select[] = 'NULL AS category_name';
                $select[] = 'NULL AS category_description';
            }

            if ($this->db->tableExists('people')) {
                $select[] = 'employee_people.first_name AS employee_first_name';
                $select[] = 'employee_people.last_name AS employee_last_name';
                $joins .= "\n                    LEFT JOIN {$peopleTable} AS employee_people ON employee_people.person_id = expenses.employee_id";
                $searchParts[] = "employee_people.first_name LIKE ? ESCAPE '!'";
                $searchParts[] = "employee_people.last_name LIKE ? ESCAPE '!'";
            } else {
                $select[] = 'NULL AS employee_first_name';
                $select[] = 'NULL AS employee_last_name';
            }

            $params = [];
            $searchSql = '';
            if ($search !== '') {
                $like = $this->likeValue($search);
                $params = array_fill(0, count($searchParts), $like);
                $searchSql = "\n                    AND (" . implode(' OR ', $searchParts) . ')';
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$expensesTable} AS expenses{$joins}
                WHERE expenses.deleted = 0{$searchSql}
                ORDER BY expenses.date DESC, expenses.expense_id DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "
                SELECT COUNT(*) AS total
                FROM {$expensesTable} AS expenses{$joins}
                WHERE expenses.deleted = 0{$searchSql}
            ";

            $expenses = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'expenses' => $expenses,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                    'search' => $search
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load expenses.', 500);
        }
    }

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->db->tableExists('expenses')) {
                return $this->respondError('Expenses table is not available.', 503);
            }

            $input = $this->getRequestData();
            $amount = isset($input['amount']) ? (float) $input['amount'] : null;
            $paymentType = trim((string) ($input['payment_type'] ?? ''));
            $description = trim((string) ($input['description'] ?? ''));
            $expenseCategoryId = isset($input['expense_category_id']) ? (int) $input['expense_category_id'] : 0;
            $dateInput = trim((string) ($input['date'] ?? ''));

            if ($amount === null || $amount <= 0) {
                return $this->respondError('A valid amount is required.', 422);
            }

            if ($paymentType === '') {
                return $this->respondError('Payment type is required.', 422);
            }

            if ($description === '') {
                return $this->respondError('Description is required.', 422);
            }

            if ($expenseCategoryId <= 0) {
                return $this->respondError('Expense category is required.', 422);
            }

            if ($dateInput !== '' && strtotime($dateInput) === false) {
                return $this->respondError('A valid expense date is required.', 422);
            }

            if ($this->db->tableExists('expense_categories')) {
                $categoriesTable = $this->db->prefixTable('expense_categories');
                $categoryExistsSql = "
                    SELECT expense_category_id
                    FROM {$categoriesTable}
                    WHERE expense_category_id = ? AND deleted = 0
                    LIMIT 1
                ";
                $category = $this->db->query($categoryExistsSql, [$expenseCategoryId])->getRowArray();
                if ($category === null) {
                    return $this->respondError('Expense category not found.', 404);
                }
            }

            $employee = $this->employee->get_logged_in_employee_info();
            $expenseData = [
                'date' => $dateInput === '' ? date('Y-m-d H:i:s') : date('Y-m-d H:i:s', strtotime($dateInput)),
                'amount' => $amount,
                'payment_type' => $paymentType,
                'description' => $description,
                'employee_id' => (int) $employee->person_id,
                'deleted' => 0,
                'expense_category_id' => $expenseCategoryId
            ];

            if ($this->hasField('expenses', 'supplier_id') && array_key_exists('supplier_id', $input) && $input['supplier_id'] !== '' && $input['supplier_id'] !== null) {
                $expenseData['supplier_id'] = (int) $input['supplier_id'];
            }

            if ($this->hasField('expenses', 'supplier_tax_code') && array_key_exists('supplier_tax_code', $input)) {
                $expenseData['supplier_tax_code'] = trim((string) $input['supplier_tax_code']);
            }

            if ($this->hasField('expenses', 'tax_amount') && array_key_exists('tax_amount', $input) && $input['tax_amount'] !== '' && $input['tax_amount'] !== null) {
                $expenseData['tax_amount'] = (float) $input['tax_amount'];
            }

            if (!$this->db->table('expenses')->insert($expenseData)) {
                return $this->respondError('Failed to create expense.', 500);
            }

            $expenseId = (int) $this->db->insertID();
            $expense = $this->getExpenseById($expenseId);

            return $this->respondSuccess([
                'expense' => $expense
            ], 'Expense created.', 201);
        } catch (Throwable $e) {
            return $this->respondError('Failed to create expense.', 500);
        }
    }

    private function getExpenseById(int $expenseId): ?array
    {
        $expensesTable = $this->db->prefixTable('expenses');
        $categoriesTable = $this->db->prefixTable('expense_categories');
        $peopleTable = $this->db->prefixTable('people');
        $select = [
            'expenses.expense_id',
            'expenses.date',
            'expenses.amount',
            'expenses.payment_type',
            'expenses.description',
            'expenses.employee_id',
            'expenses.deleted',
            'expenses.expense_category_id'
        ];
        $joins = '';

        if ($this->db->tableExists('expense_categories')) {
            $select[] = 'expense_categories.category_name';
            $select[] = 'expense_categories.category_description';
            $joins .= "\n                LEFT JOIN {$categoriesTable} AS expense_categories ON expense_categories.expense_category_id = expenses.expense_category_id";
        } else {
            $select[] = 'NULL AS category_name';
            $select[] = 'NULL AS category_description';
        }

        if ($this->db->tableExists('people')) {
            $select[] = 'employee_people.first_name AS employee_first_name';
            $select[] = 'employee_people.last_name AS employee_last_name';
            $joins .= "\n                LEFT JOIN {$peopleTable} AS employee_people ON employee_people.person_id = expenses.employee_id";
        } else {
            $select[] = 'NULL AS employee_first_name';
            $select[] = 'NULL AS employee_last_name';
        }

        $sql = "
            SELECT
                " . implode(",\n                ", $select) . "
            FROM {$expensesTable} AS expenses{$joins}
            WHERE expenses.expense_id = ?
            LIMIT 1
        ";

        return $this->db->query($sql, [$expenseId])->getRowArray();
    }

    private function hasField(string $table, string $field): bool
    {
        return $this->db->tableExists($table) && in_array($field, $this->db->getFieldNames($table), true);
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $expensesTable = $this->db->prefixTable('expenses');
            $this->db->query("UPDATE {$expensesTable} SET deleted = 1 WHERE expense_id = ?", [$id]);

            return $this->respondSuccess(null, 'Expense deleted.');
        } catch (Throwable $e) {
            return $this->respondError('Error deleting expense: ' . $e->getMessage(), 500);
        }
    }

    /**
     * POST /api/expenses/bulk — historical accounting migration. No
     * dedupe (expenses are append-only; the import audit row is the
     * deduplication mechanism via payload_hash).
     *
     * Each row: { amount, payment_type, description, expense_category_id,
     *             date?, supplier_id?, supplier_tax_code?, tax_amount? }
     */
    public function bulkImport(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) return $authResponse;
        if (!$this->db->tableExists('expenses')) return $this->respondError('Expenses table missing.', 503);

        $body = $this->request->getJSON(true) ?? [];
        $employee = $this->employee->get_logged_in_employee_info();
        $employeeId = (int)($employee->person_id ?? 0);

        $hasSupplier = $this->hasField('expenses', 'supplier_id');
        $hasTaxCode = $this->hasField('expenses', 'supplier_tax_code');
        $hasTaxAmt = $this->hasField('expenses', 'tax_amount');

        $handler = function (array $row, int $idx, $db) use ($employeeId, $hasSupplier, $hasTaxCode, $hasTaxAmt) {
            $dryRun = !empty($row['__dry_run']);
            $amount = isset($row['amount']) ? (float)$row['amount'] : 0;
            $paymentType = trim((string)($row['payment_type'] ?? ''));
            $description = trim((string)($row['description'] ?? ''));
            $catId = (int)($row['expense_category_id'] ?? 0);
            $dateInput = trim((string)($row['date'] ?? ''));
            if ($amount <= 0) {
                return ['status' => 'failed', 'key' => '', 'message' => 'amount must be > 0'];
            }
            if ($paymentType === '') {
                return ['status' => 'failed', 'key' => '', 'message' => 'payment_type required'];
            }
            if ($description === '') {
                return ['status' => 'failed', 'key' => '', 'message' => 'description required'];
            }
            if ($catId <= 0) {
                return ['status' => 'failed', 'key' => '', 'message' => 'expense_category_id required (positive int)'];
            }
            if ($dateInput !== '' && strtotime($dateInput) === false) {
                return ['status' => 'failed', 'key' => '', 'message' => "invalid date '{$dateInput}'"];
            }
            // Validate category exists.
            $catExists = $db->table('expense_categories')
                ->where('expense_category_id', $catId)->where('deleted', 0)
                ->countAllResults();
            if ($catExists === 0) {
                return ['status' => 'failed', 'key' => '', 'message' => "expense_category_id {$catId} not found"];
            }
            $key = "{$description} · {$amount}";
            if ($dryRun) {
                return ['status' => 'imported', 'key' => $key, 'reason' => 'would insert'];
            }
            $data = [
                'date'                => $dateInput === '' ? date('Y-m-d H:i:s') : date('Y-m-d H:i:s', strtotime($dateInput)),
                'amount'              => $amount,
                'payment_type'        => mb_substr($paymentType, 0, 20),
                'description'         => mb_substr($description, 0, 4096),
                'employee_id'         => $employeeId,
                'deleted'             => 0,
                'expense_category_id' => $catId,
            ];
            if ($hasSupplier && !empty($row['supplier_id'])) $data['supplier_id'] = (int)$row['supplier_id'];
            if ($hasTaxCode && isset($row['supplier_tax_code'])) $data['supplier_tax_code'] = mb_substr((string)$row['supplier_tax_code'], 0, 50);
            if ($hasTaxAmt && isset($row['tax_amount'])) $data['tax_amount'] = (float)$row['tax_amount'];
            $db->table('expenses')->insert($data);
            return ['status' => 'imported', 'key' => $key, 'reason' => 'inserted'];
        };

        $result = BulkImportLib::run(
            $this->db, 'expenses', $body, $employeeId,
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
