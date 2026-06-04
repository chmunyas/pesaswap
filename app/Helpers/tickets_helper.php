<?php

/**
 * Tickets module view helpers.
 *
 * Mirrors the structure used by giftcards (see app/Helpers/giftcards_helper.php
 * if present, or the inline get_giftcards_manage_table_headers() in
 * app/Views/giftcards/manage.php) — exposes the table-headers JSON and the
 * per-row formatter used by bootstrap-table.
 */

if (!function_exists('get_tickets_manage_table_headers')) {
    function get_tickets_manage_table_headers(): string
    {
        $headers = [
            ['ticket_product_id' => ['label' => lang('Common.id'),                 'sortable' => true]],
            ['title'             => ['label' => lang('Tickets.title'),             'sortable' => true]],
            ['subtype'           => ['label' => lang('Tickets.subtype'),           'sortable' => true]],
            ['code_type'         => ['label' => lang('Tickets.code_type'),         'sortable' => true]],
            ['quantity'          => ['label' => lang('Tickets.quantity'),          'sortable' => true]],
            ['quantity_issued'   => ['label' => lang('Tickets.status_issued'),     'sortable' => true]],
            ['begin_ts'          => ['label' => lang('Tickets.begin_ts'),          'sortable' => true]],
            ['end_ts'            => ['label' => lang('Tickets.end_ts'),            'sortable' => true]],
        ];

        return json_encode($headers, JSON_THROW_ON_ERROR);
    }
}

if (!function_exists('ticket_headers')) {
    function ticket_headers(): array
    {
        return [
            ['ticket_product_id' => 'ticket_product_id'],
            ['title' => 'title'],
            ['subtype' => 'subtype'],
            ['code_type' => 'code_type'],
            ['quantity' => 'quantity'],
            ['quantity_issued' => 'quantity_issued'],
            ['begin_ts' => 'begin_ts'],
            ['end_ts' => 'end_ts'],
        ];
    }
}

if (!function_exists('get_ticket_product_data_row')) {
    function get_ticket_product_data_row(object $product): array
    {
        return [
            'ticket_product_id' => $product->ticket_product_id ?? 0,
            'title'             => esc($product->title ?? ''),
            'subtype'           => esc(lang('Tickets.subtype_' . ($product->subtype ?? 'meeting'))),
            'code_type'         => esc(lang('Tickets.code_type_' . ($product->code_type ?? 'qrcode'))),
            'quantity'          => $product->quantity === null
                ? esc(lang('Tickets.quantity_unlimited'))
                : (int) $product->quantity,
            'quantity_issued'   => (int) ($product->quantity_issued ?? 0),
            'begin_ts'          => esc($product->begin_ts ?? ''),
            'end_ts'            => esc($product->end_ts ?? ''),
        ];
    }
}
