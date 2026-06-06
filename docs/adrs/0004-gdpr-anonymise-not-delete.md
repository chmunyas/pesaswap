# 0004 — GDPR right-to-erasure as anonymisation, preserving row IDs

## Status

Accepted (2026-06-06, commit `cb7949489`)

## Context

GDPR Article 17 ("right to erasure") grants individuals the right to
have their personal data deleted. In a POS context this collides
with several competing obligations:

- **Tax retention** — most jurisdictions require sale records to be
  kept for 5-10 years
- **Chargeback / dispute windows** — typically 60-180 days post-sale,
  during which the transaction record (linked to the customer) must
  remain auditable
- **AML / fraud investigation** — beneficial-owner records, sometimes
  retained indefinitely under regulator order
- **Internal audit trail** — admin_audit_log entries that reference
  customer IDs

Article 17(3) explicitly allows retention "for the establishment,
exercise or defence of legal claims" — the deletion right is not
absolute.

Two patterns are common in the industry:

- **Hard delete** — `DELETE FROM ospos_people WHERE person_id = X;` +
  cascade. Simple to verify ("the row is gone"), but breaks referential
  integrity on retained-for-legal rows. Tax records that reference a
  deleted person_id become orphans.
- **Anonymise** — replace PII fields with tombstones (e.g.
  `first_name='ERASED'`, `email='person_42@erased.local'`), keep the
  row ID and amounts. Preserves referential integrity; the row is no
  longer personal data.

## Decision

Anonymise. Specifically, in `POST /api/admin/gdpr/erase`:

- `ospos_people` row: name → `'ERASED'`, email → `person_<id>@erased.local`,
  phone/address fields → `''`, comments → `'Erased under GDPR Art. 17 on <ts>'`
- `ospos_tickets.seat_assignment_json` → NULL (the only free-form
  ticket field that can contain PII)
- `ospos_ticket_transfers.{to_contact_last4, ip, user_agent}` → NULL
  (the hashes themselves are not PII per the GDPR Recital 26 test;
  the last4 + IP + UA together could enable re-identification)
- `ospos_ticket_delivery_attempts.address` → `''`
- `ospos_admin_audit_log` entries about tickets owned by this person:
  `before_json` + `after_json` → NULL (preserving action + actor + IP
  for legal defensibility)

The operation is **idempotent**: re-running on an already-tombstoned
person returns the same shape with all counts = 0.

Two guardrails:

- Requires `confirm: true` in the body (412 otherwise) — prevents
  accidental destruction
- Refuses `person_id = 1` (409) — the seeded admin is the
  last-resort recovery account, deletion would lock the merchant out

The operation itself writes to `admin_audit_log` — the FACT of an
erasure is preserved even when the PII is gone.

## Consequences

**Easier:**

- Referential integrity preserved across tickets, transfers, audit
  log entries — no orphan rows
- Tax records survive (amounts + dates remain queryable)
- The audit log remains queryable for compliance review even
  post-erasure ("yes, this employee did issue a ticket for this
  customer ID, on this date, for this amount — we just no longer
  know who the customer was")
- Re-running the erase op is safe — useful in incident response
  when the operator isn't sure whether the last attempt succeeded

**Harder:**

- The row count in `ospos_people` doesn't decrease. Compliance
  reviewers used to "where did the record go" need to see the
  ERASED tombstone (documented in runbook 07).
- The customer's `person_id` is still in any export the merchant
  has previously made (CSVs, BI extracts) — those need to be
  separately scrubbed; we can't reach them.
- A future audit of "have we deleted all PII for person 42?" must
  check the column values (name='ERASED', etc), not the row count.

## Alternatives considered

- **Hard delete + CASCADE.** Rejected — breaks tax retention; orphans
  rows in admin_audit_log that we DO need to keep for legal claims.
- **Hard delete + manual replacement with system "anonymous"
  person_id=0 in dependents.** Considered. Rejected because every
  dependent column needs to know about the swap, and tickets owned
  by "anonymous" become unattributable in retroactive analysis.
- **Crypto-shredding** (encrypt PII at rest, delete the per-customer
  key on erasure). Right answer for column-level PII with
  per-row keys. Too heavyweight for the current PII surface; ticket
  ent-pii-key-rotation-id is the prerequisite.
- **Soft delete only** (set `deleted=1`, keep PII). Rejected
  outright — that's the OPPOSITE of erasure, fails the article 17
  intent entirely.
