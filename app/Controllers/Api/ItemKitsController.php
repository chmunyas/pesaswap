<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class ItemKitsController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string) ($this->request->getGet('search') ?? ''));

        try {
            if (!$this->db->tableExists('item_kits')) {
                return $this->respondSuccess([
                    'item_kits' => [],
                    'pagination' => [
                        'limit' => $pagination['limit'],
                        'offset' => $pagination['offset'],
                        'total' => 0,
                        'search' => $search
                    ]
                ], 'Item kits table is not available.');
            }

            $itemKitsTable = $this->db->prefixTable('item_kits');
            $select = [
                'item_kits.item_kit_id',
                'item_kits.name',
                $this->hasField('item_kits', 'item_kit_number') ? 'item_kits.item_kit_number' : 'NULL AS item_kit_number',
                'item_kits.description',
                '0 AS deleted'
            ];
            $where = 'WHERE 1 = 1';
            if ($this->hasField('item_kits', 'deleted')) {
                $where .= ' AND item_kits.deleted = 0';
                $select[4] = 'item_kits.deleted';
            }

            $params = [];
            $searchSql = '';
            if ($search !== '') {
                $like = $this->likeValue($search);
                $searchConditions = [
                    "item_kits.name LIKE ? ESCAPE '!'",
                    "item_kits.description LIKE ? ESCAPE '!'"
                ];
                $params = [$like, $like];

                if ($this->hasField('item_kits', 'item_kit_number')) {
                    $searchConditions[] = "item_kits.item_kit_number LIKE ? ESCAPE '!'";
                    $params[] = $like;
                }

                $searchSql = "\n                    AND (" . implode(' OR ', $searchConditions) . ')';
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$itemKitsTable} AS item_kits
                {$where}{$searchSql}
                ORDER BY item_kits.name ASC, item_kits.item_kit_id ASC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}
            ";

            $countSql = "
                SELECT COUNT(*) AS total
                FROM {$itemKitsTable} AS item_kits
                {$where}{$searchSql}
            ";

            $itemKits = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            return $this->respondSuccess([
                'item_kits' => $itemKits,
                'pagination' => [
                    'limit' => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total' => $total,
                    'search' => $search
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load item kits.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            if (!$this->db->tableExists('item_kits')) {
                return $this->respondError('Item kits table is not available.', 503);
            }

            $itemKitsTable = $this->db->prefixTable('item_kits');
            $select = [
                'item_kits.item_kit_id',
                'item_kits.name',
                $this->hasField('item_kits', 'item_kit_number') ? 'item_kits.item_kit_number' : 'NULL AS item_kit_number',
                'item_kits.description',
                '0 AS deleted'
            ];
            $where = 'item_kits.item_kit_id = ?';
            if ($this->hasField('item_kits', 'deleted')) {
                $select[4] = 'item_kits.deleted';
                $where .= ' AND item_kits.deleted = 0';
            }

            $sql = "
                SELECT
                    " . implode(",\n                    ", $select) . "
                FROM {$itemKitsTable} AS item_kits
                WHERE {$where}
                LIMIT 1
            ";

            $itemKit = $this->db->query($sql, [$id])->getRowArray();
            if ($itemKit === null) {
                return $this->respondError('Item kit not found.', 404);
            }

            $items = [];
            if ($this->db->tableExists('item_kit_items')) {
                $itemKitItemsTable = $this->db->prefixTable('item_kit_items');
                $itemsTable = $this->db->prefixTable('items');
                $itemSelect = [
                    'item_kit_items.item_kit_id',
                    'item_kit_items.item_id',
                    'item_kit_items.quantity',
                    $this->hasField('item_kit_items', 'kit_sequence') ? 'item_kit_items.kit_sequence' : '0 AS kit_sequence'
                ];
                $itemJoins = '';

                if ($this->db->tableExists('items')) {
                    $itemSelect[] = 'items.name AS item_name';
                    $itemSelect[] = 'items.item_number';
                    $itemSelect[] = 'items.unit_price';
                    $itemJoins = "\n                        LEFT JOIN {$itemsTable} AS items ON items.item_id = item_kit_items.item_id";
                }

                $itemSql = "
                    SELECT
                        " . implode(",\n                        ", $itemSelect) . "
                    FROM {$itemKitItemsTable} AS item_kit_items{$itemJoins}
                    WHERE item_kit_items.item_kit_id = ?
                    ORDER BY kit_sequence ASC, item_kit_items.item_id ASC
                ";

                $items = $this->db->query($itemSql, [$id])->getResultArray();
            }

            return $this->respondSuccess([
                'item_kit' => $itemKit,
                'items' => $items
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load item kit.', 500);
        }
    }

    private function hasField(string $table, string $field): bool
    {
        return $this->db->tableExists($table) && in_array($field, $this->db->getFieldNames($table), true);
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }
}
