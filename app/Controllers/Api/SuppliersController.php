<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class SuppliersController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string) ($this->request->getGet('search') ?? ''));

        try {
            if (!$this->hasTables(['suppliers', 'people'])) {
                return $this->respondSuccess([
                    'suppliers' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0,
                        'search' => $search
                    ]
                ], 'Suppliers table is not available.');
            }

            $suppliersTable = $this->db->prefixTable('suppliers');
            $peopleTable = $this->db->prefixTable('people');
            $params = [];
            $searchSql = '';

            if ($search !== '') {
                $like = $this->likeValue($search);
                $searchSql = "\n                    AND (\n                        suppliers.company_name LIKE ? ESCAPE '!'\n                        OR people.first_name LIKE ? ESCAPE '!'\n                        OR people.last_name LIKE ? ESCAPE '!'\n                        OR people.email LIKE ? ESCAPE '!'\n                        OR people.phone_number LIKE ? ESCAPE '!'\n                        OR CONCAT(COALESCE(people.first_name, ''), ' ', COALESCE(people.last_name, '')) LIKE ? ESCAPE '!'\n                    )";
                $params = [$like, $like, $like, $like, $like, $like];
            }

            $sql = "
                SELECT
                    suppliers.person_id,
                    suppliers.company_name,
                    people.first_name,
                    people.last_name,
                    people.email,
                    people.phone_number,
                    people.address_1,
                    people.city,
                    people.state,
                    people.zip,
                    suppliers.deleted,
                    TRIM(CONCAT(COALESCE(people.first_name, ''), ' ', COALESCE(people.last_name, ''))) AS full_name
                FROM {$suppliersTable} AS suppliers
                INNER JOIN {$peopleTable} AS people ON people.person_id = suppliers.person_id
                WHERE suppliers.deleted = 0{$searchSql}
                ORDER BY suppliers.company_name ASC, people.last_name ASC, people.first_name ASC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "
                SELECT COUNT(*) AS total
                FROM {$suppliersTable} AS suppliers
                INNER JOIN {$peopleTable} AS people ON people.person_id = suppliers.person_id
                WHERE suppliers.deleted = 0{$searchSql}
            ";

            $suppliers = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'suppliers' => $suppliers,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                    'search' => $search
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load suppliers.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->hasTables(['suppliers', 'people'])) {
                return $this->respondError('Suppliers table is not available.', 503);
            }

            $suppliersTable = $this->db->prefixTable('suppliers');
            $peopleTable = $this->db->prefixTable('people');
            $sql = "
                SELECT
                    suppliers.person_id,
                    suppliers.company_name,
                    people.first_name,
                    people.last_name,
                    people.email,
                    people.phone_number,
                    people.address_1,
                    people.address_2,
                    people.city,
                    people.state,
                    people.zip,
                    people.country,
                    people.comments,
                    suppliers.deleted,
                    TRIM(CONCAT(COALESCE(people.first_name, ''), ' ', COALESCE(people.last_name, ''))) AS full_name
                FROM {$suppliersTable} AS suppliers
                INNER JOIN {$peopleTable} AS people ON people.person_id = suppliers.person_id
                WHERE suppliers.person_id = ? AND suppliers.deleted = 0
                LIMIT 1
            ";

            $supplier = $this->db->query($sql, [$id])->getRowArray();
            if ($supplier === null) {
                return $this->respondError('Supplier not found.', 404);
            }

            return $this->respondSuccess([
                'supplier' => $supplier
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load supplier.', 500);
        }
    }

    private function hasTables(array $tables): bool
    {
        foreach ($tables as $table) {
            if (!$this->db->tableExists($table)) {
                return false;
            }
        }

        return true;
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $data = $this->getRequestData();
            $peopleTable = $this->db->prefixTable('people');
            $suppliersTable = $this->db->prefixTable('suppliers');

            $this->db->transStart();

            $this->db->query(
                "INSERT INTO {$peopleTable} (first_name, last_name, email, phone_number, address_1, address_2, city, state, zip, country, comments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    trim($data['first_name'] ?? ''),
                    trim($data['last_name'] ?? ''),
                    trim($data['email'] ?? ''),
                    trim($data['phone_number'] ?? ''),
                    trim($data['address_1'] ?? ''),
                    trim($data['address_2'] ?? ''),
                    trim($data['city'] ?? ''),
                    trim($data['state'] ?? ''),
                    trim($data['zip'] ?? ''),
                    trim($data['country'] ?? ''),
                    trim($data['comments'] ?? ''),
                ]
            );

            $personId = $this->db->insertID();

            $this->db->query(
                "INSERT INTO {$suppliersTable} (person_id, company_name, agency_name, account_number, deleted) VALUES (?, ?, ?, ?, 0)",
                [
                    $personId,
                    trim($data['company_name'] ?? ''),
                    trim($data['agency_name'] ?? ''),
                    trim($data['account_number'] ?? ''),
                ]
            );

            $this->db->transComplete();

            if ($this->db->transStatus()) {
                return $this->respondSuccess(['person_id' => $personId], 'Supplier created.', 201);
            }

            return $this->respondError('Failed to create supplier.', 500);
        } catch (Throwable $e) {
            return $this->respondError('Error creating supplier: ' . $e->getMessage(), 500);
        }
    }

    public function update(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $data = $this->getRequestData();
            $peopleTable = $this->db->prefixTable('people');
            $suppliersTable = $this->db->prefixTable('suppliers');

            $this->db->transStart();

            $this->db->query(
                "UPDATE {$peopleTable} SET first_name=?, last_name=?, email=?, phone_number=?, address_1=?, address_2=?, city=?, state=?, zip=?, country=?, comments=? WHERE person_id=?",
                [
                    trim($data['first_name'] ?? ''),
                    trim($data['last_name'] ?? ''),
                    trim($data['email'] ?? ''),
                    trim($data['phone_number'] ?? ''),
                    trim($data['address_1'] ?? ''),
                    trim($data['address_2'] ?? ''),
                    trim($data['city'] ?? ''),
                    trim($data['state'] ?? ''),
                    trim($data['zip'] ?? ''),
                    trim($data['country'] ?? ''),
                    trim($data['comments'] ?? ''),
                    $id,
                ]
            );

            $this->db->query(
                "UPDATE {$suppliersTable} SET company_name=?, agency_name=?, account_number=? WHERE person_id=?",
                [
                    trim($data['company_name'] ?? ''),
                    trim($data['agency_name'] ?? ''),
                    trim($data['account_number'] ?? ''),
                    $id,
                ]
            );

            $this->db->transComplete();

            if ($this->db->transStatus()) {
                return $this->respondSuccess(null, 'Supplier updated.');
            }

            return $this->respondError('Failed to update supplier.', 500);
        } catch (Throwable $e) {
            return $this->respondError('Error updating supplier: ' . $e->getMessage(), 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $suppliersTable = $this->db->prefixTable('suppliers');
            $this->db->query("UPDATE {$suppliersTable} SET deleted = 1 WHERE person_id = ?", [$id]);

            return $this->respondSuccess(null, 'Supplier deleted.');
        } catch (Throwable $e) {
            return $this->respondError('Error deleting supplier: ' . $e->getMessage(), 500);
        }
    }
}
