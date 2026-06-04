<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class GiftcardsController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string) ($this->request->getGet('search') ?? ''));

        try {
            if (!$this->db->tableExists('giftcards')) {
                return $this->respondSuccess([
                    'giftcards' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0,
                        'search' => $search
                    ]
                ], 'Giftcards table is not available.');
            }

            $giftcardsTable = $this->db->prefixTable('giftcards');
            $peopleTable = $this->db->prefixTable('people');
            $joins = '';
            $select = [
                'giftcards.giftcard_id',
                'giftcards.giftcard_number',
                'giftcards.value',
                'giftcards.deleted',
                'giftcards.person_id',
                'giftcards.record_time'
            ];
            $searchParts = [
                "giftcards.giftcard_number LIKE ? ESCAPE '!'"
            ];
            $params = [];

            if ($this->db->tableExists('people')) {
                $select[] = 'people.first_name';
                $select[] = 'people.last_name';
                $select[] = 'people.email';
                $joins = "\n                    LEFT JOIN {$peopleTable} AS people ON people.person_id = giftcards.person_id";
                $searchParts[] = "people.first_name LIKE ? ESCAPE '!'";
                $searchParts[] = "people.last_name LIKE ? ESCAPE '!'";
                $searchParts[] = "people.email LIKE ? ESCAPE '!'";
            }

            $searchSql = '';
            if ($search !== '') {
                $like = $this->likeValue($search);
                $params[] = $like;

                if ($this->db->tableExists('people')) {
                    $params[] = $like;
                    $params[] = $like;
                    $params[] = $like;
                }

                $searchSql = "\n                    AND (" . implode(' OR ', $searchParts) . ')';
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$giftcardsTable} AS giftcards{$joins}
                WHERE giftcards.deleted = 0{$searchSql}
                ORDER BY giftcards.record_time DESC, giftcards.giftcard_id DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "
                SELECT COUNT(*) AS total
                FROM {$giftcardsTable} AS giftcards{$joins}
                WHERE giftcards.deleted = 0{$searchSql}
            ";

            $giftcards = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'giftcards' => $giftcards,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                    'search' => $search
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load gift cards.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->db->tableExists('giftcards')) {
                return $this->respondError('Giftcards table is not available.', 503);
            }

            $giftcardsTable = $this->db->prefixTable('giftcards');
            $peopleTable = $this->db->prefixTable('people');
            $select = [
                'giftcards.giftcard_id',
                'giftcards.giftcard_number',
                'giftcards.value',
                'giftcards.deleted',
                'giftcards.person_id',
                'giftcards.record_time'
            ];
            $joins = '';

            if ($this->db->tableExists('people')) {
                $select[] = 'people.first_name';
                $select[] = 'people.last_name';
                $select[] = 'people.email';
                $select[] = 'people.phone_number';
                $joins = "\n                    LEFT JOIN {$peopleTable} AS people ON people.person_id = giftcards.person_id";
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$giftcardsTable} AS giftcards{$joins}
                WHERE giftcards.giftcard_id = ? AND giftcards.deleted = 0
                LIMIT 1
            ";

            $giftcard = $this->db->query($sql, [$id])->getRowArray();
            if ($giftcard === null) {
                return $this->respondError('Gift card not found.', 404);
            }

            return $this->respondSuccess([
                'giftcard' => $giftcard
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load gift card.', 500);
        }
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
            $giftcardsTable = $this->db->prefixTable('giftcards');

            $number = trim($data['giftcard_number'] ?? '');
            $value = (float)($data['value'] ?? 0);

            if ($number === '' || $value <= 0) {
                return $this->respondError('Card number and a positive value are required.', 422);
            }

            $this->db->query(
                "INSERT INTO {$giftcardsTable} (giftcard_number, value, deleted) VALUES (?, ?, 0)",
                [$number, $value]
            );

            return $this->respondSuccess(['giftcard_id' => $this->db->insertID()], 'Gift card created.', 201);
        } catch (Throwable $e) {
            return $this->respondError('Error creating gift card: ' . $e->getMessage(), 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $giftcardsTable = $this->db->prefixTable('giftcards');
            $this->db->query("UPDATE {$giftcardsTable} SET deleted = 1 WHERE giftcard_id = ?", [$id]);

            return $this->respondSuccess(null, 'Gift card deleted.');
        } catch (Throwable $e) {
            return $this->respondError('Error deleting gift card: ' . $e->getMessage(), 500);
        }
    }
}
