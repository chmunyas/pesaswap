<?php

namespace App\Controllers\Api;

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
}
