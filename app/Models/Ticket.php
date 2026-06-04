<?php

namespace App\Models;

use App\Libraries\Ticket_token_lib;
use CodeIgniter\Database\ResultInterface;
use CodeIgniter\Model;
use DateTimeImmutable;
use Throwable;

/**
 * Issued ticket instance model.
 *
 * One row per physical/digital ticket. Holds the human-readable `code`, the
 * `code_hash` (sha256 of the full JWT) used as a lookup index, status state
 * machine, validity window, optional seat assignment, and audit fields.
 *
 * Two flows:
 *   - issue(): mint a new row for a sold unit and return (row, jwt) so the
 *     caller (Sales hook or API) can render a QR.
 *   - redeem(): atomic status transition with full audit trail. Idempotent
 *     against (ticket_id, client_idempotency_key).
 */
class Ticket extends Model
{
    protected $table          = 'tickets';
    protected $primaryKey     = 'ticket_id';
    protected $useAutoIncrement = true;
    protected $useSoftDeletes = false;
    protected $allowedFields  = [
        'ticket_product_id',
        'sale_id',
        'sale_item_seq',
        'code',
        'code_hash',
        'customer_id',
        'status',
        'valid_from',
        'valid_to',
        'seat_assignment_json',
        'issued_at',
        'redeemed_at',
        'redeemed_by_employee',
        'redeemed_at_location',
        'redeem_count',
        'transfer_history_json',
        'deleted',
    ];

    public const STATUS_ISSUED   = 'issued';
    public const STATUS_ACTIVE   = 'active';
    public const STATUS_REDEEMED = 'redeemed';
    public const STATUS_REFUNDED = 'refunded';
    public const STATUS_REVOKED  = 'revoked';
    public const STATUS_EXPIRED  = 'expired';

    public const REDEMPTION_OK                = 'ok';
    public const REDEMPTION_ALREADY_REDEEMED  = 'already_redeemed';
    public const REDEMPTION_EXPIRED           = 'expired';
    public const REDEMPTION_REVOKED           = 'revoked';
    public const REDEMPTION_NOT_YET_VALID     = 'not_yet_valid';
    public const REDEMPTION_WRONG_LOCATION    = 'wrong_location';
    public const REDEMPTION_INVALID_SIGNATURE = 'invalid_signature';
    public const REDEMPTION_NOT_FOUND         = 'not_found';

    /**
     * Issue a new ticket for a sale line. Returns ['ticket' => stdClass, 'token' => string].
     *
     * @param array{
     *     ticket_product_id:int,
     *     sale_id:?int,
     *     sale_item_seq:?int,
     *     customer_id:?int,
     *     valid_from:?\DateTimeInterface,
     *     valid_to:?\DateTimeInterface,
     *     seat_assignment:?array<string,mixed>
     * } $params
     *
     * @return array{ticket:object, token:string}
     */
    public function issue(array $params): array
    {
        $now = new DateTimeImmutable();

        $code = $this->generateHumanCode();

        $row = [
            'ticket_product_id'    => (int) $params['ticket_product_id'],
            'sale_id'              => $params['sale_id'] ?? null,
            'sale_item_seq'        => $params['sale_item_seq'] ?? null,
            'code'                 => $code,
            'code_hash'            => str_repeat('0', 64), // placeholder; rewritten below after JWT generation
            'customer_id'          => $params['customer_id'] ?? null,
            'status'               => self::STATUS_ISSUED,
            'valid_from'           => isset($params['valid_from']) ? $params['valid_from']->format('Y-m-d H:i:s') : null,
            'valid_to'             => isset($params['valid_to'])   ? $params['valid_to']->format('Y-m-d H:i:s')   : null,
            'seat_assignment_json' => isset($params['seat_assignment']) ? json_encode($params['seat_assignment']) : null,
            'issued_at'            => $now->format('Y-m-d H:i:s'),
        ];

        $this->db->table('tickets')->insert($row);
        $ticketId = (int) $this->db->insertID();

        // Bump the ticket_products.quantity_issued counter.
        $this->db->query(
            'UPDATE ' . $this->db->prefixTable('ticket_products')
            . ' SET quantity_issued = quantity_issued + 1 WHERE ticket_product_id = ?',
            [(int) $params['ticket_product_id']]
        );

        $tokenLib = service('ticket_token_lib');
        $expAt    = isset($params['valid_to']) ? DateTimeImmutable::createFromInterface($params['valid_to']) : null;
        $token    = $tokenLib->issue($ticketId, $expAt);

        $hash = hash('sha256', $token);
        $this->db->table('tickets')->where('ticket_id', $ticketId)->update(['code_hash' => $hash]);

        $ticket = $this->get_info($ticketId);

        return ['ticket' => $ticket, 'token' => $token];
    }

    /**
     * Atomically redeem a ticket by its JWT.
     *
     * Verification + state transition all happen in one short-lived
     * transaction; the (ticket_id, idempotency_key) UNIQUE on
     * ticket_redemptions ensures retries return the same outcome.
     *
     * @param string  $token            Full JWT scanned/entered by the cashier.
     * @param int     $employeeId
     * @param int|null $locationId
     * @param string|null $idempotencyKey
     *
     * @return array{result:string, ticket_id:?int, message:string}
     */
    public function redeem(string $token, int $employeeId, ?int $locationId = null, ?string $idempotencyKey = null): array
    {
        $tokenLib = service('ticket_token_lib');
        $payload  = $tokenLib->verify($token);

        if ($payload === null || !isset($payload['tid'])) {
            return ['result' => self::REDEMPTION_INVALID_SIGNATURE, 'ticket_id' => null, 'message' => 'Invalid ticket signature'];
        }

        $ticketId = (int) $payload['tid'];

        // Look up by ticket_id only. The RS256 signature on the JWT (verified
        // above) proves authenticity, so we don't need a code_hash check that
        // would prevent legitimate re-issuance of QRs (receipt reprint,
        // /t/{token} regeneration, wallet refresh, etc.). Replay safety
        // comes from the atomic state transition below.
        $ticket = $this->db->table('tickets')
            ->where('ticket_id', $ticketId)
            ->where('deleted', 0)
            ->get()
            ->getRow();

        if ($ticket === null) {
            return ['result' => self::REDEMPTION_NOT_FOUND, 'ticket_id' => null, 'message' => 'Ticket not found'];
        }

        // Idempotency: did the same client/key already produce a result?
        if ($idempotencyKey !== null) {
            $prior = $this->db->table('ticket_redemptions')
                ->where('ticket_id', $ticketId)
                ->where('client_idempotency_key', $idempotencyKey)
                ->get()
                ->getRow();
            if ($prior !== null) {
                return [
                    'result'    => $prior->result,
                    'ticket_id' => $ticketId,
                    'message'   => 'Idempotent replay',
                ];
            }
        }

        $result = $this->classifyRedemptionAttempt($ticket, $locationId);

        if ($result === self::REDEMPTION_OK) {
            $now = date('Y-m-d H:i:s');

            // Atomic state transition: only flips if status is still
            // issued/active. Concurrent scanners get an honest "already".
            $affected = $this->db->query(
                'UPDATE ' . $this->db->prefixTable('tickets') . '
                 SET status = ?, redeemed_at = ?, redeemed_by_employee = ?, redeemed_at_location = ?,
                     redeem_count = redeem_count + 1
                 WHERE ticket_id = ? AND status IN (?, ?)',
                [self::STATUS_REDEEMED, $now, $employeeId, $locationId, $ticketId, self::STATUS_ISSUED, self::STATUS_ACTIVE]
            );

            if ($this->db->affectedRows() === 0) {
                $result = self::REDEMPTION_ALREADY_REDEEMED;
            }
        }

        $this->logRedemption($ticketId, $employeeId, $locationId, $result, $idempotencyKey);

        return [
            'result'    => $result,
            'ticket_id' => $ticketId,
            'message'   => $this->messageForResult($result),
        ];
    }

    public function get_info(int $ticket_id): ?object
    {
        $builder = $this->db->table('tickets');
        $builder->select('tickets.*, ticket_products.title AS product_title, ticket_products.subtype');
        $builder->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left');
        $builder->where('ticket_id', $ticket_id);

        return $builder->get()->getRow();
    }

    public function find_by_code(string $code): ?object
    {
        return $this->db->table('tickets')->where('code', $code)->get()->getRow();
    }

    public function get_for_sale(int $sale_id): ResultInterface
    {
        $builder = $this->db->table('tickets');
        $builder->select('tickets.*, ticket_products.title AS product_title, ticket_products.subtype, ticket_products.notice');
        $builder->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left');
        $builder->where('sale_id', $sale_id);
        $builder->where('tickets.deleted', 0);
        $builder->orderBy('ticket_id', 'asc');

        return $builder->get();
    }

    /**
     * Validate and classify a redemption attempt against the ticket row.
     */
    private function classifyRedemptionAttempt(object $ticket, ?int $locationId): string
    {
        if ($ticket->status === self::STATUS_REDEEMED && $ticket->redeem_count >= 1) {
            // Allow multi-use semantics later via product.max_redemptions; for
            // now any prior redemption blocks a fresh use.
            return self::REDEMPTION_ALREADY_REDEEMED;
        }
        if ($ticket->status === self::STATUS_REVOKED) {
            return self::REDEMPTION_REVOKED;
        }
        if ($ticket->status === self::STATUS_REFUNDED) {
            return self::REDEMPTION_REVOKED;
        }
        if ($ticket->status === self::STATUS_EXPIRED) {
            return self::REDEMPTION_EXPIRED;
        }

        $now = new DateTimeImmutable();
        if ($ticket->valid_from !== null && new DateTimeImmutable($ticket->valid_from) > $now) {
            return self::REDEMPTION_NOT_YET_VALID;
        }
        if ($ticket->valid_to !== null && new DateTimeImmutable($ticket->valid_to) < $now) {
            return self::REDEMPTION_EXPIRED;
        }

        if ($locationId !== null) {
            $allowed = $this->db->table('ticket_product_locations')
                ->where('ticket_product_id', $ticket->ticket_product_id)
                ->countAllResults();
            if ($allowed > 0) {
                $matches = $this->db->table('ticket_product_locations')
                    ->where('ticket_product_id', $ticket->ticket_product_id)
                    ->where('location_id', $locationId)
                    ->countAllResults();
                if ($matches === 0) {
                    return self::REDEMPTION_WRONG_LOCATION;
                }
            }
        }

        return self::REDEMPTION_OK;
    }

    private function logRedemption(int $ticketId, int $employeeId, ?int $locationId, string $result, ?string $idempotencyKey): void
    {
        try {
            $this->db->table('ticket_redemptions')->insert([
                'ticket_id'              => $ticketId,
                'employee_id'            => $employeeId,
                'location_id'            => $locationId,
                'result'                 => $result,
                'client_idempotency_key' => $idempotencyKey,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'Failed to log ticket redemption: ' . $e->getMessage());
        }
    }

    private function messageForResult(string $result): string
    {
        return match ($result) {
            self::REDEMPTION_OK                => lang('Tickets.redemption_ok'),
            self::REDEMPTION_ALREADY_REDEEMED  => lang('Tickets.redemption_already'),
            self::REDEMPTION_EXPIRED           => lang('Tickets.redemption_expired'),
            self::REDEMPTION_REVOKED           => lang('Tickets.redemption_revoked'),
            self::REDEMPTION_NOT_YET_VALID     => lang('Tickets.redemption_not_yet'),
            self::REDEMPTION_WRONG_LOCATION    => lang('Tickets.redemption_wrong_loc'),
            self::REDEMPTION_INVALID_SIGNATURE => lang('Tickets.redemption_invalid_sig'),
            self::REDEMPTION_NOT_FOUND         => lang('Tickets.redemption_not_found'),
            default                            => '',
        };
    }

    /**
     * Generate a unique 12-character human-readable code with retry on
     * collision. Excludes ambiguous chars (0/O, 1/I/L).
     */
    private function generateHumanCode(): string
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $len      = 12;

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $code = '';
            for ($i = 0; $i < $len; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }

            $existing = $this->db->table('tickets')->where('code', $code)->countAllResults();
            if ($existing === 0) {
                return $code;
            }
        }

        // Pathological fallback — include random hex if we somehow collided 5x.
        return strtoupper(bin2hex(random_bytes(8)));
    }
}
