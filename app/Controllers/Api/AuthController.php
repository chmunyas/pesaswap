<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;

class AuthController extends BaseApiController
{
    public function login(): ResponseInterface
    {
        $data = $this->getRequestData();
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');

        if ($username === '' || $password === '') {
            return $this->respondError('Username and password are required.', 422);
        }

        if (!$this->employee->login($username, $password)) {
            return $this->respondError('Invalid username or password.', 401);
        }

        $employee = $this->employee->get_logged_in_employee_info();

        return $this->respondSuccess([
            'user' => $this->formatEmployee($employee)
        ], 'Login successful.');
    }

    public function logout(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $this->employee->logout();

        return $this->respondSuccess(null, 'Logout successful.');
    }

    public function me(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $employee = $this->employee->get_logged_in_employee_info();

        return $this->respondSuccess([
            'user' => $this->formatEmployee($employee)
        ]);
    }
}
