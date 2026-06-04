<?php

namespace App\Models;

use CodeIgniter\Database\ResultInterface;
use CodeIgniter\Model;
use stdClass;

/**
 * Ticket product (the "card") model.
 *
 * Mirrors the role of Giftcard for tickets: each row is 1:1 with an
 * ospos_items row whose item_type = ITEM_TICKET. Subtype-specific fields live
 * in 1:1 child tables (ticket_product_meeting, _scenic, _movie, _transport).
 *
 * Phase 1 surface: search/list/get/save/delete + a `get_full_info()` that
 * eager-loads the subtype child row.
 */
class Ticket_product extends Model
{
    protected $table          = 'ticket_products';
    protected $primaryKey     = 'ticket_product_id';
    protected $useAutoIncrement = true;
    protected $useSoftDeletes = false;
    protected $allowedFields  = [
        'item_id',
        'subtype',
        'code_type',
        'validity_mode',
        'begin_ts',
        'end_ts',
        'fixed_begin_term_days',
        'fixed_term_days',
        'quantity',
        'quantity_issued',
        'max_per_customer',
        'sale_window_from',
        'sale_window_to',
        'bind_customer',
        'transferable',
        'single_use',
        'max_redemptions',
        'refundable',
        'refund_window_hours',
        'title',
        'brand_name',
        'color',
        'notice',
        'description',
        'service_phone',
        'source',
        'custom_url',
        'custom_url_name',
        'custom_url_sub_title',
        'logo_url',
        'signing_key_id',
        'deleted',
    ];

    public const SUBTYPES = ['meeting', 'scenic', 'movie', 'transport'];

    public const SUBTYPE_TABLES = [
        'meeting'   => 'ticket_product_meeting',
        'scenic'    => 'ticket_product_scenic',
        'movie'     => 'ticket_product_movie',
        'transport' => 'ticket_product_transport',
    ];

    public function exists(int $ticket_product_id): bool
    {
        $builder = $this->db->table('ticket_products');
        $builder->where('ticket_product_id', $ticket_product_id);
        $builder->where('deleted', 0);

        return $builder->get()->getNumRows() === 1;
    }

    public function get_total_rows(): int
    {
        $builder = $this->db->table('ticket_products');
        $builder->where('deleted', 0);

        return $builder->countAllResults();
    }

    public function get_info(int $ticket_product_id): object
    {
        $builder = $this->db->table('ticket_products');
        $builder->select('ticket_products.*, items.name AS item_name, items.unit_price');
        $builder->join('items', 'items.item_id = ticket_products.item_id', 'left');
        $builder->where('ticket_product_id', $ticket_product_id);
        $builder->where('ticket_products.deleted', 0);

        $query = $builder->get();
        if ($query->getNumRows() === 1) {
            return $query->getRow();
        }

        return $this->getEmptyObject('ticket_products');
    }

    /**
     * Returns parent + subtype-specific child as a single merged object.
     */
    public function get_full_info(int $ticket_product_id): object
    {
        $info = $this->get_info($ticket_product_id);
        if (!isset($info->ticket_product_id) || $info->ticket_product_id <= 0) {
            return $info;
        }

        $subtypeTable = self::SUBTYPE_TABLES[$info->subtype] ?? null;
        if ($subtypeTable !== null) {
            $row = $this->db->table($subtypeTable)
                ->where('ticket_product_id', $ticket_product_id)
                ->get()
                ->getRow();

            if ($row !== null) {
                foreach ($row as $field => $value) {
                    if ($field === 'ticket_product_id') {
                        continue;
                    }
                    $info->$field = $value;
                }
            }
        }

        $locations = $this->db->table('ticket_product_locations')
            ->where('ticket_product_id', $ticket_product_id)
            ->get()
            ->getResultArray();

        $info->location_ids = array_column($locations, 'location_id');

        return $info;
    }

    /**
     * Build an empty object whose property set matches the table columns so
     * the form view doesn't have to null-coalesce every field.
     */
    private function getEmptyObject(string $table_name): object
    {
        $empty = new stdClass();

        foreach ($this->db->getFieldData($table_name) as $field) {
            $name = $field->name;

            if (in_array($field->type, ['int', 'tinyint', 'decimal'], true)) {
                $empty->$name = ($field->primary_key == 1) ? NEW_ENTRY : 0;
            } else {
                $empty->$name = null;
            }
        }

        $empty->location_ids = [];

        return $empty;
    }

    /**
     * Insert or update a ticket product. Subtype child + locations pivot are
     * upserted in the same transaction.
     *
     * @param array<string,mixed>      $data    Parent columns.
     * @param array<string,mixed>      $subtype Child columns for this subtype.
     * @param array<int>               $locationIds
     * @param int                      $ticket_product_id NEW_ENTRY for insert.
     */
    public function save_value(array &$data, array $subtype, array $locationIds, int $ticket_product_id = NEW_ENTRY): bool
    {
        if (!isset($data['subtype']) || !in_array($data['subtype'], self::SUBTYPES, true)) {
            return false;
        }

        $childTable = self::SUBTYPE_TABLES[$data['subtype']];

        $this->db->transStart();

        $builder = $this->db->table('ticket_products');

        if ($ticket_product_id === NEW_ENTRY || !$this->exists($ticket_product_id)) {
            $builder->insert($data);
            $ticket_product_id      = (int) $this->db->insertID();
            $data['ticket_product_id'] = $ticket_product_id;
        } else {
            $builder->where('ticket_product_id', $ticket_product_id);
            $builder->update($data);
            $data['ticket_product_id'] = $ticket_product_id;
        }

        // Upsert subtype row (delete-then-insert keeps logic simple).
        $this->db->table($childTable)->where('ticket_product_id', $ticket_product_id)->delete();
        if (!empty($subtype)) {
            $subtype['ticket_product_id'] = $ticket_product_id;
            $this->db->table($childTable)->insert($subtype);
        }

        // Replace allowed-locations pivot.
        $this->db->table('ticket_product_locations')
            ->where('ticket_product_id', $ticket_product_id)
            ->delete();
        if (!empty($locationIds)) {
            $rows = array_map(static fn (int $id) => [
                'ticket_product_id' => $ticket_product_id,
                'location_id'       => $id,
            ], $locationIds);
            $this->db->table('ticket_product_locations')->insertBatch($rows);
        }

        $this->db->transComplete();

        return $this->db->transStatus();
    }

    public function delete($ticket_product_id = null, bool $purge = false): bool
    {
        $builder = $this->db->table('ticket_products');
        $builder->where('ticket_product_id', $ticket_product_id);

        return $builder->update(['deleted' => 1]);
    }

    public function delete_list(array $ids): bool
    {
        $builder = $this->db->table('ticket_products');
        $builder->whereIn('ticket_product_id', $ids);

        return $builder->update(['deleted' => 1]);
    }

    public function get_search_suggestions(string $search, int $limit = 25): array
    {
        $suggestions = [];

        $builder = $this->db->table('ticket_products');
        $builder->select('ticket_product_id, title');
        $builder->like('title', $search);
        $builder->where('deleted', 0);
        $builder->orderBy('title', 'asc');
        $builder->limit($limit);

        foreach ($builder->get()->getResult() as $row) {
            $suggestions[] = ['label' => $row->title, 'value' => $row->ticket_product_id];
        }

        return $suggestions;
    }

    public function get_found_rows(string $search): int
    {
        return $this->search($search, 0, 0, 'title', 'asc', true);
    }

    public function search(string $search, ?int $rows = 0, ?int $limit_from = 0, ?string $sort = 'title', ?string $order = 'asc', ?bool $count_only = false): mixed
    {
        $rows       = $rows       ?? 0;
        $limit_from = $limit_from ?? 0;
        $sort       = $sort       ?? 'title';
        $order      = $order      ?? 'asc';
        $count_only = $count_only ?? false;

        $builder = $this->db->table('ticket_products');

        if ($count_only) {
            $builder->select('COUNT(ticket_product_id) AS count');
        } else {
            $builder->select('ticket_products.*, items.name AS item_name, items.unit_price');
            $builder->join('items', 'items.item_id = ticket_products.item_id', 'left');
        }

        $builder->groupStart();
        $builder->like('title', $search);
        $builder->orLike('items.name', $search);
        $builder->orLike('subtype', $search);
        $builder->groupEnd();
        $builder->where('ticket_products.deleted', 0);

        if ($count_only) {
            return $builder->get()->getRow()->count;
        }

        $builder->orderBy($sort, $order);

        if ($rows > 0) {
            $builder->limit($rows, $limit_from);
        }

        return $builder->get();
    }
}
