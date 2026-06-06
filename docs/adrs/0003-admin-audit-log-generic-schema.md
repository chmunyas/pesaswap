# 0003 — Single generic admin_audit_log table over per-entity audit tables

## Status

Accepted (2026-06-06, commit `72f7c436b`)

## Context

Compliance review identified that admin mutations (product CRUD,
ticket revoke/refund, scanner provisioning, GDPR ops) had no
forensic trail beyond CodeIgniter's request log. We needed a
queryable audit store with:

- **Who did what, when** — actor + action + entity + timestamp
- **Before/after row snapshots** — so we can reconstruct the diff
  for incident response
- **Cross-correlation with HTTP logs** — same X-Request-ID across
  audit + access log
- **Per-entity history queries** — "show me everything that ever
  happened to ticket #1234"
- **Actor activity audits** — "show me everything employee #7 did
  on Tuesday"
- **Compliance period exports** — "all privileged actions in Q1"

Two design choices were on the table:

- **Per-entity tables**: `ticket_audit_log`, `ticket_product_audit_log`,
  `scanner_device_audit_log`, etc — typed FKs, narrow schema per
  table
- **Single generic table**: one `admin_audit_log` with
  `entity_type` + `entity_id` discriminator + JSON before/after

## Decision

One generic table: `admin_audit_log` with columns:

```
entity_type      varchar(64)   — 'ticket' | 'ticket_product' | 'scanner_device' | 'person' | ...
entity_id        int           — the affected row id, NULL for global ops
action           varchar(48)   — 'create' | 'update' | 'revoke' | 'refund' | 'gdpr.erase' | ...
actor_employee_id int
actor_scanner_device_id int
before_json      longtext
after_json       longtext
metadata_json    longtext
ip               varchar(64)
user_agent       varchar(255)
request_id       varchar(64)   — joins to access log
created_at       timestamp
```

Five indexes cover the three primary query patterns:

- by entity → `(entity_type, entity_id, created_at)`
- by actor → `(actor_employee_id, created_at)`, `(actor_scanner_device_id, created_at)`
- by time-window → `(action, created_at)`
- by trace-id → `(request_id)`

The `TicketsController::auditLog()` helper is the single write API;
controllers call it after a mutation commits successfully. Failures
to write the audit row are logged at WARN level and never bubble up
— losing an audit row is preferable to losing the customer
transaction.

## Consequences

**Easier:**

- New controllers adopt the audit pattern with one line:
  `$this->auditLog('giftcard', $id, 'topup', $before, $after, ['amount' => 50])`.
  No schema migration per entity.
- Adding new entity types (`scanner_device`, `person` for GDPR,
  future `tenant` for multitenancy) cost zero schema work.
- Cross-entity queries are trivial: "everything done by employee 7"
  doesn't need a `UNION` across five tables.
- The encryption story (see ADR 0005) wraps a single column type
  uniformly — no per-table encrypted/plain divergence.

**Harder:**

- No type safety on the entity_id pointer. A row claiming
  `entity_type='ticket', entity_id=99999` is not FK-enforced. We
  accept this — the audit log is append-only and reads are
  human-driven, so dangling pointers manifest as "no ticket found"
  not as data corruption.
- JSON queries are slower than column queries. Mitigated by:
  reads are infrequent (forensics, not user-facing); the indexes
  cover the discriminator path; `JSON_EXTRACT` is acceptable for
  ad-hoc queries (see runbook 08).
- before/after_json can be large for wide rows. Mitigated by the
  `sanitiseAuditRow()` pre-write helper that strips known-large
  fields (signing keys, password hashes).

## Alternatives considered

- **Per-entity tables.** Better type safety, faster queries on
  scoped columns. Rejected because adoption cost per new entity
  was prohibitive — at ~10 entity types it'd be 10 migrations + 10
  insert helpers + 10 read endpoints, vs. one of each.
- **Off-platform audit sink (CloudTrail-style).** Right answer at
  scale (10k+ writes/second). Today's volume (single-digit per
  minute typical) doesn't justify a separate service.
- **Event sourcing.** Rejected — order-of-magnitude more
  engineering work, and the audit log is a read model, not the
  source of truth for any feature.
