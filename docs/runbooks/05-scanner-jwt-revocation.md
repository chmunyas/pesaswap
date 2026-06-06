# 05 — Scanner JWT revocation

**Goal:** Immediately revoke a lost / stolen / decommissioned gate
scanner device so its issued JWT can no longer be used to redeem
tickets.

## Background

Each scanner device row in `ospos_ticket_scanner_devices` stores a
`jti` (JWT ID) that's embedded in the RS256 token. On every redeem
attempt the controller looks up the jti and refuses with **401** if
`revoked_at IS NOT NULL`. Revocation is therefore atomic and takes
effect on the next scan attempt.

The JWT itself stays cryptographically valid until its `exp` (default
90 days from provisioning) — revocation is server-side bookkeeping
only. **Do not assume the bare JWT signature failing == revoked**;
verify against the DB row.

## When to run

- Scanner phone/tablet **lost or stolen** — P0 emergency, do this within minutes
- Scanner is being **decommissioned** or replaced
- Suspicion of token leak from a logfile / screenshot / Slack message
- Routine annual hygiene rotation

## Procedure

### 1. Identify the device

If you know the label:

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT device_id, label, last_seen_at, last_seen_ip, revoked_at FROM ospos_ticket_scanner_devices ORDER BY device_id"'
```

If you know the IP the device was last seen on (incident response):

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'SELECT * FROM ospos_ticket_scanner_devices WHERE last_seen_ip=\"<IP>\"'"
```

### 2. Revoke via API (preferred — writes audit log)

```bash
# Login as admin first
curl -s -c /tmp/admin.jar -X POST http://localhost/index.php/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin>","password":"<password>"}'

# Revoke with a reason
curl -s -b /tmp/admin.jar -X POST \
  "http://localhost/index.php/api/tickets/scanner-devices/<DEVICE_ID>/revoke" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Lost at venue, reported 2026-06-06 14:23"}'
# Expect: {"success":true,"data":{"device_id":N}}
```

This writes an `scanner_device / revoke` row to `admin_audit_log`
with the actor employee_id, IP, user-agent, and X-Request-ID for
forensics.

### 3. Revoke via SQL (fallback if API is down)

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'UPDATE ospos_ticket_scanner_devices
    SET revoked_at = NOW(),
        revoked_reason = \"<reason>\"
    WHERE device_id = <DEVICE_ID>'"
```

⚠️ This path SKIPS the audit log — manually insert an audit row:

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "INSERT INTO ospos_admin_audit_log
    (entity_type, entity_id, action, actor_employee_id, metadata_json)
    VALUES (\"scanner_device\", <DEVICE_ID>, \"revoke\", <YOUR_PERSON_ID>,
            JSON_OBJECT(\"path\", \"manual_sql_fallback\", \"reason\", \"<reason>\"))"'
```

### 4. Verify revocation took effect

Attempt a redeem with the revoked JWT (if you have a copy):

```bash
curl -s -X POST http://localhost/index.php/api/tickets/redeem \
  -H "Authorization: Bearer <REVOKED_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"token":"any-ticket-code"}'
# Expect: {"success":false,"message":"Scanner token invalid, revoked, or expired."}
```

### 5. (If lost device) Provision a replacement

```bash
curl -s -b /tmp/admin.jar -X POST http://localhost/index.php/api/tickets/scanner-devices \
  -H 'Content-Type: application/json' \
  -d '{"label":"Gate A replacement (2026-06-06)","ttl_days":90}'
# Response includes "token": "...." — this is shown ONCE.
# Configure the new device with this token immediately.
```

### 6. Document the incident

Add to your incident-response log:

- Device ID + label
- Suspected leak vector (lost, stolen, screenshot, etc)
- Time of revocation
- New device ID (if replacement was provisioned)
- Any redemptions that happened on the revoked JWT before revocation
  (query below)

```sql
-- Redemptions performed by the revoked device after the suspected leak time
SELECT r.redemption_id, r.ticket_id, r.created_at, t.code
FROM ospos_ticket_redemptions r
JOIN ospos_tickets t ON t.ticket_id = r.ticket_id
JOIN ospos_admin_audit_log a ON a.metadata_json LIKE CONCAT('%device_id%:%', <DEVICE_ID>, '%')
WHERE r.created_at >= '<suspected_leak_time>'
ORDER BY r.created_at;
```

## Verification checklist

- [ ] `revoked_at` is non-NULL on the device row
- [ ] `admin_audit_log` has a `revoke` entry for the device
- [ ] Test redeem with the revoked JWT returns 401
- [ ] Replacement device provisioned (if applicable)
- [ ] Incident logged in ops journal
