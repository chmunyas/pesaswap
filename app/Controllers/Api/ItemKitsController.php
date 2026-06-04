<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * ItemKitsController — full CRUD for OSPOS item kits.
 *
 * Maps to the underlying ospos_item_kits + ospos_item_kit_items schema:
 *
 *   ospos_item_kits           (item_kit_id, item_kit_number, name, description,
 *                              kit_discount, kit_discount_type, price_option,
 *                              print_option, item_id)
 *   ospos_item_kit_items      (item_kit_id, item_id, quantity, kit_sequence)
 *
 * Discount, price, and print options follow the OSPOS constants from
 * app/Config/Constants.php:
 *   kit_discount_type:  0 = PERCENT, 1 = FIXED
 *   price_option:       0 = ALL (sum of items), 1 = KIT (kit price only),
 *                       2 = KIT + STOCK (kit + non-stock items)
 *   print_option:       0 = ALL, 1 = PRICED only, 2 = KIT name only
 *
 * Mutations write item_kit_items in a transaction so a partially-saved
 * kit can never end up in the DB.
 */
class ItemKitsController extends BaseApiController
{
    private const DISCOUNT_PERCENT = 0;
    private const DISCOUNT_FIXED = 1;

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
            $select = $this->buildKitSelect();
            $where = 'WHERE 1 = 1';
            if ($this->hasField('item_kits', 'deleted')) {
                $where .= ' AND item_kits.deleted = 0';
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

            $rows = $this->db->query($sql, $params)->getResultArray();
            $total = (int) ($this->db->query($countSql, $params)->getRowArray()['total'] ?? 0);

            // Attach item count + individual_total + computed kit_price to each row.
            $itemKits = array_map(fn(array $r) => $this->decorateKit($r), $rows);

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
            log_message('error', 'ItemKitsController::index — ' . $e->getMessage());
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

            $itemKit = $this->fetchKit($id);
            if ($itemKit === null) {
                return $this->respondError('Item kit not found.', 404);
            }

            return $this->respondSuccess([
                'item_kit' => $this->decorateKit($itemKit),
                'items' => $this->fetchKitItems($id),
            ]);
        } catch (Throwable $e) {
            log_message('error', 'ItemKitsController::show — ' . $e->getMessage());
            return $this->respondError('Failed to load item kit.', 500);
        }
    }

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->db->tableExists('item_kits')) {
            return $this->respondError('Item kits table is not available.', 503);
        }

        $payload = $this->parseKitPayload();
        if (is_string($payload)) {
            return $this->respondError($payload, 422);
        }

        $items = $this->parseKitItemsPayload();
        if (is_string($items)) {
            return $this->respondError($items, 422);
        }

        try {
            $this->db->transStart();

            $builder = $this->db->table('item_kits');
            $builder->insert($payload);
            $newId = (int) $this->db->insertID();

            $this->replaceKitItems($newId, $items);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to create item kit.', 500);
            }

            $fresh = $this->fetchKit($newId);
            return $this->respondSuccess([
                'item_kit' => $fresh !== null ? $this->decorateKit($fresh) : null,
                'items' => $this->fetchKitItems($newId),
            ], 'Item kit created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'ItemKitsController::create — ' . $e->getMessage());
            return $this->respondError('Failed to create item kit.', 500);
        }
    }

    public function update(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->db->tableExists('item_kits')) {
            return $this->respondError('Item kits table is not available.', 503);
        }

        $existing = $this->fetchKit($id);
        if ($existing === null) {
            return $this->respondError('Item kit not found.', 404);
        }

        $payload = $this->parseKitPayload();
        if (is_string($payload)) {
            return $this->respondError($payload, 422);
        }

        $items = $this->parseKitItemsPayload();
        if (is_string($items)) {
            return $this->respondError($items, 422);
        }

        try {
            $this->db->transStart();

            $this->db->table('item_kits')
                ->where('item_kit_id', $id)
                ->update($payload);

            $this->replaceKitItems($id, $items);

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to update item kit.', 500);
            }

            $fresh = $this->fetchKit($id);
            return $this->respondSuccess([
                'item_kit' => $fresh !== null ? $this->decorateKit($fresh) : null,
                'items' => $this->fetchKitItems($id),
            ], 'Item kit updated.');
        } catch (Throwable $e) {
            log_message('error', 'ItemKitsController::update — ' . $e->getMessage());
            return $this->respondError('Failed to update item kit.', 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }
        if (!$this->db->tableExists('item_kits')) {
            return $this->respondError('Item kits table is not available.', 503);
        }

        $existing = $this->fetchKit($id);
        if ($existing === null) {
            return $this->respondError('Item kit not found.', 404);
        }

        try {
            $this->db->transStart();

            // Child rows first (item_kit_items has PRIMARY KEY on item_kit_id,
            // so a kit cannot exist with orphan items).
            if ($this->db->tableExists('item_kit_items')) {
                $this->db->table('item_kit_items')->where('item_kit_id', $id)->delete();
            }

            if ($this->hasField('item_kits', 'deleted')) {
                // Soft delete when the schema supports it (preserves history).
                $this->db->table('item_kits')
                    ->where('item_kit_id', $id)
                    ->update(['deleted' => 1]);
            } else {
                $this->db->table('item_kits')
                    ->where('item_kit_id', $id)
                    ->delete();
            }

            $this->db->transComplete();
            if (!$this->db->transStatus()) {
                return $this->respondError('Failed to delete item kit.', 500);
            }

            return $this->respondSuccess(['item_kit_id' => $id], 'Item kit deleted.');
        } catch (Throwable $e) {
            log_message('error', 'ItemKitsController::delete — ' . $e->getMessage());
            return $this->respondError('Failed to delete item kit.', 500);
        }
    }

    // ---------- helpers ----------

    /**
     * Builds the SELECT list for an item_kits row, defending against any
     * column being absent (older / partial OSPOS deployments may lack
     * item_kit_number or deleted).
     *
     * @return string[]
     */
    private function buildKitSelect(): array
    {
        $columns = [
            'item_kits.item_kit_id',
            'item_kits.name',
            'item_kits.description',
            $this->fieldOrDefault('item_kits', 'item_kit_number', 'NULL', 'item_kit_number'),
            $this->fieldOrDefault('item_kits', 'kit_discount', '0', 'kit_discount'),
            $this->fieldOrDefault('item_kits', 'kit_discount_type', '0', 'kit_discount_type'),
            $this->fieldOrDefault('item_kits', 'price_option', '0', 'price_option'),
            $this->fieldOrDefault('item_kits', 'print_option', '0', 'print_option'),
            $this->fieldOrDefault('item_kits', 'item_id', '0', 'item_id'),
        ];
        if ($this->hasField('item_kits', 'deleted')) {
            $columns[] = 'item_kits.deleted';
        } else {
            $columns[] = '0 AS deleted';
        }
        return $columns;
    }

    private function fetchKit(int $id): ?array
    {
        $select = $this->buildKitSelect();
        $where = 'item_kits.item_kit_id = ?';
        if ($this->hasField('item_kits', 'deleted')) {
            $where .= ' AND item_kits.deleted = 0';
        }
        $sql = "SELECT " . implode(', ', $select) . "
                FROM " . $this->db->prefixTable('item_kits') . " AS item_kits
                WHERE {$where} LIMIT 1";
        $row = $this->db->query($sql, [$id])->getRowArray();
        return $row ?: null;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function fetchKitItems(int $id): array
    {
        if (!$this->db->tableExists('item_kit_items')) {
            return [];
        }
        $itemKitItemsTable = $this->db->prefixTable('item_kit_items');
        $hasItems = $this->db->tableExists('items');
        $itemsTable = $hasItems ? $this->db->prefixTable('items') : null;

        $select = [
            'item_kit_items.item_kit_id',
            'item_kit_items.item_id',
            'item_kit_items.quantity',
            $this->hasField('item_kit_items', 'kit_sequence')
                ? 'item_kit_items.kit_sequence'
                : '0 AS kit_sequence',
        ];
        $join = '';
        if ($hasItems) {
            $select[] = 'items.name AS item_name';
            $select[] = 'items.item_number';
            $select[] = 'items.unit_price';
            $join = "\n                    LEFT JOIN {$itemsTable} AS items ON items.item_id = item_kit_items.item_id";
            if ($this->hasField('items', 'deleted')) {
                // Don't hide deleted child items — operator should see them and
                // decide whether to remove the kit reference. But surface flag.
                $select[] = 'items.deleted AS item_deleted';
            }
        }

        $sql = "SELECT " . implode(', ', $select) . "
                FROM {$itemKitItemsTable} AS item_kit_items{$join}
                WHERE item_kit_items.item_kit_id = ?
                ORDER BY kit_sequence ASC, item_kit_items.item_id ASC";
        return $this->db->query($sql, [$id])->getResultArray();
    }

    /**
     * Attach computed fields the frontend needs without making it query items
     * itself: item_count, individual_total (sum of child unit_price * qty),
     * and kit_price (the price actually charged after kit_discount is applied
     * to individual_total when price_option == PRICE_OPTION_ALL).
     */
    private function decorateKit(array $row): array
    {
        $id = (int) $row['item_kit_id'];
        $children = $this->fetchKitItems($id);

        $count = 0;
        $individualTotal = 0.0;
        foreach ($children as $child) {
            $qty = (float) ($child['quantity'] ?? 0);
            $count += $qty > 0 ? 1 : 0;
            $individualTotal += $qty * (float) ($child['unit_price'] ?? 0);
        }

        $discount = (float) ($row['kit_discount'] ?? 0);
        $discountType = (int) ($row['kit_discount_type'] ?? self::DISCOUNT_PERCENT);
        $discountedTotal = $individualTotal;
        if ($discount > 0) {
            $discountedTotal -= $discountType === self::DISCOUNT_PERCENT
                ? $individualTotal * ($discount / 100)
                : $discount;
            if ($discountedTotal < 0) $discountedTotal = 0;
        }
        $kitPrice = round($discountedTotal, 2);

        $row['item_kit_id'] = $id;
        $row['kit_discount'] = (float) $row['kit_discount'];
        $row['kit_discount_type'] = (int) $row['kit_discount_type'];
        $row['price_option'] = (int) $row['price_option'];
        $row['print_option'] = (int) $row['print_option'];
        $row['item_count'] = $count;
        $row['individual_total'] = round($individualTotal, 2);
        $row['kit_price'] = $kitPrice;
        return $row;
    }

    /**
     * Parses + validates the top-level kit fields from the request body.
     *
     * @return array<string,mixed>|string  array of safe DB fields, or an error message
     */
    private function parseKitPayload(): array|string
    {
        $body = $this->request->getJSON(true) ?? [];

        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 255) {
            return 'Kit name is required (1–255 characters).';
        }

        $description = (string) ($body['description'] ?? '');
        $kitNumber = isset($body['item_kit_number']) ? (string) $body['item_kit_number'] : '';

        $discount = (float) ($body['kit_discount'] ?? 0);
        if ($discount < 0) {
            return 'Discount must be zero or positive.';
        }
        $discountType = (int) ($body['kit_discount_type'] ?? self::DISCOUNT_PERCENT);
        if (!in_array($discountType, [self::DISCOUNT_PERCENT, self::DISCOUNT_FIXED], true)) {
            return 'Discount type must be 0 (percent) or 1 (fixed).';
        }
        if ($discountType === self::DISCOUNT_PERCENT && $discount > 100) {
            return 'Percent discount must be between 0 and 100.';
        }

        $priceOption = (int) ($body['price_option'] ?? 0);
        if (!in_array($priceOption, [0, 1, 2], true)) {
            return 'Price option must be 0, 1, or 2.';
        }

        $printOption = (int) ($body['print_option'] ?? 0);
        if (!in_array($printOption, [0, 1, 2], true)) {
            return 'Print option must be 0, 1, or 2.';
        }

        // Only include fields that actually exist on this deployment's schema.
        $row = [
            'name' => mb_substr($name, 0, 255),
            'description' => mb_substr($description, 0, 255),
            'kit_discount' => $discount,
            'kit_discount_type' => $discountType,
            'price_option' => $priceOption,
            'print_option' => $printOption,
            'item_id' => 0,
        ];
        if ($this->hasField('item_kits', 'item_kit_number') && $kitNumber !== '') {
            $row['item_kit_number'] = mb_substr($kitNumber, 0, 255);
        }
        return $row;
    }

    /**
     * Parses + validates the nested items array.
     *
     * @return array<int,array<string,mixed>>|string  rows ready for insert, or error message
     */
    private function parseKitItemsPayload(): array|string
    {
        $body = $this->request->getJSON(true) ?? [];
        $raw = $body['items'] ?? [];
        if (!is_array($raw)) {
            return 'items must be an array.';
        }
        if (count($raw) > 200) {
            return 'A kit may contain at most 200 items.';
        }

        $itemsTable = $this->db->tableExists('items') ? $this->db->prefixTable('items') : null;
        $rows = [];
        $sequence = 0;
        foreach ($raw as $entry) {
            if (!is_array($entry)) {
                return 'Each kit item must be an object with item_id and quantity.';
            }
            $itemId = (int) ($entry['item_id'] ?? 0);
            $quantity = (float) ($entry['quantity'] ?? 0);
            if ($itemId <= 0) {
                return 'Each kit item must have a positive item_id.';
            }
            if ($quantity <= 0) {
                return 'Each kit item must have a quantity greater than zero.';
            }
            // FK integrity — refuse unknown items rather than silently writing dangling refs.
            if ($itemsTable !== null) {
                $exists = $this->db->table($itemsTable)
                    ->where('item_id', $itemId)
                    ->countAllResults();
                if ($exists === 0) {
                    return "Unknown item_id {$itemId} in kit items.";
                }
            }
            $rows[] = [
                'item_id' => $itemId,
                'quantity' => $quantity,
                'kit_sequence' => isset($entry['kit_sequence']) ? (int) $entry['kit_sequence'] : $sequence,
            ];
            $sequence++;
        }
        return $rows;
    }

    /**
     * Atomically replaces the child rows of a kit. Caller must be inside an
     * outer transStart()/transComplete() so a failure rolls back the parent
     * kit insert/update too.
     */
    private function replaceKitItems(int $kitId, array $items): void
    {
        if (!$this->db->tableExists('item_kit_items')) {
            return;
        }
        $builder = $this->db->table('item_kit_items');
        $builder->where('item_kit_id', $kitId)->delete();
        foreach ($items as $row) {
            $row['item_kit_id'] = $kitId;
            $builder->insert($row);
        }
    }

    private function hasField(string $table, string $field): bool
    {
        return $this->db->tableExists($table) && in_array($field, $this->db->getFieldNames($table), true);
    }

    /**
     * Returns either "table.field" or "<default> AS <alias>" depending on
     * whether the column exists on this deployment.
     */
    private function fieldOrDefault(string $table, string $field, string $defaultExpr, string $alias): string
    {
        return $this->hasField($table, $field)
            ? "{$table}.{$field}"
            : "{$defaultExpr} AS {$alias}";
    }

    private function likeValue(string $value): string
    {
        return '%' . $this->db->escapeLikeString($value) . '%';
    }
}
