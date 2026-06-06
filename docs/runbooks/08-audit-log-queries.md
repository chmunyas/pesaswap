# 08 — Audit log query cookbook

**Goal:** Common SQL + API queries for investigating "who did what,
when, why" using the `admin_audit_log` table and `/api/admin/audit-log`
endpoint.

## Schema reference

```
admin_audit_log
  audit_id                BIGINT PK
  entity_type             VARCHAR(64)   -- 'ticket' | 'ticket_product' | 'scanner_device' | 'person' | ...
  entity_id               INT           -- the affected row id (NULL for global mutations)
  action                  VARCHAR(48)   -- 'create' | 'update' | 'revoke' | 'refund' | 'gdpr.erase' | ...
  actor_employee_id       INT           -- person_id from ospos_employees
  actor_scanner_device_id INT           -- when authenticated via scanner JWT
  before_json             LONGTEXT      -- v01.* envelope or legacy plain JSON, or NULL
  after_json              LONGTEXT      -- same
  metadata_json           LONGTEXT      -- extra context (reason, amounts, etc)
  ip                      VARCHAR(64)
  user_agent              VARCHAR(255)
  request_id              VARCHAR(64)   -- correlates to X-Request-ID
  created_at              TIMESTAMP
```

before/after/metadata JSON columns may be AES-GCM encrypted (envelope
starts with `v01.`) when a master key is configured — use the
`/api/admin/audit-log` HTTP endpoint to get decrypted values, or
decrypt manually via the Pii_crypto library.

## Common queries

### "Who issued ticket #1234?"

```bash
curl -s -b /tmp/admin.jar \
  "http://localhost/index.php/api/admin/audit-log?entity_type=ticket&entity_id=1234"
```

Or SQL:

```sql
SELECT created_at, action, actor_employee_id, ip, request_id
FROM ospos_admin_audit_log
WHERE entity_type = 'ticket' AND entity_id = 1234
ORDER BY created_at;
```

### "What did employee #7 do last Tuesday?"

```bash
curl -s -b /tmp/admin.jar \
  "http://localhost/index.php/api/admin/audit-log?actor_employee_id=7&since=2026-06-02T00:00:00&until=2026-06-03T00:00:00&limit=200"
```

### "Trace one specific X-Request-ID end-to-end"

If a customer report includes the request-id from a response header
or a Sentry event:

```sql
SELECT created_at, entity_type, entity_id, action, actor_employee_id
FROM ospos_admin_audit_log
WHERE request_id = '<UUID>'
ORDER BY audit_id;
```

Cross-reference with the access log:

```bash
grep '<UUID>' writable/logs/access-*.log
```

### "Find every ticket refund in the last 24 hours"

```sql
SELECT created_at, entity_id AS ticket_id, actor_employee_id,
       JSON_EXTRACT(metadata_json, '$.refund_amount') AS refund_amount,
       JSON_EXTRACT(metadata_json, '$.reason') AS reason
FROM ospos_admin_audit_log
WHERE entity_type = 'ticket' AND action = 'refund'
  AND created_at >= NOW() - INTERVAL 1 DAY
ORDER BY created_at DESC;
```

⚠️ **`JSON_EXTRACT` only works on plaintext JSON rows.** If
`metadata_json` starts with `v01.` it's encrypted — use the
`/api/admin/audit-log` HTTP endpoint instead.

### "Who provisioned each scanner device?"

```sql
SELECT a.created_at, a.entity_id AS device_id, a.actor_employee_id,
       e.username AS actor, a.ip
FROM ospos_admin_audit_log a
LEFT JOIN ospos_employees e ON e.person_id = a.actor_employee_id
WHERE a.entity_type = 'scanner_device' AND a.action = 'create'
ORDER BY a.created_at DESC;
```

### "GDPR erasure audit trail for the last quarter"

```sql
SELECT created_at, entity_id AS erased_person_id, actor_employee_id,
       JSON_EXTRACT(metadata_json, '$.people') AS people_n,
       JSON_EXTRACT(metadata_json, '$.tickets') AS tickets_n
FROM ospos_admin_audit_log
WHERE entity_type = 'person' AND action = 'gdpr.erase'
  AND created_at >= NOW() - INTERVAL 3 MONTH
ORDER BY created_at DESC;
```

### "Anomaly: bursts of mutations from one IP"

```sql
SELECT ip, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last,
       GROUP_CONCAT(DISTINCT action) AS actions,
       GROUP_CONCAT(DISTINCT actor_employee_id) AS actors
FROM ospos_admin_audit_log
WHERE created_at >= NOW() - INTERVAL 1 HOUR
GROUP BY ip
HAVING n > 50
ORDER BY n DESC;
```

A single IP with 50+ mutations in an hour is either a bulk-issuance
job (expected — check action=`create`) or a compromised admin
account (unexpected — escalate to security).

### "Compare before / after for one specific change"

If `before_json` and `after_json` are plaintext:

```sql
SELECT JSON_PRETTY(before_json), JSON_PRETTY(after_json)
FROM ospos_admin_audit_log
WHERE audit_id = <ID>;
```

If they're encrypted, use the API:

```bash
curl -s -b /tmp/admin.jar \
  "http://localhost/index.php/api/admin/audit-log?entity_type=ticket&entity_id=<ID>" \
  | jq '.data.entries[] | {action, before: .before_json, after: .after_json}'
```

## Compliance exports

For periodic compliance reviews (PCI / SOC2 / ISO 27001):

```sql
-- All privileged actions in the audit window
SELECT created_at, entity_type, entity_id, action, actor_employee_id, ip
FROM ospos_admin_audit_log
WHERE created_at BETWEEN '<start>' AND '<end>'
ORDER BY created_at
INTO OUTFILE '/tmp/audit_export_<period>.csv'
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\n';
```

Or via the API (paginated):

```bash
SINCE="2026-06-01T00:00:00"
UNTIL="2026-07-01T00:00:00"
curl -s -b /tmp/admin.jar \
  "http://localhost/index.php/api/admin/audit-log?since=$SINCE&until=$UNTIL&limit=500" \
  | jq '.data.entries' > "/tmp/audit_2026-06.json"
```

## Retention

Audit log is **append-only and indefinitely retained** in the default
schema. There is no auto-purge. If your compliance regime mandates
deletion of audit records older than N years:

```sql
-- DESTRUCTIVE — read your retention policy first
DELETE FROM ospos_admin_audit_log
WHERE created_at < NOW() - INTERVAL 7 YEAR;
```

Recommended: take a `mysqldump` of the rows being deleted into
cold-storage backup first.
