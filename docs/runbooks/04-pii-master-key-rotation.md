# 04 — PII master key rotation

**Goal:** Replace the `pii_master_key` used by `Pii_crypto` to encrypt
admin_audit_log JSON payloads (and any future PII columns wired through
the same primitive).

## When to run

- Annually (industry best practice for symmetric data keys)
- On suspicion of key leak
- After a privileged team member with key access leaves

## Important context

The PII envelope format is `v01.iv.ct.tag` — version-tagged so we can
rotate to `v02` (e.g. different cipher, different key length) later
without breaking existing rows. **Today's `v01` only supports a single
master key at a time** — there is no key-id field, so the rotation is:

1. Decrypt all existing v01 rows with the OLD key
2. Re-encrypt with the NEW key
3. Switch the deployed key

This is fine for `admin_audit_log` (typically thousands of rows,
seconds of work). It would NOT be fine for a million-row PII column —
that needs a key-id field added to the envelope before rotation,
which is a follow-up todo (`ent-pii-key-rotation-id`).

## Rotation procedure (small dataset, <100k rows)

### 1. **🔒 secret — Generate the new key**

```bash
NEW_KEY=$(openssl rand -hex 32)
echo "$NEW_KEY" > /tmp/new-pii-key.hex
chmod 600 /tmp/new-pii-key.hex
```

64 hex chars = 32 raw bytes = AES-256 size.

### 2. **🔒 secret — Stash the old key for the re-encrypt step**

```bash
OLD_KEY=$(docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -se 'SELECT value FROM ospos_app_config WHERE \\\`key\\\`=\"pii_master_key\"'" | tr -d '[:space:]')
echo "$OLD_KEY" > /tmp/old-pii-key.hex
chmod 600 /tmp/old-pii-key.hex
```

If the key was env-only (not in app_config), grab it from the env
config file directly.

### 3. **⚠️ destructive** Run the re-encryption script

This script does the work atomically per-row inside a single
transaction. Read it before running:

```bash
cat <<'EOF' > /tmp/reencrypt-audit.php
<?php
require_once '/app/vendor/autoload.php';
require_once '/app/vendor/codeigniter4/framework/system/Test/bootstrap.php';

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php reencrypt-audit.php <old_hex> <new_hex>\n");
    exit(1);
}
$oldHex = trim($argv[1]);
$newHex = trim($argv[2]);

$old = new \App\Libraries\Pii_crypto();
$new = new \App\Libraries\Pii_crypto();

// Inject the OLD key via env for the read pass
putenv('PII_MASTER_KEY=' . $oldHex);
service('secrets_vault')->flush();
$old->flush();

$db = \Config\Database::connect();
$rows = $db->table('admin_audit_log')
    ->select('audit_id, before_json, after_json, metadata_json')
    ->where("(before_json LIKE 'v01.%' OR after_json LIKE 'v01.%' OR metadata_json LIKE 'v01.%')", null, false)
    ->get()
    ->getResultArray();
fwrite(STDOUT, "Found " . count($rows) . " encrypted rows.\n");

$decrypted = [];
foreach ($rows as $row) {
    $patch = ['audit_id' => $row['audit_id']];
    foreach (['before_json', 'after_json', 'metadata_json'] as $col) {
        $patch[$col . '_plain'] = str_starts_with((string)$row[$col], 'v01.')
            ? $old->decrypt($row[$col])
            : $row[$col];
    }
    $decrypted[] = $patch;
}

// Switch to the NEW key + re-encrypt
putenv('PII_MASTER_KEY=' . $newHex);
service('secrets_vault')->flush();
$new->flush();

$db->transBegin();
foreach ($decrypted as $row) {
    $update = [];
    foreach (['before_json', 'after_json', 'metadata_json'] as $col) {
        $update[$col] = $row[$col . '_plain'] !== null
            ? $new->encrypt($row[$col . '_plain'])
            : null;
    }
    $db->table('admin_audit_log')->where('audit_id', $row['audit_id'])->update($update);
}
if (! $db->transCommit()) {
    fwrite(STDERR, "Re-encrypt transaction FAILED — rolled back.\n");
    exit(2);
}
fwrite(STDOUT, "Re-encrypted " . count($decrypted) . " rows.\n");
EOF

docker compose cp /tmp/reencrypt-audit.php ospos:/tmp/reencrypt-audit.php
docker compose exec -T ospos php /tmp/reencrypt-audit.php "$OLD_KEY" "$NEW_KEY"
```

Expected output:

```
Found 4823 encrypted rows.
Re-encrypted 4823 rows.
```

### 4. Deploy the new key

```bash
# Env-based (preferred)
export PII_MASTER_KEY="$NEW_KEY"
docker compose restart ospos

# OR app_config-based (legacy)
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'UPDATE ospos_app_config SET value=\"$NEW_KEY\" WHERE \`key\`=\"pii_master_key\"'"
```

### 5. Smoke-test

```bash
# Read an audit log entry through the API
curl -s -u admin:pointofsale "http://localhost/index.php/api/admin/audit-log?limit=1" | jq '.data.entries[0]'
# Expect: after_json is a decoded object, not "v01.xxx"
```

If the response shows `"after_json": null` for rows that should have
data, the re-encrypt either failed or the new key is wrong — STOP and
verify against the old key one more time before continuing.

### 6. **🔒 secret — Shred the key files**

```bash
shred -u /tmp/old-pii-key.hex /tmp/new-pii-key.hex
docker compose exec -T ospos rm -f /tmp/reencrypt-audit.php
```

### 7. Audit

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "INSERT INTO ospos_admin_audit_log
    (entity_type, action, metadata_json)
    VALUES (\"pii_master_key\", \"rotate\",
            JSON_OBJECT(\"rotated_at\", NOW(), \"row_count\", <N from step 3 output>))"'
```

## Rollback

If step 5 fails — the new key doesn't decrypt the now-re-encrypted
rows — you'll need to re-run the script with `$newHex` as the old
key and `$oldHex` as the new key. The script is symmetric.

Better: don't deploy the new key (step 4) until step 5 has succeeded
against a copy of the DB. Take a `mysqldump` of `ospos_admin_audit_log`
before step 3, restore if needed.

## Verification checklist

- [ ] Backup of admin_audit_log taken before re-encrypt
- [ ] New key generated and ≥ 32 bytes
- [ ] Re-encrypt script reported equal "Found" and "Re-encrypted" counts
- [ ] Deployed new key via env or app_config
- [ ] Smoke test: API returns decoded JSON, not envelopes
- [ ] Old key and new-key files shredded from disk
- [ ] Audit log entry recorded
- [ ] Calendar reminder set 1 year out
