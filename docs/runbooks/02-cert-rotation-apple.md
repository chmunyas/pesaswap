# 02 — Apple Pass Type ID cert rotation

**Goal:** Replace the Apple Pass Type ID certificate used to sign
`.pkpass` bundles. Required when:

- The cert is approaching its **1-year expiry** (Apple's standard validity)
- The cert key has been **leaked** (treat as immediate emergency)
- Apple has revoked the cert (rare; happens on developer-account suspension)

## What breaks if the cert expires

**Existing issued passes keep working in Apple Wallet** — the
signature was verified at install time and Apple does not re-check.

**New `.pkpass` downloads fail** with `RuntimeException: Apple Wallet
is not configured` (the loader rejects an expired cert as malformed).

## Prerequisites

- Apple Developer Program admin access for the issuing team
- Pass Type ID matching `ticket_apple_pass_type_id` in app_config or
  `TICKET_APPLE_PASS_TYPE_ID` env
- Local OpenSSL ≥ 1.1.1

## Rotation procedure

### 1. Generate a new Pass Type ID signing cert in Apple Developer

1. Sign in at <https://developer.apple.com/account/>
2. Certificates → Pass Type IDs → select the Pass Type ID matching
   the deployment (e.g. `pass.com.pesaswap.tickets`)
3. Click **Create Certificate** → **Pass Type ID Certificate**
4. Generate a CSR locally:
   ```bash
   openssl genrsa -out new-pass-key.pem 2048
   openssl req -new -key new-pass-key.pem -out new-pass.csr \
     -subj "/C=US/CN=Pesaswap Tickets/[email protected]"
   ```
5. Upload `new-pass.csr`, download `pass.cer` from Apple
6. Convert to PEM:
   ```bash
   openssl x509 -in pass.cer -inform DER -out new-pass-cert.pem
   ```

### 2. Get the WWDR intermediate (rarely changes, but check)

Download from <https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer>
and convert:

```bash
openssl x509 -in AppleWWDRCAG3.cer -inform DER -out wwdr.pem
```

### 3. Deploy via the Secrets_vault (preferred: env or _FILE)

Set the env variables on the runtime container — typically via
docker-compose.override.yml, k8s Secret, or systemd LoadCredential:

```bash
# Option A: inline env vars (simple, single-node)
docker compose exec ospos sh -c '
  export TICKET_APPLE_PASS_CERT_PEM="$(cat /path/to/new-pass-cert.pem)"
  export TICKET_APPLE_PASS_KEY_PEM="$(cat /path/to/new-pass-key.pem)"
  export TICKET_APPLE_WWDR_CERT_PEM="$(cat /path/to/wwdr.pem)"
'

# Option B: _FILE pointers (Docker swarm / k8s secrets mount)
# Add to docker-compose.yml under the ospos service:
#   secrets:
#     - apple_pass_cert
#     - apple_pass_key
#     - apple_wwdr_cert
#   environment:
#     TICKET_APPLE_PASS_CERT_PEM_FILE: /run/secrets/apple_pass_cert
#     TICKET_APPLE_PASS_KEY_PEM_FILE: /run/secrets/apple_pass_key
#     TICKET_APPLE_WWDR_CERT_PEM_FILE: /run/secrets/apple_wwdr_cert
```

The Secrets_vault resolves env > _FILE > app_config. Setting env wins
even if a stale value is still in app_config (no DB cleanup required
during rotation — do that as a follow-up).

### 4. (Legacy install) Update via SQL if not using env

```sql
UPDATE ospos_app_config SET value = ?
  WHERE `key` = 'ticket_apple_pass_cert_pem';
UPDATE ospos_app_config SET value = ?
  WHERE `key` = 'ticket_apple_pass_key_pem';
```

Bind PEM contents in the `?` slots — do NOT inline them in shell.

### 5. Restart the PHP service to pick up new env

```bash
docker compose restart ospos
```

### 6. Smoke test

```bash
# Find a recent ticket code
TICKET_CODE=$(docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -se "SELECT code FROM ospos_tickets WHERE deleted=0 ORDER BY ticket_id DESC LIMIT 1"')

# Download a fresh pkpass
curl -s -o /tmp/test.pkpass "http://localhost/index.php/api/public/tickets/$TICKET_CODE/apple-wallet"
file /tmp/test.pkpass
# Expected: /tmp/test.pkpass: Zip archive data
```

If the response is JSON with `"success":false`, check
`writable/logs/log-*.php` for the actual error.

### 7. Audit the rotation

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "INSERT INTO ospos_admin_audit_log
    (entity_type, entity_id, action, metadata_json)
    VALUES (\"apple_pass_cert\", NULL, \"rotate\",
            JSON_OBJECT(\"rotated_at\", NOW(), \"reason\", \"<reason>\"))"'
```

## Rollback

If new cert causes pkpass downloads to fail across the board:

```bash
# Unset the new env vars (or revert k8s Secret), restart
docker compose exec ospos sh -c 'unset TICKET_APPLE_PASS_CERT_PEM TICKET_APPLE_PASS_KEY_PEM'
docker compose restart ospos
```

This falls back to the original `app_config` values (if those are
still present) or to "Apple Wallet not configured" (if the install
was env-only and you just clobbered both).

## Verification checklist

- [ ] New cert is in env / _FILE / app_config — verified via `service('secrets_vault')->source('ticket_apple_pass_cert_pem')`
- [ ] PHP service restarted
- [ ] Smoke test downloads a valid zip
- [ ] Audit log entry written
- [ ] Old cert removed from app_config (optional but recommended)
- [ ] Calendar reminder set 30 days before new cert's expiry
