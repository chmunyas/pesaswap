<?php

namespace App\Libraries;

use App\Models\Ticket;
use App\Models\Ticket_product;
use DateTimeImmutable;

/**
 * Issues tickets when a sale is completed.
 *
 * Called from App\Models\Sale::save_value() after the items loop completes
 * and the sale is in COMPLETED status. Iterates the cart, and for each line
 * whose item.item_type === ITEM_TICKET, mints one Ticket row per unit
 * purchased, computing each ticket's validity window from the product's
 * validity_mode (fixed range or relative N days).
 *
 * Idempotency: a sale should never be saved as COMPLETED twice for the same
 * sale_id (Sale model uses a transaction), so we don't dedupe here. If
 * reissuance is ever needed, callers should refund the prior tickets first.
 */
class Ticket_issuer
{
    private Ticket $ticket;
    private Ticket_product $ticket_product;

    public function __construct()
    {
        $this->ticket         = model(Ticket::class);
        $this->ticket_product = model(Ticket_product::class);
    }

    /**
     * Process a freshly-saved sale. Returns the list of issued tickets keyed
     * by sale_item line for downstream rendering (receipts/email).
     *
     * @param array<int,array<string,mixed>> $items   The cart that was just persisted.
     * @param object[] $itemInfos Per-line item info objects keyed by sale_item line.
     *
     * @return array<int, list<array{ticket:object, token:string}>>
     */
    public function issue_for_sale(int $sale_id, int $customer_id, array $items, array $itemInfos): array
    {
        $issued = [];

        foreach ($items as $line => $item_data) {
            $itemInfo = $itemInfos[$line] ?? null;
            if ($itemInfo === null) {
                continue;
            }
            if ((int) ($itemInfo->item_type ?? 0) !== ITEM_TICKET) {
                continue;
            }

            $product = $this->resolveProductForItem((int) $itemInfo->item_id);
            if ($product === null) {
                continue;
            }

            $quantity = (int) max(1, (float) $item_data['quantity']);
            $validity = $this->computeValidityWindow($product);

            $lineIssued = [];
            for ($unit = 0; $unit < $quantity; $unit++) {
                $lineIssued[] = $this->ticket->issue([
                    'ticket_product_id' => (int) $product->ticket_product_id,
                    'sale_id'           => $sale_id,
                    'sale_item_seq'     => $unit,
                    'customer_id'       => $customer_id > 0 ? $customer_id : null,
                    'valid_from'        => $validity['from'],
                    'valid_to'          => $validity['to'],
                    'seat_assignment'   => $item_data['seat_assignment'] ?? null,
                ]);
            }

            $issued[$line] = $lineIssued;
        }

        return $issued;
    }

    /**
     * Find the ticket_product row that corresponds to the given items.item_id.
     * Returns null if the item is not actually a ticket product (defensive).
     */
    private function resolveProductForItem(int $item_id): ?object
    {
        $db  = db_connect();
        $row = $db->table('ticket_products')
            ->where('item_id', $item_id)
            ->where('deleted', 0)
            ->orderBy('ticket_product_id', 'asc')
            ->get(1)
            ->getRow();

        return $row;
    }

    /**
     * Compute the [valid_from, valid_to] DateTime pair from the product's
     * validity_mode + dates.
     *
     * @return array{from:?\DateTimeImmutable, to:?\DateTimeImmutable}
     */
    private function computeValidityWindow(object $product): array
    {
        $now = new DateTimeImmutable();

        if (($product->validity_mode ?? 'fixed') === 'fixed') {
            return [
                'from' => !empty($product->begin_ts) ? new DateTimeImmutable($product->begin_ts) : null,
                'to'   => !empty($product->end_ts)   ? new DateTimeImmutable($product->end_ts)   : null,
            ];
        }

        $beginOffset = (int) ($product->fixed_begin_term_days ?? 0);
        $term        = (int) ($product->fixed_term_days ?? 0);

        $from = $beginOffset > 0 ? $now->modify("+{$beginOffset} days") : $now;
        $to   = $term > 0 ? $from->modify("+{$term} days") : null;

        return ['from' => $from, 'to' => $to];
    }
}
