<?php

namespace App\Libraries;

use App\Models\Ticket;
use App\Models\Ticket_product;
use DateTimeImmutable;
use RuntimeException;
use Throwable;

/**
 * Issues tickets when a sale is completed.
 *
 * Called from App\Models\Sale::save_value() after the items loop completes
 * and the sale is in COMPLETED status. Iterates the cart, and for each line
 * whose item.item_type === ITEM_TICKET, mints one Ticket row per unit
 * purchased, computing each ticket's validity window from the product's
 * validity_mode (fixed range or relative N days) or from the selected
 * session's starts_at/ends_at.
 *
 * Phase 2: honours per-line ticket_session_id and ticket_tier_id supplied
 * on item_data (set by the POS session/tier picker). Decrements each of
 * product.quantity_issued, session.quantity_issued and tier.quantity_issued
 * under conditional UPDATEs inside the calling sale transaction so an
 * overshoot rolls the entire sale back rather than leaving overshot
 * counters or orphan tickets.
 *
 * Phase 3: best-effort post-issue email/SMS delivery via Ticket_delivery_lib.
 * Failures NEVER bubble back to the sale transaction — they only end up in
 * ticket_delivery_attempts.last_error for the operator to retry from the
 * admin UI.
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
     * @param array<int,array<string,mixed>> $items     The cart that was just persisted.
     * @param list<object>                   $itemInfos Per-line item info objects keyed by sale_item line.
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

            $sessionId = isset($item_data['ticket_session_id']) && $item_data['ticket_session_id'] !== null && $item_data['ticket_session_id'] !== ''
                ? (int) $item_data['ticket_session_id']
                : null;
            $tierId = isset($item_data['ticket_tier_id']) && $item_data['ticket_tier_id'] !== null && $item_data['ticket_tier_id'] !== ''
                ? (int) $item_data['ticket_tier_id']
                : null;

            // Phase 5: if this product has bundle child rows, expand each
            // unit into N child tickets instead of issuing the parent.
            // Each child applies its own atomic 3-counter decrement and
            // throws on overshoot, rolling the calling sale tx back.
            $bundleRows = $this->loadBundleRows((int) $product->ticket_product_id);
            if ($bundleRows !== []) {
                $issued[$line] = $this->expandBundle(
                    $product,
                    $bundleRows,
                    $quantity,
                    $sale_id,
                    $customer_id,
                    $item_data,
                );

                continue;
            }

            $validity = $this->computeValidityWindow($product, $sessionId);

            $lineIssued = [];

            for ($unit = 0; $unit < $quantity; $unit++) {
                $this->bumpCounters((int) $product->ticket_product_id, $sessionId, $tierId);

                $issuedResult = $this->ticket->issue([
                    'ticket_product_id' => (int) $product->ticket_product_id,
                    'session_id'        => $sessionId,
                    'tier_id'           => $tierId,
                    'sale_id'           => $sale_id,
                    'sale_item_seq'     => $unit,
                    'customer_id'       => $customer_id > 0 ? $customer_id : null,
                    'valid_from'        => $validity['from'],
                    'valid_to'          => $validity['to'],
                    'seat_assignment'   => $item_data['seat_assignment'] ?? null,
                ]);
                $lineIssued[] = $issuedResult;

                // Phase 3: fan-out delivery — never fails issuance.
                $this->safeDispatch($issuedResult['ticket'], $customer_id);
            }

            $issued[$line] = $lineIssued;
        }

        return $issued;
    }

    /**
     * Phase 5: expand a bundle-parent sale line into its child tickets.
     *
     * For each cart unit (qty), iterate every bundle row and issue
     * row.quantity child tickets. The child product / tier / session are
     * pinned by the bundle row when set; otherwise the cart-line's
     * ticket_session_id / ticket_tier_id win (so a bundle that says
     * "any Friday session" still lets the operator pick which one).
     *
     * Counter bumps happen per child via the existing bumpCounters()
     * path, so all three (child_product, child_session, child_tier)
     * caps are atomically enforced. Any overshoot throws and rolls the
     * sale back, never leaving half a bundle issued.
     *
     * @param array<int,object>   $bundleRows
     * @param array<string,mixed> $item_data
     *
     * @return list<array{ticket:object, token:string}>
     */
    private function expandBundle(
        object $parentProduct,
        array $bundleRows,
        int $quantity,
        int $sale_id,
        int $customer_id,
        array $item_data,
    ): array {
        $cartSessionId = isset($item_data['ticket_session_id']) && $item_data['ticket_session_id'] !== null && $item_data['ticket_session_id'] !== ''
            ? (int) $item_data['ticket_session_id']
            : null;
        $cartTierId = isset($item_data['ticket_tier_id']) && $item_data['ticket_tier_id'] !== null && $item_data['ticket_tier_id'] !== ''
            ? (int) $item_data['ticket_tier_id']
            : null;

        $issuedRows = [];
        $seq        = 0;

        for ($unit = 0; $unit < $quantity; $unit++) {
            foreach ($bundleRows as $bundle) {
                $childProduct = $this->resolveProductById((int) $bundle->child_product_id);
                if ($childProduct === null) {
                    throw new RuntimeException(
                        'Bundle child product '
                        . (int) $bundle->child_product_id
                        . ' (parent ' . (int) $parentProduct->ticket_product_id . ') was deleted; refusing to issue half a bundle.',
                    );
                }

                $sessionId = $bundle->child_session_id !== null ? (int) $bundle->child_session_id : $cartSessionId;
                $tierId    = $bundle->child_tier_id !== null ? (int) $bundle->child_tier_id : $cartTierId;

                $perRowQty = (int) max(1, (int) $bundle->quantity);
                $validity  = $this->computeValidityWindow($childProduct, $sessionId);

                for ($i = 0; $i < $perRowQty; $i++) {
                    $this->bumpCounters((int) $childProduct->ticket_product_id, $sessionId, $tierId);

                    $issuedResult = $this->ticket->issue([
                        'ticket_product_id' => (int) $childProduct->ticket_product_id,
                        'session_id'        => $sessionId,
                        'tier_id'           => $tierId,
                        'sale_id'           => $sale_id,
                        'sale_item_seq'     => $seq++,
                        'customer_id'       => $customer_id > 0 ? $customer_id : null,
                        'valid_from'        => $validity['from'],
                        'valid_to'          => $validity['to'],
                        'seat_assignment'   => $item_data['seat_assignment'] ?? null,
                    ]);
                    $issuedRows[] = $issuedResult;

                    $this->safeDispatch($issuedResult['ticket'], $customer_id);
                }
            }
        }

        return $issuedRows;
    }

    /**
     * Load active bundle rows for a parent product, ordered for stable
     * sale_item_seq numbering. Empty array means the product is NOT a
     * bundle (the caller falls through to normal single-ticket issuance).
     *
     * @return list<object>
     */
    private function loadBundleRows(int $parentProductId): array
    {
        $db = db_connect();
        if (! $db->tableExists('ticket_product_bundles')) {
            return [];
        }

        $rows = $db->table('ticket_product_bundles')
            ->where('parent_product_id', $parentProductId)
            ->where('deleted', 0)
            ->orderBy('sort_order', 'ASC')
            ->orderBy('bundle_id', 'ASC')
            ->get()
            ->getResultArray();

        return array_map(static fn (array $r) => (object) $r, $rows);
    }

    /**
     * Resolve a ticket product by ticket_product_id (vs resolveProductForItem
     * which keys by items.item_id). Used by bundle expansion.
     */
    private function resolveProductById(int $ticketProductId): ?object
    {
        $db = db_connect();

        return $db->table('ticket_products')
            ->where('ticket_product_id', $ticketProductId)
            ->where('deleted', 0)
            ->get()
            ->getRow();
    }

    /**
     * Apply conditional UPDATEs to the relevant counters. Throws if any
     * counter would overshoot — the enclosing sale transaction rolls back.
     */
    private function bumpCounters(int $productId, ?int $sessionId, ?int $tierId): void
    {
        $db            = db_connect();
        $productsTable = $db->prefixTable('ticket_products');

        $db->query(
            "UPDATE {$productsTable}
             SET quantity_issued = quantity_issued + 1
             WHERE ticket_product_id = ?
               AND deleted = 0
               AND (quantity IS NULL OR quantity_issued < quantity)",
            [$productId],
        );
        if ($db->affectedRows() === 0) {
            throw new RuntimeException("Ticket product {$productId} is sold out.");
        }

        if ($sessionId !== null && $db->tableExists('ticket_product_sessions')) {
            $sessionsTable = $db->prefixTable('ticket_product_sessions');
            $db->query(
                "UPDATE {$sessionsTable}
                 SET quantity_issued = quantity_issued + 1
                 WHERE session_id = ?
                   AND ticket_product_id = ?
                   AND deleted = 0
                   AND status IN ('scheduled','live')
                   AND (quantity IS NULL OR quantity_issued < quantity)",
                [$sessionId, $productId],
            );
            if ($db->affectedRows() === 0) {
                throw new RuntimeException("Session {$sessionId} is sold out or cancelled.");
            }
        }

        if ($tierId !== null && $db->tableExists('ticket_product_tiers')) {
            $tiersTable = $db->prefixTable('ticket_product_tiers');
            $db->query(
                "UPDATE {$tiersTable}
                 SET quantity_issued = quantity_issued + 1
                 WHERE tier_id = ?
                   AND ticket_product_id = ?
                   AND deleted = 0
                   AND (quantity IS NULL OR quantity_issued < quantity)",
                [$tierId, $productId],
            );
            if ($db->affectedRows() === 0) {
                throw new RuntimeException("Tier {$tierId} is sold out.");
            }
        }
    }

    /**
     * Best-effort delivery dispatch. Catches anything and logs — issuance
     * must succeed regardless of email/SMS gateway state.
     */
    private function safeDispatch(object $ticket, int $customer_id): void
    {
        try {
            if ($customer_id <= 0) {
                return;
            }
            $db = db_connect();
            if (! $db->tableExists('ticket_delivery_attempts')) {
                return;
            }
            $customer = $db->table('people')
                ->select('email, phone_number')
                ->where('person_id', $customer_id)
                ->get()
                ->getRow();
            if ($customer === null) {
                return;
            }
            service('ticket_delivery_lib')->dispatch(
                $ticket,
                ! empty($customer->email) ? (string) $customer->email : null,
                ! empty($customer->phone_number) ? (string) $customer->phone_number : null,
            );
        } catch (Throwable $e) {
            log_message('error', 'Ticket_issuer::safeDispatch — ' . $e->getMessage());
        }
    }

    /**
     * Find the ticket_product row that corresponds to the given items.item_id.
     * Returns null if the item is not actually a ticket product (defensive).
     */
    private function resolveProductForItem(int $item_id): ?object
    {
        $db = db_connect();

        return $db->table('ticket_products')
            ->where('item_id', $item_id)
            ->where('deleted', 0)
            ->orderBy('ticket_product_id', 'asc')
            ->get(1)
            ->getRow();
    }

    /**
     * Compute the [valid_from, valid_to] DateTime pair. If a session is
     * selected, its starts_at/ends_at wins. Otherwise falls back to the
     * product's validity_mode + dates.
     *
     * @return array{from:?DateTimeImmutable, to:?DateTimeImmutable}
     */
    private function computeValidityWindow(object $product, ?int $sessionId): array
    {
        if ($sessionId !== null) {
            $db = db_connect();
            if ($db->tableExists('ticket_product_sessions')) {
                $session = $db->table('ticket_product_sessions')
                    ->where('session_id', $sessionId)
                    ->where('ticket_product_id', (int) $product->ticket_product_id)
                    ->where('deleted', 0)
                    ->get()
                    ->getRow();
                if ($session !== null && ! empty($session->starts_at)) {
                    return [
                        'from' => new DateTimeImmutable((string) $session->starts_at),
                        'to'   => ! empty($session->ends_at) ? new DateTimeImmutable((string) $session->ends_at) : null,
                    ];
                }
            }
        }

        $now = new DateTimeImmutable();

        if (($product->validity_mode ?? 'fixed') === 'fixed') {
            return [
                'from' => ! empty($product->begin_ts) ? new DateTimeImmutable($product->begin_ts) : null,
                'to'   => ! empty($product->end_ts) ? new DateTimeImmutable($product->end_ts) : null,
            ];
        }

        $beginOffset = (int) ($product->fixed_begin_term_days ?? 0);
        $term        = (int) ($product->fixed_term_days ?? 0);

        $from = $beginOffset > 0 ? $now->modify("+{$beginOffset} days") : $now;
        $to   = $term > 0 ? $from->modify("+{$term} days") : null;

        return ['from' => $from, 'to' => $to];
    }
}
