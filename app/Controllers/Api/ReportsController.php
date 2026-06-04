<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

class ReportsController extends BaseApiController
{
    public function summary(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $startDate = trim((string) ($this->request->getGet('start_date') ?? ''));
        $endDate = trim((string) ($this->request->getGet('end_date') ?? ''));

        if ($startDate === '' || $endDate === '') {
            return $this->respondError('start_date and end_date are required.', 422);
        }

        if (strtotime($startDate) === false || strtotime($endDate) === false) {
            return $this->respondError('Invalid date range.', 422);
        }

        if (strtotime($startDate) > strtotime($endDate)) {
            return $this->respondError('start_date must be before or equal to end_date.', 422);
        }

        try {
            if (!$this->db->tableExists('sales')) {
                return $this->respondSuccess([
                    'summary' => [],
                    'filters' => [
                        'start_date' => $startDate,
                        'end_date' => $endDate
                    ]
                ], 'Sales table is not available.');
            }

            $salesTable = $this->db->prefixTable('sales');
            if ($this->db->tableExists('sales_payments')) {
                $salesPaymentsTable = $this->db->prefixTable('sales_payments');
                $sql = "
                    SELECT
                        DATE(sales.sale_time) AS sale_date,
                        COUNT(DISTINCT sales.sale_id) AS sales_count,
                        COALESCE(SUM(sales_payments.payment_amount), 0) AS total_amount
                    FROM {$salesTable} AS sales
                    LEFT JOIN {$salesPaymentsTable} AS sales_payments ON sales_payments.sale_id = sales.sale_id
                    WHERE DATE(sales.sale_time) BETWEEN ? AND ?
                    GROUP BY DATE(sales.sale_time)
                    ORDER BY DATE(sales.sale_time) ASC
                ";
                $summary = $this->db->query($sql, [$startDate, $endDate])->getResultArray();
            } else {
                $sql = "
                    SELECT
                        DATE(sales.sale_time) AS sale_date,
                        COUNT(DISTINCT sales.sale_id) AS sales_count,
                        0 AS total_amount
                    FROM {$salesTable} AS sales
                    WHERE DATE(sales.sale_time) BETWEEN ? AND ?
                    GROUP BY DATE(sales.sale_time)
                    ORDER BY DATE(sales.sale_time) ASC
                ";
                $summary = $this->db->query($sql, [$startDate, $endDate])->getResultArray();
            }

            return $this->respondSuccess([
                'summary' => $summary,
                'filters' => [
                    'start_date' => $startDate,
                    'end_date' => $endDate
                ]
            ]);
        } catch (Throwable $e) {
            return $this->respondError('Failed to load report summary.', 500);
        }
    }
}
