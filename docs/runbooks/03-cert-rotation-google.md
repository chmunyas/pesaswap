# 03 — Google Wallet service-account key rotation

**Goal:** Rotate the Google Cloud service-account private key used to
sign Google Wallet `Save-to-Wallet` JWTs.

## When to run

- Annually (Google does not enforce expiry, but rotation is best practice)
- On suspicion of key leak (treat as P0 — passes signed with the leaked
  key can be forged until you rotate AND tell Google to revoke the
  old key via `gcloud iam service-accounts keys delete`)
- After a team member with key access leaves

## What breaks if you skip this

The leaked key remains valid until manually revoked. An attacker can
mint fake Save-to-Wallet URLs for arbitrary tickets — Google Wallet
adds them silently with no user warning.

## Prerequisites

- GCP project access with `iam.serviceAccountKeyAdmin` role
- The current `client_email` value (visible in app_config row
  `ticket_google_service_account_json` → JSON `client_email` field)

## Rotation procedure

### 1. Mint a new key in GCP

```bash
SA_EMAIL="<existing-sa-name>@<project>.iam.gserviceaccount.com"
gcloud iam service-accounts keys create new-google-wallet-key.json \
  --iam-account="$SA_EMAIL"
```

This produces a JSON file with `private_key`, `client_email`, `private_key_id`, etc.

### 2. Validate the new key before deploying

```bash
# Smoke-decode the JSON to make sure it's well-formed
python3 -c "import json; d=json.load(open('new-google-wallet-key.json')); print('client_email:', d['client_email']); print('private_key_id:', d['private_key_id'][:12])"
```

If `client_email` differs from the current one, you're rotating to a
DIFFERENT service account — make sure the new one is registered with
the same Google Wallet Issuer ID in the
[Google Pay & Wallet Console](https://pay.google.com/business/console)
before deploying.

### 3. Deploy via Secrets_vault

Preferred (env or _FILE):

```bash
# Option A: inline (simple)
export TICKET_GOOGLE_SERVICE_ACCOUNT_JSON="$(cat new-google-wallet-key.json)"
# restart container so the env propagates

# Option B: _FILE secret mount (k8s / docker swarm)
# docker-compose secrets entry:
#   google_wallet_key:
#     file: ./secrets/new-google-wallet-key.json
# service entry:
#   environment:
#     TICKET_GOOGLE_SERVICE_ACCOUNT_JSON_FILE: /run/secrets/google_wallet_key
```

Issuer ID rarely rotates; leave `TICKET_GOOGLE_ISSUER_ID` alone unless
you're moving accounts.

### 4. Restart the PHP service

```bash
docker compose restart ospos
```

### 5. Smoke-test the Save-to-Wallet URL

```bash
TICKET_CODE=$(docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -se "SELECT code FROM ospos_tickets WHERE deleted=0 ORDER BY ticket_id DESC LIMIT 1"')
curl -s "http://localhost/index.php/api/public/tickets/$TICKET_CODE/google-wallet" | head -c 200
# Expect a JSON {"save_url": "https://pay.google.com/gp/v/save/eyJ..."}
```

Open the URL in a real Android browser to confirm Wallet accepts the
pass (a 400 from Google means the JWT signed with the new key isn't
recognised — usually a misconfigured Issuer ID).

### 6. **🔒 secret — Revoke the old key in GCP**

This is the critical step — until you do this, the old key is still
valid even though your app has stopped using it.

```bash
# List active keys to find the old key_id
gcloud iam service-accounts keys list \
  --iam-account="$SA_EMAIL" \
  --filter="keyType=USER_MANAGED"

# Delete (revoke) the previous key
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account="$SA_EMAIL"
```

GCP marks the key disabled immediately; propagation to Google Wallet
verifier is < 5 minutes.

### 7. Wipe the new-key JSON from local disk

```bash
shred -u new-google-wallet-key.json
```

### 8. Audit

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "INSERT INTO ospos_admin_audit_log
    (entity_type, action, metadata_json)
    VALUES (\"google_wallet_key\", \"rotate\",
            JSON_OBJECT(\"rotated_at\", NOW(), \"reason\", \"<reason>\"))"'
```

## Rollback

The old key is dead the moment you ran `gcloud ... keys delete` in
step 6. If the new key doesn't work, you have two options:

- **Best**: Mint another new key in GCP (back to step 1)
- **Emergency**: Restore the old key from the offline backup that the
  ops team should maintain (you do maintain this, right?). It will
  NOT work in GCP until you re-import — `gcloud iam service-accounts
  keys upload` only accepts public keys, not private. Realistically,
  always have a SECOND active key during the rotation window.

## Verification checklist

- [ ] New key JSON is in env / _FILE — verified via vault `source()`
- [ ] PHP service restarted
- [ ] Smoke download produces a save_url
- [ ] Old key revoked in GCP
- [ ] Local key file shredded
- [ ] Audit log entry written
- [ ] Calendar reminder set 1 year from rotation date
