<?php

namespace App\Controllers\Api;

use App\Models\Customer;
use App\Models\Item;
use App\Models\Sale;
use App\Models\Ticket;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Psr\Log\LoggerInterface;
use Throwable;

class SalesController extends BaseApiController
{
    protected Sale $sale;
    protected Item $item;
    protected Customer $customer;

    public function initController(RequestInterface $request, ResponseInterface $response, LoggerInterface $logger)
    {
        parent::initController($request, $response, $logger);

        $this->sale     = model(Sale::class);
        $this->item     = model(Item::class);
        $this->customer = model(Customer::class);
    }

    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $pagination     = $this->getPagination();
        $search         = trim((string) ($this->request->getGet('search') ?? ''));
        $searchTerm     = $search === '' ? null : $search;
        $isValidReceipt = $this->sale->isValidReceipt($searchTerm);

        $filters = [
            'sale_type'          => 'all',
            'location_id'        => 'all',
            'start_date'         => date('Y-m-d', strtotime('-30 days')),
            'end_date'           => date('Y-m-d'),
            'only_cash'          => false,
            'only_due'           => false,
            'only_check'         => false,
            'selected_customer'  => false,
            'only_creditcard'    => false,
            'only_debit'         => false,
            'only_bank_transfer' => false,
            'only_wallet'        => false,
            'only_invoices'      => false,
            'is_valid_receipt'   => $isValidReceipt,
        ];

        $sales = $this->sale->search($searchTerm, $filters, $pagination['limit'], $pagination['offset'], 'sales.sale_time', 'desc');
        $total = $this->sale->get_found_rows($searchTerm, $filters);

        return $this->respondSuccess([
            'sales'      => $sales->getResultArray(),
            'pagination' => [
                'limit'  => $pagination['limit'],
                'offset' => $pagination['offset'],
                'total'  => $total,
            ],
        ]);
    }

    public function show(int $id): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        if (! $this->sale->exists($id)) {
            return $this->respondError('Sale not found.', 404);
        }

        $sale = $this->sale->get_info($id)->getRowArray();

        return $this->respondSuccess([
            'sale'     => $sale,
            'items'    => $this->sale->get_sale_items_ordered($id)->getResultArray(),
            'payments' => $this->sale->get_sale_payments($id)->getResultArray(),
            'taxes'    => $this->sale->get_sales_taxes($id),
        ]);
    }

    /**
     * POST /api/sales — create a completed sale from a JSON cart.
     *
     * Body (all monetary fields are decimal strings or numbers):
     * {
     *   "customer_id": 5 | null,          // null = walk-in
     *   "comment": "optional comment",
     *   "dinner_table_id": null,
     *   "items": [
     *     {
     *       "item_id": 6,                  // required
     *       "quantity": 2,                 // default 1
     *       "price": "25.00",              // optional override, defaults to items.unit_price
     *       "discount": 0,                 // default 0
     *       "discount_type": 1,            // 1 = percentage, 0 = flat
     *       "description": "",
     *       "serialnumber": "",
     *       "ticket_session_id": 1,        // optional, for ITEM_TICKET
     *       "ticket_tier_id": 2,           // optional, for ITEM_TICKET
     *       "seat_assignment": {"row":"A","seat":"12"}
     *     }
     *   ],
     *   "payments": [
     *     {
     *       "payment_type": "Cash",
     *       "payment_amount": "50.00",
     *       "cash_refund": "0.00",
     *       "cash_adjustment": "0.00"
     *     }
     *   ]
     * }
     *
     * Response includes the created sale_id, total, and any ticket
     * instances minted for ITEM_TICKET lines (with redemption URLs).
     */
    public function create(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        $body     = $this->request->getJSON(true) ?? [];
        $items    = is_array($body['items'] ?? null) ? $body['items'] : [];
        $payments = is_array($body['payments'] ?? null) ? $body['payments'] : [];

        if ($items === []) {
            return $this->respondError('items[] is required (at least one line).', 422);
        }
        if (count($items) > 200) {
            return $this->respondError('Too many items per sale (max 200).', 422);
        }
        if ($payments === []) {
            return $this->respondError('payments[] is required (at least one payment).', 422);
        }

        $customerId = isset($body['customer_id']) && (int) $body['customer_id'] > 0 ? (int) $body['customer_id'] : 0;
        $employeeId = (int) ($this->session->get('person_id') ?? 0);
        if ($employeeId <= 0) {
            return $this->respondError('Employee not identified.', 401);
        }

        $comment       = mb_substr(trim((string) ($body['comment'] ?? '')), 0, 1024);
        $dinnerTableId = isset($body['dinner_table_id']) && $body['dinner_table_id'] !== null ? (int) $body['dinner_table_id'] : null;

        // Resolve location: use the first attached location for the employee
        // (legacy convention), or 1 as a defensive default.
        $locationId = $this->resolveLocationId($employeeId);

        // Build normalised items array in Sale::save_value shape. Server-side
        // price resolution prevents client-tampered prices for items the
        // operator doesn't have explicit override permission on.
        $normalisedItems = [];
        $line            = 1;

        foreach ($items as $raw) {
            if (! is_array($raw) || (int) ($raw['item_id'] ?? 0) <= 0) {
                return $this->respondError("Line {$line}: item_id is required.", 422);
            }
            $itemId = (int) $raw['item_id'];
            $info   = $this->item->get_info($itemId);
            if ((int) $info->item_id < 1 || (int) ($info->deleted ?? 0) === 1) {
                return $this->respondError("Line {$line}: item {$itemId} not found.", 422);
            }
            $quantity = (float) ($raw['quantity'] ?? 1);
            if ($quantity <= 0) {
                return $this->respondError("Line {$line}: quantity must be > 0.", 422);
            }

            // Price override is accepted (POS overrides exist) but defaults
            // to the item's stored unit_price so a missing 'price' field
            // can't accidentally zero out a line.
            $price = isset($raw['price']) && $raw['price'] !== ''
                ? $this->parseMoney($raw['price'])
                : (float) ($info->unit_price ?? 0);
            if ($price === null) {
                return $this->respondError("Line {$line}: price is invalid.", 422);
            }

            $normalisedItems[] = [
                'item_id'       => $itemId,
                'line'          => $line,
                'description'   => (string) ($raw['description'] ?? ''),
                'serialnumber'  => (string) ($raw['serialnumber'] ?? ''),
                'quantity'      => $quantity,
                'discount'      => (float) ($raw['discount'] ?? 0),
                'discount_type' => (int) ($raw['discount_type'] ?? 1),
                'cost_price'    => (float) ($info->cost_price ?? 0),
                'price'         => (float) $price,
                'item_location' => $locationId,
                'print_option'  => 0,
                // Phase 2 extras for ticket-product issuance:
                'ticket_session_id' => isset($raw['ticket_session_id']) && $raw['ticket_session_id'] !== null && $raw['ticket_session_id'] !== '' ? (int) $raw['ticket_session_id'] : null,
                'ticket_tier_id'    => isset($raw['ticket_tier_id']) && $raw['ticket_tier_id'] !== null && $raw['ticket_tier_id'] !== '' ? (int) $raw['ticket_tier_id'] : null,
                'seat_assignment'   => is_array($raw['seat_assignment'] ?? null) ? $raw['seat_assignment'] : null,
            ];
            $line++;
        }

        // Normalise payments — every row needs payment_type + payment_amount.
        $normalisedPayments = [];

        foreach ($payments as $idx => $p) {
            if (! is_array($p)) {
                return $this->respondError("Payment {$idx}: must be an object.", 422);
            }
            $type   = trim((string) ($p['payment_type'] ?? ''));
            $amount = $this->parseMoney($p['payment_amount'] ?? null);
            if ($type === '' || $amount === null) {
                return $this->respondError("Payment {$idx}: payment_type + payment_amount are required.", 422);
            }
            $normalisedPayments[] = [
                'payment_type'    => mb_substr($type, 0, 40),
                'payment_amount'  => (float) $amount,
                'cash_refund'     => (float) ($this->parseMoney($p['cash_refund'] ?? '0') ?? 0),
                'cash_adjustment' => (int) (bool) ($p['cash_adjustment'] ?? 0),
            ];
        }

        // Sale::save_value mutates these by reference.
        $sale_status = COMPLETED;
        $sales_taxes = [[], []];

        try {
            $newSaleId = $this->sale->save_value(
                NEW_ENTRY,
                $sale_status,
                $normalisedItems,
                $customerId,
                $employeeId,
                $comment,
                // invoice_number
                null,
                // work_order_number
                null,
                // quote_number
                null,
                SALE_TYPE_POS,
                $normalisedPayments,
                $dinnerTableId,
                $sales_taxes,
            );

            if ((int) $newSaleId <= 0) {
                return $this->respondError('Sale could not be saved (transaction rolled back). Check stock and ticket capacities.', 409);
            }

            // Pull issued tickets (if any) so the POS receipt can render
            // QRs / send wallet-add links.
            $issuedTickets = $this->fetchIssuedTickets((int) $newSaleId);

            // Compute total + the canonical sale record.
            $saleRow      = $this->sale->get_info((int) $newSaleId)->getRowArray() ?? [];
            $paymentsRows = $this->sale->get_sale_payments((int) $newSaleId)->getResultArray();
            $totalPaid    = 0.0;

            foreach ($paymentsRows as $pay) {
                $totalPaid += (float) ($pay['payment_amount'] ?? 0) - (float) ($pay['cash_refund'] ?? 0);
            }

            return $this->respondSuccess([
                'sale_id'    => (int) $newSaleId,
                'sale'       => $saleRow,
                'total_paid' => round($totalPaid, 2),
                'items'      => $this->sale->get_sale_items_ordered((int) $newSaleId)->getResultArray(),
                'payments'   => $paymentsRows,
                'tickets'    => $issuedTickets,
            ], 'Sale created.', 201);
        } catch (Throwable $e) {
            log_message('error', 'SalesController::create — ' . $e->getMessage());

            return $this->respondError('Failed to create sale: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Hydrate any tickets minted for this sale into a client-friendly
     * shape (with redemption URLs). Empty when the sale had no
     * ITEM_TICKET lines.
     */
    private function fetchIssuedTickets(int $saleId): array
    {
        if (! $this->db->tableExists('tickets')) {
            return [];
        }

        try {
            $ticketModel = model(Ticket::class);
            $rows        = $ticketModel->get_for_sale($saleId)->getResultArray();
            $qr          = service('qr_lib');

            return array_map(static function (array $row) use ($qr): array {
                $code = (string) ($row['code'] ?? '');

                return [
                    'ticket_id'      => (int) $row['ticket_id'],
                    'code'           => $code,
                    'status'         => (string) ($row['status'] ?? ''),
                    'valid_from'     => $row['valid_from'] ?? null,
                    'valid_to'       => $row['valid_to'] ?? null,
                    'product_title'  => $row['product_title'] ?? null,
                    'subtype'        => $row['subtype'] ?? null,
                    'notice'         => $row['notice'] ?? null,
                    'redemption_url' => $code !== '' ? $qr->build_redemption_url($code) : null,
                ];
            }, $rows);
        } catch (Throwable $e) {
            log_message('error', 'SalesController::fetchIssuedTickets — ' . $e->getMessage());

            return [];
        }
    }

    private function resolveLocationId(int $employeeId): int
    {
        try {
            if ($this->db->tableExists('stock_locations')) {
                $row = $this->db->table('stock_locations')
                    ->select('location_id')
                    ->where('deleted', 0)
                    ->orderBy('location_id', 'ASC')
                    ->limit(1)
                    ->get()
                    ->getRowArray();
                if ($row !== null) {
                    return (int) $row['location_id'];
                }
            }
        } catch (Throwable $e) {
            log_message('warning', 'SalesController::resolveLocationId — ' . $e->getMessage());
        }

        return 1;
    }

    private function parseMoney(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = is_string($v) ? trim($v) : (string) $v;
        $s = str_replace([' ', ','], ['', '.'], $s);
        if (! preg_match('/^-?\d+(\.\d{1,2})?$/', $s)) {
            return null;
        }

        return bcadd($s, '0', 2);
    }
}
