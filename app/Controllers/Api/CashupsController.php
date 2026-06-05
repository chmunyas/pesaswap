<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * CashupsController — register open/close lifecycle.
 *
 * Cashup model:
 *   open  — operator records opening cash float (open_amount_cash) at
 *           start of shift.
 *   close — operator counts the till (closed_amount_cash/card/check)
 *           and the system computes "expected" cash from:
 *               opening_cash + cash_sales − cash_refunds − cash_expenses
 *                            + transfer_amount_cash
 *           variance = counted_cash − expected_cash
 *
 * Constraints (rubber-duck blocker #4):
 *   - At most ONE cashup may be open at a time. Enforced under a MySQL
 *     advisory lock (GET_LOCK) so two concurrent open() calls from
 *     different terminals cannot both succeed — a SELECT … FOR UPDATE
 *     against an empty result set would not block, so we serialise the
 *     check-and-insert through a named lock instead.
 *   - "Open" = close_date IS NULL.
 *
 * Per blocker #3, expected-cash is computed across ALL employees in the
 * shift window, not just the opening employee — a single till can be
 * staffed by multiple people through the day.
 *
 * Hard-deletes existing rows are NOT exposed; soft-delete via the
 * `deleted` column already present in the legacy OSPOS schema.
 */
class CashupsController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->db->tableExists('cash_up')) {
            return $this->respondSuccess([
                'cashups'    => [],
                'pagination' => ['limit' => 20, 'offset' => 0, 'total' => 0],
                'open'       => null,
            ]);
        }

        $pagination = $this->getPagination();

        try {
            $rows  = $this->fetchList($pagination);
            $total = (int) ($this->db->query(
                'SELECT COUNT(*) AS total FROM ' . $this->db->prefixTable('cash_up')
                . ' WHERE deleted = 0',
            )->getRowArray()['total'] ?? 0);
            $decorated = array_map(fn (array $r) => $this->decorate($r), $rows);

            return $this->respondSuccess([
                'cashups'    => $decorated,
                'pagination' => [
                    'limit'  => $pagination['limit'],
                    'offset' => $pagination['offset'],
                    'total'  => $total,
                ],
                'open' => $this->fetchCurrentOpen(),
            ]);
        } catch (Throwable $e) {
            log_message('error', 'CashupsController::index — ' . $e->getMessage());

            return $this->respondError('Failed to load cashups.', 500);
        }
    }

    public function show(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        $row = $this->fetchRow($id);
        if ($row === null) {
            return $this->respondError('Cashup not found.', 404);
        }

        return $this->respondSuccess(['cashup' => $this->decorate($row)]);
    }

    public function open(): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        if (! $this->db->tableExists('cash_up')) {
            return $this->respondError('Cash up table is not available.', 503);
        }

        $body       = $this->request->getJSON(true) ?? [];
        $openAmount = $this->parseMoney($body['open_amount_cash'] ?? null);
        if ($openAmount === null) {
            return $this->respondError('open_amount_cash must be a non-negative number.', 422);
        }
        $description = trim((string) ($body['description'] ?? ''));
        $employeeId  = (int) ($this->session->get('person_id') ?? 0);
        if ($employeeId <= 0) {
            return $this->respondError('Employee not identified.', 401);
        }

        try {
            $this->db->query("SELECT GET_LOCK('ospos_cash_up_open', 5) AS locked")->getRowArray();
            $this->db->transStart();

            $cashupsTable = $this->db->prefixTable('cash_up');
            $existingOpen = $this->db->query(
                "SELECT cashup_id FROM {$cashupsTable} WHERE deleted = 0 AND close_date IS NULL LIMIT 1",
            )->getRowArray();
            if ($existingOpen !== null) {
                $this->db->transComplete();
                $this->db->query("SELECT RELEASE_LOCK('ospos_cash_up_open')");

                return $this->respondError(
                    'A cashup is already open (#' . $existingOpen['cashup_id'] . '). Close it before opening a new one.',
                    409,
                );
            }

            $this->db->table('cash_up')->insert([
                'open_date'            => date('Y-m-d H:i:s'),
                'close_date'           => null,
                'open_amount_cash'     => $openAmount,
                'transfer_amount_cash' => '0.00',
                'closed_amount_cash'   => '0.00',
                'closed_amount_card'   => '0.00',
                'closed_amount_check'  => '0.00',
                'closed_amount_total'  => '0.00',
                'closed_amount_due'    => '0.00',
                'description'          => mb_substr($description, 0, 255),
                'note'                 => 0,
                'open_employee_id'     => $employeeId,
                'close_employee_id'    => $employeeId,
                'deleted'              => 0,
            ]);
            $newId = (int) $this->db->insertID();
            $this->db->transComplete();
            $this->db->query("SELECT RELEASE_LOCK('ospos_cash_up_open')");
            if (! $this->db->transStatus()) {
                return $this->respondError('Failed to open cashup.', 500);
            }

            return $this->respondSuccess([
                'cashup' => $this->decorate($this->fetchRow($newId) ?? []),
            ], 'Cashup opened.', 201);
        } catch (Throwable $e) {
            $this->db->query("SELECT RELEASE_LOCK('ospos_cash_up_open')");
            log_message('error', 'CashupsController::open — ' . $e->getMessage());

            return $this->respondError('Failed to open cashup.', 500);
        }
    }

    public function close(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        $row = $this->fetchRow($id);
        if ($row === null) {
            return $this->respondError('Cashup not found.', 404);
        }
        if (! empty($row['close_date'])) {
            return $this->respondError('Cashup already closed.', 409);
        }

        $body       = $this->request->getJSON(true) ?? [];
        $employeeId = (int) ($this->session->get('person_id') ?? 0);
        if ($employeeId <= 0) {
            return $this->respondError('Employee not identified.', 401);
        }

        $closedCash  = $this->parseMoney($body['closed_amount_cash'] ?? '0');
        $closedCard  = $this->parseMoney($body['closed_amount_card'] ?? '0');
        $closedCheck = $this->parseMoney($body['closed_amount_check'] ?? '0');
        $closedDue   = $this->parseMoney($body['closed_amount_due'] ?? '0');
        $transfer    = $this->parseMoney($body['transfer_amount_cash'] ?? '0');
        if ($closedCash === null || $closedCard === null || $closedCheck === null
                                 || $closedDue === null || $transfer === null) {
            return $this->respondError('Counted amounts must be non-negative numbers.', 422);
        }
        $note = trim((string) ($body['note'] ?? ''));

        $total = bcadd($closedCash, bcadd($closedCard, bcadd($closedCheck, $closedDue, 2), 2), 2);

        $openDescription     = (string) ($row['description'] ?? '');
        $combinedDescription = $note !== ''
            ? trim($openDescription === '' ? "Close: {$note}" : "{$openDescription} | Close: {$note}")
            : $openDescription;

        try {
            $this->db->table('cash_up')->where('cashup_id', $id)->update([
                'close_date'           => date('Y-m-d H:i:s'),
                'closed_amount_cash'   => $closedCash,
                'closed_amount_card'   => $closedCard,
                'closed_amount_check'  => $closedCheck,
                'closed_amount_due'    => $closedDue,
                'closed_amount_total'  => $total,
                'transfer_amount_cash' => $transfer,
                'description'          => mb_substr($combinedDescription, 0, 255),
                'close_employee_id'    => $employeeId,
            ]);
            $fresh = $this->fetchRow($id);

            return $this->respondSuccess([
                'cashup' => $fresh ? $this->decorate($fresh) : null,
            ], 'Cashup closed.');
        } catch (Throwable $e) {
            log_message('error', 'CashupsController::close — ' . $e->getMessage());

            return $this->respondError('Failed to close cashup.', 500);
        }
    }

    public function delete(int $id): ResponseInterface
    {
        if ($auth = $this->requireAuth()) {
            return $auth;
        }
        $row = $this->fetchRow($id);
        if ($row === null) {
            return $this->respondError('Cashup not found.', 404);
        }

        try {
            $this->db->table('cash_up')->where('cashup_id', $id)->update(['deleted' => 1]);

            return $this->respondSuccess(['cashup_id' => $id], 'Cashup deleted.');
        } catch (Throwable $e) {
            log_message('error', 'CashupsController::delete — ' . $e->getMessage());

            return $this->respondError('Failed to delete cashup.', 500);
        }
    }

    // ---------- helpers ----------

    private function fetchList(array $pagination): array
    {
        $cashupsTable = $this->db->prefixTable('cash_up');
        $peopleTable  = $this->db->prefixTable('people');
        $select       = [
            'cash_up.cashup_id', 'cash_up.open_date', 'cash_up.close_date',
            'cash_up.open_amount_cash', 'cash_up.transfer_amount_cash',
            'cash_up.closed_amount_cash', 'cash_up.closed_amount_card',
            'cash_up.closed_amount_check', 'cash_up.closed_amount_total',
            'cash_up.closed_amount_due', 'cash_up.description',
            'cash_up.open_employee_id', 'cash_up.close_employee_id',
            'cash_up.deleted',
        ];
        $joins = '';
        if ($this->db->tableExists('people')) {
            $select[] = "TRIM(CONCAT(COALESCE(open_p.first_name,''),' ',COALESCE(open_p.last_name,''))) AS open_employee_name";
            $select[] = "TRIM(CONCAT(COALESCE(close_p.first_name,''),' ',COALESCE(close_p.last_name,''))) AS close_employee_name";
            $joins    = "\n  LEFT JOIN {$peopleTable} AS open_p ON open_p.person_id = cash_up.open_employee_id"
                   . "\n  LEFT JOIN {$peopleTable} AS close_p ON close_p.person_id = cash_up.close_employee_id";
        }
        $sql = 'SELECT ' . implode(', ', $select) . "
                FROM {$cashupsTable} AS cash_up{$joins}
                WHERE cash_up.deleted = 0
                ORDER BY cash_up.open_date DESC, cash_up.cashup_id DESC
                LIMIT {$pagination['limit']} OFFSET {$pagination['offset']}";

        return $this->db->query($sql)->getResultArray();
    }

    private function fetchRow(int $id): ?array
    {
        $row = $this->db->table('cash_up')->where('cashup_id', $id)->where('deleted', 0)->get()->getRowArray();

        return $row ?: null;
    }

    private function fetchCurrentOpen(): ?array
    {
        $row = $this->db->table('cash_up')
            ->where('deleted', 0)
            ->where('close_date IS NULL', null, false)
            ->orderBy('open_date', 'DESC')
            ->limit(1)
            ->get()
            ->getRowArray();

        return $row ? $this->decorate($row) : null;
    }

    /**
     * Decorate a cashup row with:
     *   - cash_sales: sum of cash-type payments in the shift window
     *   - cash_refunds: sum of negative cash payments in the window
     *   - cash_expenses: sum of expenses recorded in the window
     *   - expected_cash: open + cash_sales − cash_refunds − cash_expenses + transfer
     *   - variance: closed_amount_cash − expected_cash (positive = over, negative = short)
     */
    private function decorate(array $row): array
    {
        if (empty($row)) {
            return $row;
        }
        $row['cashup_id']            = (int) $row['cashup_id'];
        $row['open_amount_cash']     = (float) ($row['open_amount_cash'] ?? 0);
        $row['transfer_amount_cash'] = (float) ($row['transfer_amount_cash'] ?? 0);
        $row['closed_amount_cash']   = (float) ($row['closed_amount_cash'] ?? 0);
        $row['closed_amount_card']   = (float) ($row['closed_amount_card'] ?? 0);
        $row['closed_amount_check']  = (float) ($row['closed_amount_check'] ?? 0);
        $row['closed_amount_total']  = (float) ($row['closed_amount_total'] ?? 0);
        $row['closed_amount_due']    = (float) ($row['closed_amount_due'] ?? 0);

        $shiftStart = (string) ($row['open_date'] ?? '');
        $shiftEnd   = (string) ($row['close_date'] ?? date('Y-m-d H:i:s'));

        $cashSales    = 0.0;
        $cashRefunds  = 0.0;
        $cashExpenses = 0.0;

        try {
            if ($this->db->tableExists('sales_payments') && $shiftStart !== '') {
                $sp = $this->db->prefixTable('sales_payments');
                $s  = $this->db->prefixTable('sales');
                // Cash payments in the window — match any payment_type starting with 'Cash' (case-insensitive)
                $sumRow = $this->db->query(
                    "SELECT COALESCE(SUM(payment_amount),0) AS s
                     FROM {$sp} sp
                     JOIN {$s} s ON s.sale_id = sp.sale_id
                     WHERE LOWER(sp.payment_type) LIKE 'cash%'
                       AND s.sale_time BETWEEN ? AND ?",
                    [$shiftStart, $shiftEnd],
                )->getRowArray();
                $total = (float) ($sumRow['s'] ?? 0);
                // Negative payment rows represent refunds in OSPOS
                $negRow = $this->db->query(
                    "SELECT COALESCE(SUM(payment_amount),0) AS s
                     FROM {$sp} sp
                     JOIN {$s} s ON s.sale_id = sp.sale_id
                     WHERE LOWER(sp.payment_type) LIKE 'cash%'
                       AND payment_amount < 0
                       AND s.sale_time BETWEEN ? AND ?",
                    [$shiftStart, $shiftEnd],
                )->getRowArray();
                $cashRefunds = -1 * (float) ($negRow['s'] ?? 0); // make positive
                $cashSales   = $total + $cashRefunds; // gross of refunds
            }
            if ($this->db->tableExists('expenses') && $shiftStart !== '') {
                $ex = $this->db->prefixTable('expenses');
                $r  = $this->db->query(
                    "SELECT COALESCE(SUM(amount),0) AS s
                     FROM {$ex}
                     WHERE LOWER(payment_type) LIKE 'cash%'
                       AND deleted = 0
                       AND date BETWEEN ? AND ?",
                    [$shiftStart, $shiftEnd],
                )->getRowArray();
                $cashExpenses = (float) ($r['s'] ?? 0);
            }
        } catch (Throwable $e) {
            // Treat missing tables/columns as zero — keep the cashup readable
        }

        $expectedCash         = $row['open_amount_cash'] + $cashSales - $cashRefunds - $cashExpenses + $row['transfer_amount_cash'];
        $row['cash_sales']    = round($cashSales, 2);
        $row['cash_refunds']  = round($cashRefunds, 2);
        $row['cash_expenses'] = round($cashExpenses, 2);
        $row['expected_cash'] = round($expectedCash, 2);
        $row['variance']      = round($row['closed_amount_cash'] - $expectedCash, 2);
        $row['is_open']       = empty($row['close_date']);

        return $row;
    }

    private function parseMoney(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return '0.00';
        }
        $s = is_string($v) ? trim($v) : (string) $v;
        $s = str_replace([' ', ','], ['', '.'], $s);
        if (! preg_match('/^\d+(\.\d{1,2})?$/', $s)) {
            return null;
        }

        return bcadd($s, '0', 2);
    }
}
