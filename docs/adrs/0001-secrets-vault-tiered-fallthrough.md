# 0001 — Secrets_vault tiered fallthrough (env > _FILE > app_config)

## Status

Accepted (2026-06-06, commit `0a1a36b6e`)

## Context

Wallet credentials (Apple Pass Type ID cert + private key, Google
service-account JSON, HMAC keys for webhooks, scanner JWT signing
key, PII master key) were originally stored as plaintext rows in
the `app_config` table.

Three problems with that:

1. **Backup blast radius** — every nightly mysqldump shipped a copy
   of every credential. A leaked backup = credential rotation across
   the board.
2. **DB-admin read access** — any user with SELECT on app_config
   could grab the keys. PCI/SOC2 require credential access be
   limited to the specific roles that need it.
3. **No deployment story** — there was no way to provision a fresh
   install with credentials without running INSERT statements,
   which doesn't fit the standard k8s Secret / Docker swarm secret
   / systemd LoadCredential workflow that ops teams expect.

We needed a path forward that:

- Worked with Docker/k8s/systemd's `secret-mount-as-file` pattern
- Didn't break the existing app_config-stored installations
- Was a single chokepoint that could later grow a HashiCorp Vault /
  AWS Secrets Manager / GCP Secret Manager adapter

## Decision

Introduce `App\Libraries\Secrets_vault::get($logical_key)` that
resolves through three tiers, first match wins:

1. Direct env var (UPPERCASE_SNAKE), e.g. `pii_master_key` →
   `$PII_MASTER_KEY`
2. `*_FILE` pointer env var holding a path to a readable file —
   matches the docker swarm secrets / k8s `projected.sources.secret`
   / systemd `LoadCredential` convention. Reads `file_get_contents()`
   and trims trailing newline.
3. Legacy `app_config[key]` row (the historical storage)

All wallet libs and any new credential consumer route through this
helper. Per-request memo cache prevents repeated I/O within one
HTTP request.

## Consequences

**Easier:**

- Operators can rotate creds by setting env without touching the DB
- Docker swarm / k8s secret rotation works out of the box
- Existing installations keep working — the legacy path is the
  bottom tier, unchanged
- A diagnostic `->source()` method tells operators which tier
  resolved each key without ever returning the value
- Future HashiCorp Vault adapter is a 50-line addition between
  tiers 2 and 3 — no callsite changes needed

**Harder:**

- One more layer of indirection between "where is the secret" and
  "what code reads it". Mitigated by the `->source()` helper +
  ent-runbooks-04 documenting the rotation flow.
- Per-request caching means in-process credential rotation needs
  a `->flush()` call (used in tests, also necessary in a hypothetical
  long-lived worker that watches for vault updates)

## Alternatives considered

- **Env vars only, no file/DB fallback.** Rejected — would force
  every existing installation to migrate immediately. The tiered
  design lets us deprecate the DB path on a slower schedule.
- **Encrypt the app_config rows.** Rejected — solves the backup
  leak but not the DB-admin-read problem (the encryption key still
  has to live somewhere). Punts the question rather than answering it.
- **Direct integration with HashiCorp Vault from the start.**
  Rejected — too heavyweight for small/mid-market installations that
  don't run Vault. The tier 4 slot is reserved for this when we have
  customer demand.
