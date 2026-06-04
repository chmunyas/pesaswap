<?php

namespace App\Controllers\Api;

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
}
