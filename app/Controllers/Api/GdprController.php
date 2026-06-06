<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;
use Throwable;

/**
 * GDPR right-to-erasure + Subject Access Request (export) endpoints.
 *
 * Three operations:
 *
 *   POST /api/admin/gdpr/lookup
 *      Body: {person_id?, email?, phone?}
 *      → 200 {person_id, scope: {tickets, transfers, deliveries, audit_log_entries}}
 *      Preview of what /erase would touch. Required before destructive ops.
 *
 *   POST /api/admin/gdpr/export
 *      Body: {person_id}
 *      → 200 application/json with full Subject Access Request bundle:
 *        all rows from people, tickets, transfers, delivery_attempts,
 *        and audit_log entries that reference the subject.
 *
 *   POST /api/admin/gdpr/erase
 *      Body: {person_id, confirm: true}
 *      → 200 {person_id, erased_counts: {people:N, tickets:N, ...}}
 *      Replaces PII columns in-place with anonymised tombstones:
 *        first_name='ERASED', last_name='ERASED', email=person_<id>@erased.local,
 *        phone='', address fields=''
 *      Preserves row IDs so referential integrity holds for audit/legal.
 *      IDEMPOTENT — re-running on an already-erased person is a no-op +
 *      returns the same shape. Writes an audit_log entry with metadata
 *      {row_counts: ..., requested_by_employee_id}.
 *
 * Why not hard-delete?
 *   GDPR Article 17(3) allows retention for "establishment, exercise or
 *   defence of legal claims". Refunds, chargebacks, tax records often
 *   require keeping the row + amounts; only the identifying PII must go.
 *   Anonymisation is the standard pattern.
 */
class GdprController extends BaseApiController
{
    public function lookup(): ResponseInterface
    {
        if ($denied = $this->requirePermission('config')) {
            return $denied;
        }
        $body = $this->getRequestData();
        $personId = $this->resolvePersonId($body);
        if ($personId === null) {
            return $this->respondError('Provide one of: person_id, email, phone.', 422);
        }

        try {
            $scope = $this->computeScope($personId);

            return $this->respondSuccess([
                'person_id' => $personId,
                'scope'     => $scope,
            ]);
        } catch (Throwable $e) {
            log_message('error', 'GdprController::lookup — ' . $e->getMessage());

            return $this->respondError('Lookup failed.', 500);
        }
    }

    public function export(): ResponseInterface
    {
        if ($denied = $this->requirePermission('config')) {
            return $denied;
        }
        $body = $this->getRequestData();
        $personId = isset($body['person_id']) ? (int) $body['person_id'] : 0;
        if ($personId <= 0) {
            return $this->respondError('person_id is required.', 422);
        }

        try {
            $bundle = [
                'subject_person_id' => $personId,
                'exported_at'       => date('c'),
                'people'            => $this->fetchPeople($personId),
                'tickets'           => $this->fetchTickets($personId),
                'ticket_transfers'  => $this->fetchTransfersForPerson($personId),
                'delivery_attempts' => $this->fetchDeliveryAttempts($personId),
                'audit_log_entries' => $this->fetchAuditEntries($personId),
            ];

            $this->auditErase($personId, 'gdpr.export', ['row_counts' => $this->countByKey($bundle)]);

            return $this->response
                ->setStatusCode(200)
                ->setHeader('Content-Disposition', sprintf('attachment; filename="dsar_%d_%s.json"', $personId, date('Ymd_His')))
                ->setJSON($bundle);
        } catch (Throwable $e) {
            log_message('error', 'GdprController::export — ' . $e->getMessage());

            return $this->respondError('Export failed.', 500);
        }
    }

    public function erase(): ResponseInterface
    {
        if ($denied = $this->requirePermission('config')) {
            return $denied;
        }
        $body = $this->getRequestData();
        $personId = isset($body['person_id']) ? (int) $body['person_id'] : 0;
        if ($personId <= 0) {
            return $this->respondError('person_id is required.', 422);
        }
        if (! (($body['confirm'] ?? false) === true || ($body['confirm'] ?? '') === 'true')) {
            return $this->respondError('Set confirm:true to acknowledge irreversible destruction.', 412);
        }
        // Refuse to erase admin (person_id=1) — that account is the
        // tenant's last-resort recovery path. Op needs to migrate first.
        if ($personId === 1) {
            return $this->respondError('Cannot erase the primary admin account. Reassign permissions first.', 409);
        }

        try {
            $counts = [
                'people'            => 0,
                'tickets'           => 0,
                'ticket_transfers'  => 0,
                'delivery_attempts' => 0,
                'audit_log_entries' => 0,
            ];

            $this->db->transBegin();

            if ($this->db->tableExists('people')) {
                $erasedEmail = sprintf('person_%d@erased.local', $personId);
                $existing    = $this->db->table('people')
                    ->where('person_id', $personId)
                    ->get()
                    ->getRowArray();
                if ($existing !== null && $existing['email'] !== $erasedEmail) {
                    $this->db->table('people')->where('person_id', $personId)->update([
                        'first_name'   => 'ERASED',
                        'last_name'    => 'ERASED',
                        'email'        => $erasedEmail,
                        'phone_number' => '',
                        'address_1'    => '',
                        'address_2'    => '',
                        'city'         => '',
                        'state'        => '',
                        'zip'          => '',
                        'country'      => '',
                        'comments'     => 'Erased under GDPR Art. 17 on ' . date('c'),
                    ]);
                    $counts['people'] = 1;
                }
            }

            // Tickets — nullify any seat_assignment_json strings that
            // could contain PII (free-form), preserve customer_id link
            // for accounting.
            if ($this->db->tableExists('tickets')) {
                $ticketIds = array_column(
                    $this->db->table('tickets')
                        ->select('ticket_id')
                        ->where('customer_id', $personId)
                        ->get()
                        ->getResultArray(),
                    'ticket_id',
                );
                if ($ticketIds !== []) {
                    $this->db->table('tickets')
                        ->whereIn('ticket_id', $ticketIds)
                        ->update(['seat_assignment_json' => null]);
                    $counts['tickets'] = count($ticketIds);
                }
            }

            // Ticket transfers — already hashed. Clear last4 + UA + IP to
            // remove the residual fingerprint vectors.
            if ($this->db->tableExists('ticket_transfers')) {
                $ticketIds = $ticketIds ?? array_column(
                    $this->db->table('tickets')
                        ->select('ticket_id')
                        ->where('customer_id', $personId)
                        ->get()
                        ->getResultArray(),
                    'ticket_id',
                );
                if ($ticketIds !== []) {
                    $this->db->table('ticket_transfers')
                        ->whereIn('ticket_id', $ticketIds)
                        ->update([
                            'to_contact_last4' => null,
                            'ip'               => null,
                            'user_agent'       => null,
                        ]);
                    $counts['ticket_transfers'] = (int) $this->db->affectedRows();
                }
            }

            // Delivery attempts — clear the address (email/phone target)
            if ($this->db->tableExists('ticket_delivery_attempts') && ! empty($ticketIds)) {
                $this->db->table('ticket_delivery_attempts')
                    ->whereIn('ticket_id', $ticketIds)
                    ->update(['address' => '']);
                $counts['delivery_attempts'] = (int) $this->db->affectedRows();
            }

            // Audit log — clear before/after JSON for entries that
            // referenced this person, but keep the action + actor for
            // legal defensibility (we don't erase the FACT a mutation
            // happened, only the PII that mutation contained).
            if ($this->db->tableExists('admin_audit_log') && ! empty($ticketIds)) {
                $this->db->table('admin_audit_log')
                    ->where('entity_type', 'ticket')
                    ->whereIn('entity_id', $ticketIds)
                    ->update([
                        'before_json' => null,
                        'after_json'  => null,
                    ]);
                $counts['audit_log_entries'] = (int) $this->db->affectedRows();
            }

            if (! $this->db->transCommit()) {
                return $this->respondError('Erase transaction failed.', 500);
            }

            // Write the audit row LAST, AFTER the commit — so even if the
            // erase rolled back the audit doesn't lie. Outside the tx.
            $this->auditErase($personId, 'gdpr.erase', $counts);

            return $this->respondSuccess([
                'person_id'     => $personId,
                'erased_counts' => $counts,
                'erased_at'     => date('c'),
            ]);
        } catch (Throwable $e) {
            try {
                $this->db->transRollback();
            } catch (Throwable $ignore) {
            }
            log_message('error', 'GdprController::erase — ' . $e->getMessage());

            return $this->respondError('Erase failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * @param array<string, mixed> $body
     */
    private function resolvePersonId(array $body): ?int
    {
        if (isset($body['person_id']) && (int) $body['person_id'] > 0) {
            return (int) $body['person_id'];
        }
        $email = trim((string) ($body['email'] ?? ''));
        $phone = trim((string) ($body['phone'] ?? ''));
        if ($email === '' && $phone === '') {
            return null;
        }
        try {
            $builder = $this->db->table('people')->select('person_id');
            if ($email !== '') {
                $builder->where('email', $email);
            }
            if ($phone !== '') {
                $builder->where('phone_number', $phone);
            }
            $row = $builder->limit(1)->get()->getRowArray();

            return $row !== null ? (int) $row['person_id'] : null;
        } catch (Throwable $e) {
            return null;
        }
    }

    /**
     * @return array<string, int>
     */
    private function computeScope(int $personId): array
    {
        $ticketIds = $this->db->tableExists('tickets')
            ? array_column(
                $this->db->table('tickets')->select('ticket_id')->where('customer_id', $personId)->get()->getResultArray(),
                'ticket_id',
            )
            : [];

        return [
            'tickets'           => count($ticketIds),
            'ticket_transfers'  => $this->db->tableExists('ticket_transfers') && $ticketIds !== []
                ? (int) $this->db->table('ticket_transfers')->whereIn('ticket_id', $ticketIds)->countAllResults()
                : 0,
            'delivery_attempts' => $this->db->tableExists('ticket_delivery_attempts') && $ticketIds !== []
                ? (int) $this->db->table('ticket_delivery_attempts')->whereIn('ticket_id', $ticketIds)->countAllResults()
                : 0,
            'audit_log_entries' => $this->db->tableExists('admin_audit_log') && $ticketIds !== []
                ? (int) $this->db->table('admin_audit_log')->where('entity_type', 'ticket')->whereIn('entity_id', $ticketIds)->countAllResults()
                : 0,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchPeople(int $personId): array
    {
        return $this->db->tableExists('people')
            ? $this->db->table('people')->where('person_id', $personId)->get()->getResultArray()
            : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchTickets(int $personId): array
    {
        return $this->db->tableExists('tickets')
            ? $this->db->table('tickets')->where('customer_id', $personId)->get()->getResultArray()
            : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchTransfersForPerson(int $personId): array
    {
        if (! $this->db->tableExists('ticket_transfers') || ! $this->db->tableExists('tickets')) {
            return [];
        }
        $ticketIds = array_column(
            $this->db->table('tickets')->select('ticket_id')->where('customer_id', $personId)->get()->getResultArray(),
            'ticket_id',
        );
        if ($ticketIds === []) {
            return [];
        }

        return $this->db->table('ticket_transfers')->whereIn('ticket_id', $ticketIds)->get()->getResultArray();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchDeliveryAttempts(int $personId): array
    {
        if (! $this->db->tableExists('ticket_delivery_attempts') || ! $this->db->tableExists('tickets')) {
            return [];
        }
        $ticketIds = array_column(
            $this->db->table('tickets')->select('ticket_id')->where('customer_id', $personId)->get()->getResultArray(),
            'ticket_id',
        );
        if ($ticketIds === []) {
            return [];
        }

        return $this->db->table('ticket_delivery_attempts')->whereIn('ticket_id', $ticketIds)->get()->getResultArray();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchAuditEntries(int $personId): array
    {
        if (! $this->db->tableExists('admin_audit_log') || ! $this->db->tableExists('tickets')) {
            return [];
        }
        $ticketIds = array_column(
            $this->db->table('tickets')->select('ticket_id')->where('customer_id', $personId)->get()->getResultArray(),
            'ticket_id',
        );
        if ($ticketIds === []) {
            return [];
        }

        return $this->db->table('admin_audit_log')
            ->where('entity_type', 'ticket')
            ->whereIn('entity_id', $ticketIds)
            ->get()
            ->getResultArray();
    }

    /**
     * Records the GDPR action itself to admin_audit_log so the operation
     * is forensically trackable. Uses entity_type='person' since this is
     * a person-scoped op, not a ticket op.
     *
     * @param array<string, int|string> $metadata
     */
    private function auditErase(int $personId, string $action, array $metadata): void
    {
        try {
            if (! $this->db->tableExists('admin_audit_log')) {
                return;
            }
            $requestId = $GLOBALS['__ospos_rid'] ?? null;
            $this->db->table('admin_audit_log')->insert([
                'entity_type'       => 'person',
                'entity_id'         => $personId,
                'action'            => $action,
                'actor_employee_id' => (int) ($this->session->get('person_id') ?? 0) ?: null,
                'metadata_json'     => json_encode($metadata, JSON_UNESCAPED_SLASHES),
                'ip'                => substr((string) $this->request->getIPAddress(), 0, 64),
                'user_agent'        => substr((string) $this->request->getUserAgent(), 0, 255),
                'request_id'        => is_string($requestId) ? substr($requestId, 0, 64) : null,
            ]);
        } catch (Throwable $e) {
            log_message('warning', 'GdprController::auditErase failed: ' . $e->getMessage());
        }
    }

    /**
     * @param array<string, mixed> $bundle
     * @return array<string, int>
     */
    private function countByKey(array $bundle): array
    {
        $out = [];
        foreach ($bundle as $k => $v) {
            if (is_array($v)) {
                $out[$k] = count($v);
            }
        }

        return $out;
    }
}
