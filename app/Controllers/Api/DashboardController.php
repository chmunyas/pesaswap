<?php

namespace App\Controllers\Api;

use App\Models\Item;
use App\Models\Sale;
use CodeIgniter\HTTP\ResponseInterface;

class DashboardController extends BaseApiController
{
    protected Sale $sale;
    protected Item $item;

    public function initController(\CodeIgniter\HTTP\RequestInterface $request, \CodeIgniter\HTTP\ResponseInterface $response, \Psr\Log\LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->sale = model(Sale::class);
        $this->item = model(Item::class);
    }

    public function stats(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $today = date('Y-m-d');
            $completedStatus = 0; // COMPLETED constant value

            $salesCount = $this->db->table('sales')
                ->where('sale_status', $completedStatus)
                ->where("DATE(sale_time) = '{$today}'", null, false)
                ->countAllResults();

            $revenueResult = $this->db->query(
                "SELECT COALESCE(SUM(sp.payment_amount - sp.cash_refund), 0) AS revenue
                 FROM {$this->db->prefixTable('sales_payments')} sp
                 INNER JOIN {$this->db->prefixTable('sales')} s ON s.sale_id = sp.sale_id
                 WHERE s.sale_status = ? AND DATE(s.sale_time) = ?",
                [$completedStatus, $today]
            );
            $revenue = (float)($revenueResult->getRowArray()['revenue'] ?? 0);

            $itemsResult = $this->db->query(
                "SELECT COALESCE(SUM(si.quantity_purchased), 0) AS items_sold
                 FROM {$this->db->prefixTable('sales_items')} si
                 INNER JOIN {$this->db->prefixTable('sales')} s ON s.sale_id = si.sale_id
                 WHERE s.sale_status = ? AND DATE(s.sale_time) = ?",
                [$completedStatus, $today]
            );
            $itemsSold = (int)($itemsResult->getRowArray()['items_sold'] ?? 0);

            $topItemsResult = $this->db->query(
                "SELECT i.name, SUM(si.quantity_purchased) AS quantity_sold
                 FROM {$this->db->prefixTable('sales_items')} si
                 INNER JOIN {$this->db->prefixTable('sales')} s ON s.sale_id = si.sale_id
                 INNER JOIN {$this->db->prefixTable('items')} i ON i.item_id = si.item_id
                 WHERE s.sale_status = ? AND DATE(s.sale_time) = ?
                 GROUP BY si.item_id, i.name
                 ORDER BY quantity_sold DESC
                 LIMIT 5",
                [$completedStatus, $today]
            );
            $topItems = $topItemsResult->getResultArray();

            $totalCustomers = $this->db->table('customers')
                ->where('deleted', 0)
                ->countAllResults();

            return $this->respondSuccess([
                'today_sales' => (int)$salesCount,
                'today_revenue' => $revenue,
                'today_items_sold' => $itemsSold,
                'total_customers' => (int)$totalCustomers,
                'top_items' => array_map(fn($item) => [
                    'name' => $item['name'],
                    'quantity' => (int)$item['quantity_sold'],
                ], $topItems),
                'recent_sales' => [],
                'revenue_trend' => [],
            ]);
        } catch (\Throwable $e) {
            return $this->respondError('Dashboard error: ' . $e->getMessage(), 500);
        }
    }
}
