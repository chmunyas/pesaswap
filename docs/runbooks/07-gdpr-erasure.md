# 07 — GDPR right-to-erasure SOP

**Goal:** Process a customer's Article 17 erasure request end-to-end
in a way that satisfies GDPR compliance while preserving the legal-
retention obligations of POS data.

## Background

The `/api/admin/gdpr/{lookup,export,erase}` endpoints implement the
**anonymise-but-preserve-ids** pattern:

- PII fields (name, email, phone, address) are replaced with
  tombstones (`ERASED`, `person_<id>@erased.local`, etc)
- Row IDs and amounts are retained so chargeback / tax / audit
  records still make sense
- The audit-log entries that record the original mutations are
  cleared of PII payloads but the action+actor are preserved

GDPR Article 17(3) explicitly permits retention "for the establishment,
exercise or defence of legal claims" — this is the textbook
implementation.

## Pre-erasure checklist (legal / compliance)

Before initiating:

- [ ] Customer's identity verified through the merchant's standard
  identity-verification process (NOT just the request email)
- [ ] Active refund / chargeback windows have closed for all the
  customer's tickets (typical: 60 days; check the merchant agreement)
- [ ] Tax retention obligations satisfied (typical: 7 years —
  anonymisation preserves the row, satisfies this)
- [ ] Erasure request logged in the DPR / DPO ticketing system with
  a request ID for cross-referencing

## Procedure

### 1. Look up the customer's footprint

```bash
# Authenticate as an admin with 'config' permission
curl -s -c /tmp/admin.jar -X POST http://localhost/index.php/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin>","password":"<password>"}'

# Lookup by email
curl -s -b /tmp/admin.jar -X POST http://localhost/index.php/api/admin/gdpr/lookup \
  -H 'Content-Type: application/json' \
  -d '{"email":"<customer email>"}'
```

Response:

```json
{
  "success": true,
  "data": {
    "person_id": 42,
    "scope": {
      "tickets": 3,
      "ticket_transfers": 1,
      "delivery_attempts": 6,
      "audit_log_entries": 9
    }
  }
}
```

Lookup by `phone` or `person_id` also supported. If lookup returns
`{"person_id": null, ...}` the customer doesn't exist in the system —
respond to the request with confirmation that no data is held.

### 2. (Recommended) Export before erasure (DSAR record)

GDPR Article 15 gives customers the right to a copy of their data.
Many regimes treat the export as evidence that the data existed
before erasure:

```bash
curl -s -b /tmp/admin.jar -X POST http://localhost/index.php/api/admin/gdpr/export \
  -H 'Content-Type: application/json' \
  -d '{"person_id":42}' \
  -o "/tmp/dsar_42_$(date +%Y%m%d).json"
```

Send this file to the customer via the same channel they sent the
request from (encrypted email / portal / etc per your DPR policy).

Both `lookup` and `export` write to `admin_audit_log` so the
operation is itself audited.

### 3. **⚠️ destructive** Erase

```bash
curl -s -b /tmp/admin.jar -X POST http://localhost/index.php/api/admin/gdpr/erase \
  -H 'Content-Type: application/json' \
  -d '{"person_id":42, "confirm": true}'
```

Response:

```json
{
  "success": true,
  "data": {
    "person_id": 42,
    "erased_counts": {
      "people": 1,
      "tickets": 3,
      "ticket_transfers": 1,
      "delivery_attempts": 6,
      "audit_log_entries": 9
    },
    "erased_at": "2026-06-06T15:30:00+00:00"
  }
}
```

Without `confirm: true` you get a **412 Precondition Failed** — this
is intentional, treat it as a confirmation prompt.

Refuses to erase `person_id = 1` (returns **409**) — that's the
seeded admin account; reassigning ownership of any data is a separate
manual procedure.

### 4. Verify

```bash
# People row should show tombstones
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT person_id, first_name, last_name, email, phone_number FROM ospos_people WHERE person_id = 42"'
# Expected:
# person_id  first_name  last_name  email                    phone_number
# 42         ERASED      ERASED     person_42@erased.local

# Tickets should still exist (referential integrity preserved) but
# with cleared seat_assignment_json
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT ticket_id, code, customer_id, seat_assignment_json FROM ospos_tickets WHERE customer_id = 42"'

# Audit log should have the gdpr.erase entry
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT created_at, action, actor_employee_id, metadata_json FROM ospos_admin_audit_log WHERE entity_type = \"person\" AND entity_id = 42 ORDER BY audit_id DESC"'
```

### 5. Respond to the customer

Send the customer:

- Confirmation that erasure has been processed
- The export JSON (if step 2 was done)
- A reference to the audit_id from step 4 so they can request
  verification later

### 6. Close the DPR ticket

Attach the audit log row + exported JSON file. Retention of the
DSAR ticket itself: typically 3 years from erasure (varies by
jurisdiction; consult your DPO).

## What's NOT erased

For legal-retention reasons, these are deliberately preserved:

- **Row IDs** (`person_id`, `ticket_id`, `transfer_id` etc) — anchors
  for accounting trails
- **Amounts and payment types** (refund records, sales_payments)
- **Action + actor + IP** in admin_audit_log entries about the
  customer — only the PII payload is nulled; we keep the FACT that
  a mutation happened
- **Aggregated reports** (summary_sales etc) — they include amounts
  from this customer but no longer link back to PII once the people
  row is tombstoned

## Edge cases

### Customer has open disputes / chargebacks

**DO NOT erase.** Article 17(1)(e) excludes erasure when processing
is "necessary for the establishment, exercise or defence of legal
claims." Respond to the customer explaining the dispute must close
first; provide an estimated date.

### Customer is asking about gift-card balance

The gift-card balance is a stored-value financial instrument and is
not personal data per se. Card balances are NOT erased — only the
recipient binding (`giftcard_bindings.contact_hash` etc) is cleared.
The balance remains spendable by anyone with the card code (matches
plastic-gift-card semantics).

### Customer is a Pesaswap employee

Employee records erasure has the same flow but **must** also remove
any active grants and disable the login before tombstoning, otherwise
the dangling employee row keeps appearing in dropdowns. Use:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'DELETE FROM ospos_grants WHERE person_id = <ID>;
    UPDATE ospos_employees SET deleted = 1 WHERE person_id = <ID>'"
```

Then run the standard `/api/admin/gdpr/erase` for the people row.

## Verification checklist

- [ ] Customer identity verified per merchant SOP
- [ ] No open chargebacks / refunds / disputes
- [ ] Export delivered to customer (if requested)
- [ ] `erase` returned success with non-zero `erased_counts.people`
- [ ] People row shows ERASED tombstones in SQL
- [ ] Audit log row exists with `action='gdpr.erase'`
- [ ] DPR ticket closed with audit_id + export file attached
- [ ] Calendar reminder for retention period (3yr typical) of the DSAR record
