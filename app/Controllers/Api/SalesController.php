<?php

namespace App\Controllers\Api;

use App\Models\Sale;
use CodeIgniter\HTTP\ResponseInterface;

class SalesController extends BaseApiController
{
    protected Sale $sale;

    public function initController(\CodeIgniter\HTTP\RequestInterface $request, \CodeIgniter\HTTP\ResponseInterface $response, \Psr\Log\LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->sale = model(Sale::class);
    }

    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination = $this->getPagination();
        $search = trim((string)($this->request->getGet('search') ?? ''));
        $searchTerm = $search === '' ? null : $search;
        $isValidReceipt = $this->sale->isValidReceipt($searchTerm);

        $filters = [
            'sale_type' => 'all',
            'location_id' => 'all',
            'start_date' => date('Y-m-d', strtotime('-30 days')),
            'end_date' => date('Y-m-d'),
            'only_cash' => false,
            'only_due' => false,
            'only_check' => false,
            'selected_customer' => false,
            'only_creditcard' => false,
            'only_debit' => false,
            'only_bank_transfer' => false,
            'only_wallet' => false,
            'only_invoices' => false,
            'is_valid_receipt' => $isValidReceipt
        ];

        $sales = $this->sale->search($searchTerm, $filters, $pagination['limit'], $pagination['offset'], 'sales.sale_time', 'desc');
        $total = $this->sale->get_found_rows($searchTerm, $filters);

        return $this->respondSuccess([
            'sales' => $sales->getResultArray(),
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

        if (!$this->sale->exists($id)) {
            return $this->respondError('Sale not found.', 404);
        }

        $sale = $this->sale->get_info($id)->getRowArray();

        return $this->respondSuccess([
            'sale' => $sale,
            'items' => $this->sale->get_sale_items_ordered($id)->getResultArray(),
            'payments' => $this->sale->get_sale_payments($id)->getResultArray(),
            'taxes' => $this->sale->get_sales_taxes($id)
        ]);
    }
}
