<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class MessagesController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();

        try {
            if (!$this->db->tableExists('messages')) {
                return $this->respondSuccess([
                    'messages' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0
                    ]
                ], 'Messages table does not exist; returning empty results.');
            }

            $messagesTable = $this->db->prefixTable('messages');
            $fields = $this->db->getFieldNames('messages');
            $userColumn = null;
            foreach (['person_id', 'employee_id', 'recipient_id', 'user_id'] as $candidate) {
                if (in_array($candidate, $fields, true)) {
                    $userColumn = $candidate;
                    break;
                }
            }

            $orderColumn = null;
            foreach (['created_at', 'message_date', 'date', 'id'] as $candidate) {
                if (in_array($candidate, $fields, true)) {
                    $orderColumn = $candidate;
                    break;
                }
            }

            if ($orderColumn === null) {
                $orderColumn = $fields[0] ?? '1';
            }

            if ($userColumn === null) {
                return $this->respondSuccess([
                    'messages' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0
                    ]
                ], 'Messages table exists, but no user column was found for safe filtering.');
            }

            $params = [(int) $this->employee->get_logged_in_employee_info()->person_id];
            $whereSql = " WHERE {$userColumn} = ?";
            $sql = "
                SELECT *
                FROM {$messagesTable}{$whereSql}
                ORDER BY {$orderColumn} DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "SELECT COUNT(*) AS total FROM {$messagesTable}{$whereSql}";
            $messages = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'messages' => $messages,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load messages.', 500);
        }
    }
}
