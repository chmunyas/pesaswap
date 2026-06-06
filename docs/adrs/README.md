# Architecture Decision Records

This directory uses the Michael Nygard ADR template — see
<https://github.com/joelparkerhenderson/architecture-decision-record>
for the format reference.

Each ADR captures the **context** + **decision** + **consequences** of
a single architectural choice. ADRs are immutable — when a decision
is later reversed, write a new ADR that supersedes the old one rather
than editing in place.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-secrets-vault-tiered-fallthrough.md) | Secrets_vault tiered fallthrough (env > _FILE > app_config) | Accepted |
| [0002](0002-redirectexception-over-header-exit.md) | RedirectException over header()+exit() in Secure_Controller | Accepted |
| [0003](0003-admin-audit-log-generic-schema.md) | Single generic admin_audit_log table over per-entity audit tables | Accepted |
| [0004](0004-gdpr-anonymise-not-delete.md) | GDPR right-to-erasure as anonymisation, preserving row IDs | Accepted |
| [0005](0005-pii-crypto-envelope-format.md) | AES-256-GCM envelope `v01.iv.ct.tag` for at-rest PII | Accepted |
| [0006](0006-cron-pipeline-three-sparks.md) | Three cooperating spark commands (cleanup ⇄ retry ⇄ webhook) over one mega-worker | Accepted |
| [0007](0007-x-request-id-correlation.md) | X-Request-ID propagation via $GLOBALS for filter→filter handoff | Accepted |
| [0008](0008-scanner-jwt-vs-session.md) | Scanner JWT auth coexisting with session auth on /tickets/redeem | Accepted |

## How to write a new ADR

```
0009-short-imperative-title.md
```

Sections (omit any that aren't relevant):

1. **Status** — Proposed | Accepted | Deprecated | Superseded by #NNNN
2. **Context** — what problem are we solving, what constraints exist
3. **Decision** — what we're doing, in 1-2 sentences
4. **Consequences** — what becomes easier, what becomes harder
5. **Alternatives considered** — what we explicitly rejected and why

Keep ADRs short — 1-2 pages. Long-form design docs go in `docs/design/`.
