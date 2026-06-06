# 0005 — AES-256-GCM envelope `v01.iv.ct.tag` for at-rest PII

## Status

Accepted (2026-06-06, commits `80b7db573` + `148139a92`)

## Context

The `admin_audit_log` table's `before_json` / `after_json` /
`metadata_json` columns routinely contain copies of customer PII
(email/phone in delivery records, shipping address in product
updates, refund reason text with personal context). DB-only access
to the audit log was effectively DB-only access to historical PII.

We needed encryption-at-rest for this column and (eventually) other
new PII columns, with these constraints:

- **No new schema column** — backward-compatible with installations
  that already have plaintext rows
- **Per-row IV** — same plaintext should NOT produce the same
  ciphertext (rainbow-table resistance, can't observe that two
  customers share an address)
- **Tamper detection** — DB-level corruption should be detectable,
  not silently emit garbage
- **No new PHP dependency** — must work with stock `ext-openssl`
- **Future algorithm rotation** — when AES-GCM eventually gets
  deprecated (post-quantum era), we should be able to roll out
  `v02` without invalidating existing rows

## Decision

Envelope format:

```
v01.<iv_b64u>.<ciphertext_b64u>.<tag_b64u>
```

- `v01` — algorithm + version marker (4 ASCII chars including the dot)
- `iv_b64u` — 12 random bytes (GCM standard, balances IV reuse
  resistance with metadata overhead), URL-safe base64
- `ciphertext_b64u` — `openssl_encrypt(..., AES-256-GCM, ...)` output
- `tag_b64u` — 16-byte GCM authentication tag

Base64URL (RFC 4648 §5) chosen over standard base64 so the envelope
can travel through HTTP headers and URLs unmolested without
percent-encoding the `/` and `+` characters.

The version tag is a 1st-class field. When we rotate to a different
cipher we'll add `v02` decoder support and start writing `v02` on
new rows; old `v01` rows keep working until they're re-encrypted by
a backfill job.

## Consequences

**Easier:**

- One library (`App\Libraries\Pii_crypto`) handles all PII columns;
  callsites are 1-2 lines (`$crypto->encrypt($json)`)
- No schema migration needed to add encryption to a new column —
  the `v01.` prefix is self-identifying. Read-side detects the
  prefix and decrypts; legacy plaintext rows are detected by the
  absence of `v01.` and read as-is. (Pattern used in
  `decodeAuditPayload()`.)
- Tamper detection is automatic — GCM's auth tag fails closed.
  Tampered rows return null instead of plaintext.
- Per-row IV means key compromise doesn't enable known-plaintext
  attacks against other rows.

**Harder:**

- Searchable encrypted columns need a sidecar HMAC column (use
  `Pii_crypto::hashLookup()` — keyed SHA256). Two columns per
  searchable PII field. Same pattern Phase 2 ticket_transfers
  already uses for `to_contact_hash`.
- Key rotation requires re-encrypting all rows (see runbook 04)
  because `v01` has no key-id field. Acceptable for the audit_log
  (typically thousands of rows). Larger PII columns would need a
  `v02` format that includes a `kid` (key-id) field.
- Per-encrypt RNG cost is ~microseconds — negligible vs DB I/O,
  but worth noting for high-throughput paths.

## Alternatives considered

- **MySQL `AES_ENCRYPT()` / `AES_DECRYPT()`.** Rejected — the key
  has to be sent to MySQL in every query, leaking it to general
  query logs and audit trails of the DB itself. Application-side
  crypto keeps the key out of the database entirely.
- **libsodium `crypto_secretbox`.** Cleaner API and faster. Rejected
  because some PHP builds (esp. shared-host environments and CI
  images) don't ship `ext-sodium`. `openssl` is universal.
- **AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC).** The pre-GCM
  standard. Two primitives where one (GCM) suffices, and authentication
  bug-prone if you assemble it yourself.
- **Key in code vs. key in vault.** Trivially rejected — the key
  lives in `Secrets_vault` (ADR 0001), resolved via env > _FILE >
  app_config. Code references a logical key name only.
- **Versionless format** (just `iv.ct.tag`). Rejected — without the
  version tag, a future algorithm change becomes a flag-day rewrite.
- **Whole-table encryption (MariaDB tablespace TDE).** Different
  threat model — protects against backup theft but not against a
  compromised SELECT. Complementary, not a substitute. Document as
  "additionally recommended in production" but don't depend on it.
