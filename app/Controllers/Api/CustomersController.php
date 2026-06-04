<?php

namespace App\Controllers\Api;

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
}
