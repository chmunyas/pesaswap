<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Models\Employee;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\Session\Session;
use Psr\Log\LoggerInterface;

class BaseApiController extends BaseController
{
    protected Employee $employee;
    protected Session $session;
    protected BaseConnection $db;
    protected array $allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175'
    ];

    public function initController(RequestInterface $request, ResponseInterface $response, LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->employee = model(Employee::class);
        $this->session = session();
        $this->db = db_connect();

        $this->applyCorsHeaders();
    }

    public function preflight(): ResponseInterface
    {
        return $this->response->setStatusCode(204);
    }

    protected function requireAuth(): ?ResponseInterface
    {
        if (!$this->employee->is_logged_in()) {
            return $this->respondError('Authentication required.', 401);
        }

        return null;
    }

    protected function respondSuccess(mixed $data = null, string $message = 'OK', int $code = 200): ResponseInterface
    {
        return $this->response
            ->setStatusCode($code)
            ->setJSON([
                'success' => true,
                'data' => $data,
                'message' => $message
            ]);
    }

    protected function respondError(string $message, int $code = 400, mixed $data = null): ResponseInterface
    {
        return $this->response
            ->setStatusCode($code)
            ->setJSON([
                'success' => false,
                'data' => $data,
                'message' => $message
            ]);
    }

    protected function getRequestData(): array
    {
        $json = $this->request->getJSON(true);
        if (is_array($json)) {
            return $json;
        }

        $rawInput = $this->request->getRawInput();
        if (!empty($rawInput)) {
            return $rawInput;
        }

        $post = $this->request->getPost();
        return is_array($post) ? $post : [];
    }

    protected function getPagination(): array
    {
        $limit = (int)($this->request->getGet('limit') ?? 20);
        $offset = (int)($this->request->getGet('offset') ?? 0);

        $limit = max(1, min($limit, 100));
        $offset = max(0, $offset);

        return [
            'limit' => $limit,
            'offset' => $offset
        ];
    }

    protected function formatEmployee(object $employee): array
    {
        return [
            'person_id' => (int)$employee->person_id,
            'first_name' => $employee->first_name,
            'last_name' => $employee->last_name,
            'email' => $employee->email,
            'username' => $employee->username,
            'language' => $employee->language,
            'language_code' => $employee->language_code
        ];
    }

    private function applyCorsHeaders(): void
    {
        $origin = $this->request->getHeaderLine('Origin');

        if (in_array($origin, $this->allowedOrigins, true)) {
            $this->response->setHeader('Access-Control-Allow-Origin', $origin);
            $this->response->setHeader('Access-Control-Allow-Credentials', 'true');
        }

        $this->response->setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Authorization');
        $this->response->setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        $this->response->setHeader('Vary', 'Origin');
    }
}
