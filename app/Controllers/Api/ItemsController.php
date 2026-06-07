<?php

namespace App\Controllers\Api;

use App\Libraries\BulkImportLib;
use App\Models\Item;
use CodeIgniter\HTTP\ResponseInterface;

class ItemsController extends BaseApiController
{
    protected Item $item;

    public function initController(\CodeIgniter\HTTP\RequestInterface $request, \CodeIgniter\HTTP\ResponseInterface $response, \Psr\Log\LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->item = model(Item::class);
    }

    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string)($this->request->getGet('search') ?? ''));

        $builder = $this->db->table('items')->where('deleted', 0);
        if ($search !== '') {
            $builder->groupStart()
                ->like('name', $search)
                ->orLike('item_number', $search)
                ->orLike('category', $search)
                ->orLike('description', $search)
                ->groupEnd();
        }

        $items = $builder
            ->orderBy('name', 'ASC')
            ->limit($pagination['limit'], $pagination['offset'])
            ->get()
            ->getResultArray();

        $countBuilder = $this->db->table('items')->where('deleted', 0);
        if ($search !== '') {
            $countBuilder->groupStart()
                ->like('name', $search)
                ->orLike('item_number', $search)
                ->orLike('category', $search)
                ->orLike('description', $search)
                ->groupEnd();
        }

        $total = $countBuilder->countAllResults();

        return $this->respondSuccess([
            'items' => $items,
            'pagination' => [
                'limit' => $pagination['limit'],
                'offset' => $pagination['offset'],
                'total' => $total
            ]
        ]);
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $item = $this->item->get_info($id);
        if ((int)$item->item_id < 1 || (int)$item->deleted === DELETED) {
            return $this->respondError('Item not found.', 404);
        }

        return $this->respondSuccess((array)$item);
    }

    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $input = $this->getRequestData();
        $itemData = $this->buildItemData($input);

        if ($itemData['name'] === '') {
            return $this->respondError('Item name is required.', 422);
        }

        if (!$this->item->save_value($itemData, NEW_ENTRY)) {
            return $this->respondError('Failed to create item.', 500);
        }

        return $this->respondSuccess((array)$this->item->get_info((int)$itemData['item_id']), 'Item created.', 201);
    }

    public function update(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $item = $this->item->get_info($id);
        if ((int)$item->item_id < 1 || (int)$item->deleted === DELETED) {
            return $this->respondError('Item not found.', 404);
        }

        $existing = (array)$item;
        $itemData = $this->buildItemData($this->getRequestData(), $existing);

        if ($itemData['name'] === '') {
            return $this->respondError('Item name is required.', 422);
        }

        if (!$this->item->save_value($itemData, $id)) {
            return $this->respondError('Failed to update item.', 500);
        }

        return $this->respondSuccess((array)$this->item->get_info($id), 'Item updated.');
    }

    public function delete(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $item = $this->item->get_info($id);
        if ((int)$item->item_id < 1 || (int)$item->deleted === DELETED) {
            return $this->respondError('Item not found.', 404);
        }

        if (!$this->item->delete($id)) {
            return $this->respondError('Failed to delete item.', 500);
        }

        return $this->respondSuccess(null, 'Item deleted.');
    }

    private function buildItemData(array $input, array $existing = []): array
    {
        $data = [
            'name' => $this->stringValue($input, 'name', $existing, ''),
            'category' => $this->stringValue($input, 'category', $existing, ''),
            'supplier_id' => $this->nullableIntValue($input, 'supplier_id', $existing),
            'item_number' => $this->nullableStringValue($input, 'item_number', $existing),
            'description' => $this->nullableStringValue($input, 'description', $existing),
            'cost_price' => $this->floatValue($input, 'cost_price', $existing, 0),
            'unit_price' => $this->floatValue($input, 'unit_price', $existing, 0),
            'reorder_level' => $this->floatValue($input, 'reorder_level', $existing, 0),
            'allow_alt_description' => $this->boolIntValue($input, 'allow_alt_description', $existing, 0),
            'is_serialized' => $this->boolIntValue($input, 'is_serialized', $existing, 0),
            'deleted' => isset($existing['deleted']) ? (int)$existing['deleted'] : 0,
            'stock_type' => $this->intValue($input, 'stock_type', $existing, HAS_STOCK),
            'item_type' => $this->intValue($input, 'item_type', $existing, ITEM),
            'tax_category_id' => $this->nullableIntValue($input, 'tax_category_id', $existing),
            'receiving_quantity' => $this->floatValue($input, 'receiving_quantity', $existing, 1),
            'pic_filename' => $this->nullableStringValue($input, 'pic_filename', $existing),
            'qty_per_pack' => $this->floatValue($input, 'qty_per_pack', $existing, 1),
            'pack_name' => $this->nullableStringValue($input, 'pack_name', $existing),
            'low_sell_item_id' => $this->nullableIntValue($input, 'low_sell_item_id', $existing),
            'hsn_code' => $this->nullableStringValue($input, 'hsn_code', $existing)
        ];

        if ($data['item_type'] === ITEM_TEMP) {
            $data['stock_type'] = HAS_NO_STOCK;
            $data['receiving_quantity'] = 0;
            $data['reorder_level'] = 0;
        }

        if (isset($existing['item_id'])) {
            $data['item_id'] = (int)$existing['item_id'];
        }

        return $data;
    }

    private function stringValue(array $input, string $key, array $existing, string $default = ''): string
    {
        if (array_key_exists($key, $input)) {
            return trim((string)$input[$key]);
        }

        return isset($existing[$key]) ? trim((string)$existing[$key]) : $default;
    }

    private function nullableStringValue(array $input, string $key, array $existing): ?string
    {
        if (array_key_exists($key, $input)) {
            $value = trim((string)$input[$key]);
            return $value === '' ? null : $value;
        }

        if (!array_key_exists($key, $existing)) {
            return null;
        }

        $value = $existing[$key];
        return $value === '' ? null : $value;
    }

    private function intValue(array $input, string $key, array $existing, int $default = 0): int
    {
        if (array_key_exists($key, $input) && $input[$key] !== '' && $input[$key] !== null) {
            return (int)$input[$key];
        }

        return isset($existing[$key]) && $existing[$key] !== null ? (int)$existing[$key] : $default;
    }

    private function nullableIntValue(array $input, string $key, array $existing): ?int
    {
        if (array_key_exists($key, $input)) {
            if ($input[$key] === '' || $input[$key] === null) {
                return null;
            }

            return (int)$input[$key];
        }

        return isset($existing[$key]) && $existing[$key] !== null ? (int)$existing[$key] : null;
    }

    private function floatValue(array $input, string $key, array $existing, float $default = 0): float
    {
        if (array_key_exists($key, $input) && $input[$key] !== '' && $input[$key] !== null) {
            return (float)$input[$key];
        }

        return isset($existing[$key]) && $existing[$key] !== null ? (float)$existing[$key] : $default;
    }

    private function boolIntValue(array $input, string $key, array $existing, int $default = 0): int
    {
        if (array_key_exists($key, $input)) {
            return filter_var($input[$key], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }

        return isset($existing[$key]) ? (int)$existing[$key] : $default;
    }

    /**
     * POST /api/items/bulk — batched upsert by item_number.
     *
     * Body:
     *   { dry_run?, skip_on_error?, rows: [
     *       { item_number, name, unit_price, cost_price,
     *         tax_percent?, quantity?, description?, supplier_id?, category? }
     *   ] }
     *
     * Idempotency: existing item_number → UPDATE; new item_number → INSERT.
     * Missing required fields fail the row with a clear message.
     */
    public function bulkImport(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) return $authResponse;

        $body = $this->request->getJSON(true) ?? [];
        $employeeId = (int)($this->employee->get_logged_in_employee_info()->person_id ?? 0);

        $itemModel = $this->item;

        $handler = function (array $row, int $idx, $db) use ($itemModel) {
            $dryRun = !empty($row['__dry_run']);
            $itemNumber = trim((string)($row['item_number'] ?? $row['barcode'] ?? ''));
            $name = trim((string)($row['name'] ?? ''));
            if ($name === '') {
                return ['status' => 'failed', 'key' => $itemNumber, 'message' => 'name is required'];
            }
            if (!isset($row['unit_price']) || !is_numeric($row['unit_price'])) {
                return ['status' => 'failed', 'key' => $itemNumber, 'message' => 'unit_price must be numeric'];
            }
            if (!isset($row['cost_price']) || !is_numeric($row['cost_price'])) {
                return ['status' => 'failed', 'key' => $itemNumber, 'message' => 'cost_price must be numeric'];
            }

            $existingId = null;
            if ($itemNumber !== '') {
                $existing = $db->table('items')
                    ->where('item_number', $itemNumber)
                    ->where('deleted', 0)
                    ->get()->getRowArray();
                if ($existing !== null) $existingId = (int)$existing['item_id'];
            }

            $data = [
                'name'         => mb_substr($name, 0, 255),
                'item_number'  => $itemNumber !== '' ? mb_substr($itemNumber, 0, 50) : null,
                'description'  => mb_substr((string)($row['description'] ?? ''), 0, 4096),
                'category'     => mb_substr((string)($row['category'] ?? ''), 0, 255),
                'unit_price'   => number_format((float)$row['unit_price'], 2, '.', ''),
                'cost_price'   => number_format((float)$row['cost_price'], 2, '.', ''),
                'tax_percent'  => isset($row['tax_percent']) ? (float)$row['tax_percent'] : 0,
                'supplier_id'  => isset($row['supplier_id']) ? (int)$row['supplier_id'] : null,
                'deleted'      => 0,
            ];

            if ($dryRun) {
                return ['status' => $existingId !== null ? 'imported' : 'imported', 'key' => $itemNumber ?: $name, 'reason' => $existingId !== null ? 'would update' : 'would insert'];
            }

            $action = $existingId !== null ? 'update' : 'insert';
            if ($action === 'update') {
                $data['item_id'] = $existingId;
                $db->table('items')->where('item_id', $existingId)->update($data);
                $savedId = $existingId;
            } else {
                $db->table('items')->insert($data);
                $savedId = (int)$db->insertID();
            }

            // Optional stock seed at default location 1.
            if (isset($row['quantity']) && is_numeric($row['quantity']) && $db->tableExists('item_quantities')) {
                $qty = (float)$row['quantity'];
                $loc = (int)($row['location_id'] ?? 1);
                $existingQ = $db->table('item_quantities')
                    ->where('item_id', $savedId)->where('location_id', $loc)
                    ->get()->getRowArray();
                if ($existingQ === null) {
                    $db->table('item_quantities')->insert([
                        'item_id' => $savedId, 'location_id' => $loc,
                        'quantity' => number_format($qty, 3, '.', ''),
                    ]);
                } else {
                    $db->table('item_quantities')
                        ->where('item_id', $savedId)->where('location_id', $loc)
                        ->update(['quantity' => number_format($qty, 3, '.', '')]);
                }
            }

            return ['status' => 'imported', 'key' => $itemNumber ?: (string)$savedId, 'reason' => $action];
        };

        $result = BulkImportLib::run(
            $this->db, 'items', $body, $employeeId,
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
