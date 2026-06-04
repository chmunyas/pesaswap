<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;

class AiController extends BaseApiController
{
    public function chat(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $input = $this->getRequestData();
        $message = trim((string)($input['message'] ?? ''));

        if ($message === '') {
            return $this->respondError('Message is required.', 422);
        }

        $messageLower = strtolower($message);
        $responses = [];
        $insights = [];
        $today = date('Y-m-d');

        if (str_contains($messageLower, 'sales') || str_contains($messageLower, 'revenue')) {
            $salesCount = $this->db->table('sales')
                ->where('sale_status', COMPLETED)
                ->where('DATE(sale_time) = ' . $this->db->escape($today), null, false)
                ->countAllResults();

            $revenue = $this->db->table('sales_payments')
                ->select('COALESCE(SUM(payment_amount - cash_refund), 0) AS revenue', false)
                ->join('sales', 'sales.sale_id = sales_payments.sale_id', 'inner')
                ->where('sales.sale_status', COMPLETED)
                ->where('DATE(sales.sale_time) = ' . $this->db->escape($today), null, false)
                ->get()
                ->getRowArray();

            $responses[] = 'Today\'s sales: ' . $salesCount . ' completed transactions with revenue of ' . ($revenue['revenue'] ?? 0) . '.';
            $insights['sales'] = [
                'date' => $today,
                'sales_count' => (int)$salesCount,
                'revenue' => (float)($revenue['revenue'] ?? 0)
            ];
        }

        if (str_contains($messageLower, 'top items')) {
            $topItems = $this->db->table('sales_items')
                ->select('items.name, SUM(sales_items.quantity_purchased) AS quantity_sold', false)
                ->join('sales', 'sales.sale_id = sales_items.sale_id', 'inner')
                ->join('items', 'items.item_id = sales_items.item_id', 'inner')
                ->where('sales.sale_status', COMPLETED)
                ->where('DATE(sales.sale_time) = ' . $this->db->escape($today), null, false)
                ->groupBy('sales_items.item_id, items.name')
                ->orderBy('quantity_sold', 'DESC')
                ->limit(5)
                ->get()
                ->getResultArray();

            if ($topItems === []) {
                $responses[] = 'No top items are available for today yet.';
            } else {
                $itemSummary = array_map(static fn(array $item): string => $item['name'] . ' (' . $item['quantity_sold'] . ')', $topItems);
                $responses[] = 'Top items today: ' . implode(', ', $itemSummary) . '.';
            }

            $insights['top_items'] = $topItems;
        }

        if (str_contains($messageLower, 'inventory') || str_contains($messageLower, 'low stock')) {
            $lowStockItems = $this->db->table('items')
                ->select('items.item_id, items.name, items.reorder_level, item_quantities.quantity, stock_locations.location_name')
                ->join('item_quantities', 'item_quantities.item_id = items.item_id', 'inner')
                ->join('stock_locations', 'stock_locations.location_id = item_quantities.location_id', 'inner')
                ->where('items.deleted', 0)
                ->where('items.stock_type', HAS_STOCK)
                ->where('stock_locations.deleted', 0)
                ->where('item_quantities.quantity <= items.reorder_level')
                ->orderBy('item_quantities.quantity', 'ASC')
                ->limit(10)
                ->get()
                ->getResultArray();

            if ($lowStockItems === []) {
                $responses[] = 'No low stock items were found.';
            } else {
                $responses[] = 'Low stock items found: ' . count($lowStockItems) . ' items need attention.';
            }

            $insights['low_stock'] = $lowStockItems;
        }

        if ($responses === []) {
            $responses[] = 'Try asking about sales, revenue, top items, inventory, or low stock.';
        }

        return $this->respondSuccess([
            'response' => implode(' ', $responses),
            'insights' => $insights
        ]);
    }
}
