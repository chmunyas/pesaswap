<?php

namespace App\Controllers;

use App\Models\Ticket;
use App\Models\Ticket_product;
use CodeIgniter\HTTP\ResponseInterface;
use Config\OSPOS;

/**
 * Tickets office module.
 *
 * Modelled on App\Controllers\Giftcards. The CRUD methods follow the
 * improved auto-routing convention so /tickets/save/5, /tickets/view/5,
 * /tickets/search etc. route to the postSave / getView / getSearch methods
 * automatically (see app/Config/Feature.php:$autoRoutesImproved).
 */
class Tickets extends Secure_Controller
{
    protected $helpers = ['tickets'];
    private Ticket_product $ticket_product;
    private Ticket $ticket;

    public function __construct()
    {
        parent::__construct('tickets');

        $this->ticket_product = model(Ticket_product::class);
        $this->ticket         = model(Ticket::class);
    }

    public function getIndex(): string
    {
        helper('tickets');
        $data['table_headers'] = get_tickets_manage_table_headers();

        return view('tickets/manage', $data);
    }

    public function getSearch(): ResponseInterface
    {
        helper('tickets');

        $search = $this->request->getGet('search');
        $limit  = $this->request->getGet('limit', FILTER_SANITIZE_NUMBER_INT);
        $offset = $this->request->getGet('offset', FILTER_SANITIZE_NUMBER_INT);
        $sort   = $this->sanitizeSortColumn(ticket_headers(), $this->request->getGet('sort', FILTER_SANITIZE_FULL_SPECIAL_CHARS), 'title');
        $order  = $this->request->getGet('order', FILTER_SANITIZE_FULL_SPECIAL_CHARS);

        $result      = $this->ticket_product->search((string) $search, (int) $limit, (int) $offset, (string) $sort, (string) $order);
        $total_rows  = $this->ticket_product->get_found_rows((string) $search);

        $data_rows = [];
        foreach ($result->getResult() as $product) {
            $data_rows[] = get_ticket_product_data_row($product);
        }

        return $this->response->setJSON(['total' => $total_rows, 'rows' => $data_rows]);
    }

    public function getSuggest(): ResponseInterface
    {
        $search = $this->request->getGet('term');

        return $this->response->setJSON($this->ticket_product->get_search_suggestions((string) $search));
    }

    public function suggest_search(): ResponseInterface
    {
        $search = $this->request->getPost('term');

        return $this->response->setJSON($this->ticket_product->get_search_suggestions((string) $search));
    }

    public function getRow(int $row_id): ResponseInterface
    {
        helper('tickets');

        return $this->response->setJSON(get_ticket_product_data_row($this->ticket_product->get_info($row_id)));
    }

    public function getView(int $ticket_product_id = NEW_ENTRY): string
    {
        $config  = config(OSPOS::class)->settings;
        $info    = $this->ticket_product->get_full_info($ticket_product_id);

        $data['ticket_product_id'] = $ticket_product_id;
        $data['info']              = $info;
        $data['subtypes']          = Ticket_product::SUBTYPES;
        $data['code_types']        = ['text', 'barcode', 'qrcode', 'only_qrcode', 'only_barcode'];
        $data['locations']         = model(\App\Models\Stock_location::class)->get_all()->getResult();
        $data['default_color']     = $config['ticket_default_color'] ?? 'Color010';

        return view('tickets/form', $data);
    }

    public function postSave(int $ticket_product_id = NEW_ENTRY): ResponseInterface
    {
        $post = $this->request->getPost();

        $subtype     = $post['subtype'] ?? 'meeting';
        $locationIds = isset($post['location_ids']) && is_array($post['location_ids'])
            ? array_map('intval', $post['location_ids'])
            : [];

        $parent = [
            'item_id'              => (int) ($post['item_id'] ?? 0),
            'subtype'              => $subtype,
            'code_type'            => $post['code_type'] ?? 'qrcode',
            'validity_mode'        => $post['validity_mode'] ?? 'fixed',
            'begin_ts'             => $this->emptyToNull($post['begin_ts'] ?? null),
            'end_ts'               => $this->emptyToNull($post['end_ts'] ?? null),
            'fixed_begin_term_days'=> $this->emptyToNull($post['fixed_begin_term_days'] ?? null),
            'fixed_term_days'      => $this->emptyToNull($post['fixed_term_days'] ?? null),
            'quantity'             => $this->emptyToNull($post['quantity'] ?? null),
            'max_per_customer'     => $this->emptyToNull($post['max_per_customer'] ?? null),
            'sale_window_from'     => $this->emptyToNull($post['sale_window_from'] ?? null),
            'sale_window_to'       => $this->emptyToNull($post['sale_window_to'] ?? null),
            'bind_customer'        => !empty($post['bind_customer']) ? 1 : 0,
            'transferable'         => !empty($post['transferable'])  ? 1 : 0,
            'single_use'           => !empty($post['single_use'])    ? 1 : 0,
            'max_redemptions'      => (int) ($post['max_redemptions'] ?? 1),
            'refundable'           => !empty($post['refundable']) ? 1 : 0,
            'refund_window_hours'  => $this->emptyToNull($post['refund_window_hours'] ?? null),
            'title'                => trim((string) ($post['title'] ?? '')),
            'brand_name'           => $post['brand_name'] ?? null,
            'color'                => $post['color'] ?? null,
            'notice'               => $post['notice'] ?? null,
            'description'          => $post['description'] ?? null,
            'service_phone'        => $post['service_phone'] ?? null,
            'source'               => $post['source'] ?? null,
            'custom_url'           => $post['custom_url'] ?? null,
            'custom_url_name'      => $post['custom_url_name'] ?? null,
            'custom_url_sub_title' => $post['custom_url_sub_title'] ?? null,
            'logo_url'             => $post['logo_url'] ?? null,
            'signing_key_id'       => $this->resolveActiveSigningKeyId(),
        ];

        if ($parent['title'] === '') {
            return $this->response->setJSON([
                'success' => false,
                'message' => lang('Tickets.title_required'),
                'id'      => NEW_ENTRY,
            ]);
        }

        $subtypeData = $this->extractSubtypePayload($subtype, $post);

        if ($this->ticket_product->save_value($parent, $subtypeData, $locationIds, $ticket_product_id)) {
            $isNew = $ticket_product_id === NEW_ENTRY;

            return $this->response->setJSON([
                'success' => true,
                'message' => ($isNew ? lang('Tickets.successful_adding') : lang('Tickets.successful_updating')) . ' ' . $parent['title'],
                'id'      => $parent['ticket_product_id'] ?? $ticket_product_id,
            ]);
        }

        return $this->response->setJSON([
            'success' => false,
            'message' => lang('Tickets.error_adding_updating') . ' ' . $parent['title'],
            'id'      => NEW_ENTRY,
        ]);
    }

    public function postDelete(): ResponseInterface
    {
        $ids = $this->request->getPost('ids', FILTER_SANITIZE_FULL_SPECIAL_CHARS);
        if (!is_array($ids) || empty($ids)) {
            return $this->response->setJSON(['success' => false, 'message' => lang('Tickets.cannot_be_deleted')]);
        }

        if ($this->ticket_product->delete_list($ids)) {
            return $this->response->setJSON([
                'success' => true,
                'message' => lang('Tickets.successful_deleted') . ' ' . count($ids) . ' ' . lang('Tickets.one_or_multiple'),
            ]);
        }

        return $this->response->setJSON(['success' => false, 'message' => lang('Tickets.cannot_be_deleted')]);
    }

    /**
     * Render the manual-entry redemption page. The form posts to
     * /tickets/redeem.
     */
    public function getRedeem(): string
    {
        return view('tickets/redeem', []);
    }

    /**
     * Redeem a ticket. Accepts either a full JWT token or a short human code
     * (which we look up to find the corresponding ticket and synthesise a
     * verify call against its stored hash — Phase 2 enhancement).
     */
    public function postRedeem(): ResponseInterface
    {
        $token          = trim((string) $this->request->getPost('token'));
        $idempotencyKey = $this->request->getPost('idempotency_key');
        $employee       = $this->employee->get_logged_in_employee_info();
        $employeeId     = (int) $employee->person_id;
        $locationId     = $this->request->getPost('location_id', FILTER_SANITIZE_NUMBER_INT);
        $locationId     = $locationId ? (int) $locationId : null;

        if ($token === '') {
            return $this->response->setJSON(['success' => false, 'message' => lang('Tickets.redeem_scan_prompt')]);
        }

        $result = $this->ticket->redeem($token, $employeeId, $locationId, $idempotencyKey ? (string) $idempotencyKey : null);

        return $this->response->setJSON([
            'success'   => $result['result'] === Ticket::REDEMPTION_OK,
            'result'    => $result['result'],
            'message'   => $result['message'],
            'ticket_id' => $result['ticket_id'],
        ]);
    }

    private function emptyToNull(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }
        if (is_string($value) && trim($value) === '') {
            return null;
        }

        return $value;
    }

    private function resolveActiveSigningKeyId(): int
    {
        $key = service('ticket_token_lib')->getActiveKey();

        return (int) ($key->signing_key_id ?? 0);
    }

    /**
     * @return array<string,mixed>
     */
    private function extractSubtypePayload(string $subtype, array $post): array
    {
        return match ($subtype) {
            'meeting' => [
                'meeting_detail' => $post['meeting_detail'] ?? null,
                'map_url'        => $post['map_url']        ?? null,
                'entrance'       => $post['entrance']       ?? null,
                'zone'           => $post['zone']           ?? null,
            ],
            'scenic' => [
                'scenic_name'   => $post['scenic_name']   ?? null,
                'opening_hours' => $post['opening_hours'] ?? null,
                'ticket_class'  => $post['ticket_class']  ?? null,
                'address'       => $post['address']       ?? null,
            ],
            'movie' => [
                'film_title'    => $post['film_title']    ?? null,
                'hall'          => $post['hall']          ?? null,
                'screening_ts'  => $this->emptyToNull($post['screening_ts'] ?? null),
                'seat_map_json' => $post['seat_map_json'] ?? null,
            ],
            'transport' => [
                'origin'        => $post['origin']        ?? null,
                'destination'   => $post['destination']   ?? null,
                'carrier'       => $post['carrier']       ?? null,
                'departure_ts'  => $this->emptyToNull($post['departure_ts'] ?? null),
                'arrival_ts'    => $this->emptyToNull($post['arrival_ts']   ?? null),
                'seat_map_json' => $post['seat_map_json'] ?? null,
            ],
            default => [],
        };
    }
}
