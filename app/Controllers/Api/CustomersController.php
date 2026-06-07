<?php

namespace App\Controllers\Api;

use App\Libraries\BulkImportLib;
use App\Models\Customer;
use CodeIgniter\HTTP\ResponseInterface;

class CustomersController extends BaseApiController
{
    protected Customer $customer;

    public function initController(\CodeIgniter\HTTP\RequestInterface $request, \CodeIgniter\HTTP\ResponseInterface $response, \Psr\Log\LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->customer = model(Customer::class);
    }

    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string)($this->request->getGet('search') ?? ''));

        $customers = $this->customer->search($search, $pagination['limit'], $pagination['offset'], 'last_name', 'asc');
        $total = $this->customer->get_found_rows($search);

        return $this->respondSuccess([
            'customers' => $customers->getResultArray(),
            'pagination' => [
                'limit' => $pagination['limit'],
                'offset' => $pagination['offset'],
                'total' => $total,
                'search' => $search
            ]
        ]);
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        if (!$this->customer->exists($id)) {
            return $this->respondError('Customer not found.', 404);
        }

        $stats = $this->customer->get_stats($id);

        return $this->respondSuccess([
            'customer' => (array)$this->customer->get_info($id),
            'stats' => $stats === null ? null : (array)$stats
        ]);
    }

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $data = $this->getRequestData();

            $personData = [
                'first_name' => trim($data['first_name'] ?? ''),
                'last_name' => trim($data['last_name'] ?? ''),
                'email' => trim($data['email'] ?? ''),
                'phone_number' => trim($data['phone_number'] ?? ''),
                'address_1' => trim($data['address_1'] ?? ''),
                'address_2' => trim($data['address_2'] ?? ''),
                'city' => trim($data['city'] ?? ''),
                'state' => trim($data['state'] ?? ''),
                'zip' => trim($data['zip'] ?? ''),
                'country' => trim($data['country'] ?? ''),
                'comments' => trim($data['comments'] ?? ''),
            ];

            $customerData = [
                'company_name' => trim($data['company_name'] ?? ''),
                'account_number' => trim($data['account_number'] ?? ''),
                'discount' => (float)($data['discount'] ?? 0),
                'discount_type' => (int)($data['discount_type'] ?? 0),
                'taxable' => (int)($data['taxable'] ?? 1),
            ];

            if (empty($personData['first_name']) && empty($personData['last_name'])) {
                return $this->respondError('First name or last name is required.', 422);
            }

            $result = $this->customer->save_customer($personData, $customerData);

            if ($result) {
                return $this->respondSuccess(['person_id' => $result], 'Customer created.', 201);
            }

            return $this->respondError('Failed to create customer.', 500);
        } catch (\Throwable $e) {
            return $this->respondError('Error creating customer: ' . $e->getMessage(), 500);
        }
    }

    public function update(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->customer->exists($id)) {
                return $this->respondError('Customer not found.', 404);
            }

            $data = $this->getRequestData();

            $personData = [
                'first_name' => trim($data['first_name'] ?? ''),
                'last_name' => trim($data['last_name'] ?? ''),
                'email' => trim($data['email'] ?? ''),
                'phone_number' => trim($data['phone_number'] ?? ''),
                'address_1' => trim($data['address_1'] ?? ''),
                'address_2' => trim($data['address_2'] ?? ''),
                'city' => trim($data['city'] ?? ''),
                'state' => trim($data['state'] ?? ''),
                'zip' => trim($data['zip'] ?? ''),
                'country' => trim($data['country'] ?? ''),
                'comments' => trim($data['comments'] ?? ''),
            ];

            $customerData = [
                'company_name' => trim($data['company_name'] ?? ''),
                'account_number' => trim($data['account_number'] ?? ''),
                'discount' => (float)($data['discount'] ?? 0),
                'discount_type' => (int)($data['discount_type'] ?? 0),
                'taxable' => (int)($data['taxable'] ?? 1),
            ];

            $result = $this->customer->save_customer($personData, $customerData, $id);

            if ($result) {
                return $this->respondSuccess(null, 'Customer updated.');
            }

            return $this->respondError('Failed to update customer.', 500);
        } catch (\Throwable $e) {
            return $this->respondError('Error updating customer: ' . $e->getMessage(), 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->customer->exists($id)) {
                return $this->respondError('Customer not found.', 404);
            }

            $this->customer->delete($id);

            return $this->respondSuccess(null, 'Customer deleted.');
        } catch (\Throwable $e) {
            return $this->respondError('Error deleting customer: ' . $e->getMessage(), 500);
        }
    }

    /**
     * POST /api/customers/bulk — batched upsert. Idempotency: email
     * (case-insensitive) first, then phone_number. Either may be empty
     * but at least one of (first_name, last_name) must be present.
     */
    public function bulkImport(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) return $authResponse;

        $body = $this->request->getJSON(true) ?? [];
        $employeeId = (int)($this->employee->get_logged_in_employee_info()->person_id ?? 0);
        $custModel = $this->customer;

        $handler = function (array $row, int $idx, $db) use ($custModel) {
            $dryRun = !empty($row['__dry_run']);
            $first = trim((string)($row['first_name'] ?? ''));
            $last  = trim((string)($row['last_name'] ?? ''));
            $email = trim((string)($row['email'] ?? ''));
            $phone = trim((string)($row['phone_number'] ?? ''));
            $key   = $email !== '' ? $email : ($phone !== '' ? $phone : trim("$first $last"));
            if ($first === '' && $last === '') {
                return ['status' => 'failed', 'key' => $key, 'message' => 'first_name or last_name required'];
            }
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return ['status' => 'failed', 'key' => $key, 'message' => 'invalid email'];
            }

            // Look up existing by email, then by phone.
            $existingId = null;
            if ($email !== '') {
                $hit = $db->table('people')->where('LOWER(email)', strtolower($email))->limit(1)->get()->getRowArray();
                if ($hit !== null) $existingId = (int)$hit['person_id'];
            }
            if ($existingId === null && $phone !== '') {
                $hit = $db->table('people')->where('phone_number', $phone)->limit(1)->get()->getRowArray();
                if ($hit !== null) $existingId = (int)$hit['person_id'];
            }

            $personData = [
                'first_name'   => mb_substr($first, 0, 255),
                'last_name'    => mb_substr($last, 0, 255),
                'email'        => mb_substr($email, 0, 255),
                'phone_number' => mb_substr($phone, 0, 32),
                'address_1'    => mb_substr((string)($row['address_1'] ?? ''), 0, 255),
                'address_2'    => mb_substr((string)($row['address_2'] ?? ''), 0, 255),
                'city'         => mb_substr((string)($row['city'] ?? ''), 0, 100),
                'state'        => mb_substr((string)($row['state'] ?? ''), 0, 100),
                'zip'          => mb_substr((string)($row['zip'] ?? ''), 0, 20),
                'country'      => mb_substr((string)($row['country'] ?? ''), 0, 100),
                'comments'     => mb_substr((string)($row['comments'] ?? ''), 0, 4096),
            ];
            $customerData = [
                'company_name'   => mb_substr((string)($row['company_name'] ?? ''), 0, 255),
                'account_number' => mb_substr((string)($row['account_number'] ?? ''), 0, 50),
                'discount'       => (float)($row['discount'] ?? 0),
                'discount_type'  => (int)($row['discount_type'] ?? 0),
                'taxable'        => (int)($row['taxable'] ?? 1),
            ];

            if ($dryRun) {
                return ['status' => 'imported', 'key' => $key, 'reason' => $existingId !== null ? 'would update' : 'would insert'];
            }

            $savedId = $custModel->save_customer($personData, $customerData, $existingId);
            if (!$savedId) {
                return ['status' => 'failed', 'key' => $key, 'message' => 'save_customer returned falsy'];
            }
            return ['status' => 'imported', 'key' => $key, 'reason' => $existingId !== null ? 'updated' : 'inserted'];
        };

        $result = BulkImportLib::run(
            $this->db, 'customers', $body, $employeeId,
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
