# 06 — Webhook DLQ recovery

**Goal:** Diagnose and recover from a backlog of failed / bounced
webhook deliveries.

## Background

`tickets:dispatch-webhooks` retries with exponential backoff (1m, 5m,
15m, 1h, 6h, 24h — last value sticky), bounces after **8 attempts**
OR on HTTP 410 Gone. Bounced rows stay in the table as a dead-letter
queue (DLQ) record — they're never auto-retried but can be manually
replayed once the receiver is back up.

## When to run

- Alert from `ospos_ticket_delivery_attempts` Prometheus metric showing
  large `status="failed"` or `status="bounced"` count growth
- Customer complaint: "we're not getting your webhooks"
- Maintenance window on a subscriber side, deliberate replay needed

## Diagnostic queries

### How big is the DLQ?

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT status, COUNT(*) AS n FROM ospos_webhook_deliveries GROUP BY status"'
```

### Which subscription is failing?

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT s.label, s.target_url, d.status, COUNT(*) AS n,
    MAX(d.last_response_code) AS recent_code, MAX(d.last_attempt_at) AS recent_at
    FROM ospos_webhook_deliveries d
    JOIN ospos_webhook_subscriptions s ON s.subscription_id = d.subscription_id
    WHERE d.status IN (\"failed\", \"bounced\")
    GROUP BY s.subscription_id, d.status
    ORDER BY n DESC LIMIT 20"'
```

### What's the recent error look like?

```bash
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT delivery_id, event, status, attempts,
    last_response_code, LEFT(last_response_body, 200) AS body_preview
    FROM ospos_webhook_deliveries
    WHERE subscription_id = <SUB_ID> AND status IN (\"failed\", \"bounced\")
    ORDER BY delivery_id DESC LIMIT 10"'
```

## Recovery scenarios

### Scenario A: Subscriber temporarily down, now fixed

Reset all bounced rows for this subscription back to `queued` with
attempts=0 so the next cron tick picks them up:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'UPDATE ospos_webhook_deliveries
    SET status = \"queued\", attempts = 0, next_attempt_at = NOW(),
        last_response_body = CONCAT(\"manually_replayed_at \", NOW(), \"; \", IFNULL(last_response_body, \"\"))
    WHERE subscription_id = <SUB_ID> AND status IN (\"failed\", \"bounced\")'"

# Trigger immediate processing (instead of waiting for cron):
docker compose exec -T ospos php spark tickets:dispatch-webhooks
```

### Scenario B: Subscriber misconfigured (wrong URL / secret)

Update the subscription, then replay as in A:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'UPDATE ospos_webhook_subscriptions
    SET target_url = \"<new url>\",
        secret_vault_key = \"<new key>\"
    WHERE subscription_id = <SUB_ID>'"
```

If the new secret needs to be added to the vault:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'INSERT INTO ospos_app_config (\`key\`, value)
    VALUES (\"<new key>\", \"<actual secret>\")
    ON DUPLICATE KEY UPDATE value = VALUES(value)'"
```

Then run scenario A's replay.

### Scenario C: Subscriber permanently gone

Pause the subscription so future events stop accumulating into the DLQ:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'UPDATE ospos_webhook_subscriptions
    SET active = 0
    WHERE subscription_id = <SUB_ID>'"
```

Optionally clear the existing DLQ for this subscription:

```bash
docker compose exec -T mysql sh -c \
  "mysql -uadmin -ppointofsale ospos -e 'DELETE FROM ospos_webhook_deliveries
    WHERE subscription_id = <SUB_ID> AND status IN (\"failed\", \"bounced\")'"
```

### Scenario D: One specific event needs to be re-emitted (not replay)

If the original publish was lost (e.g. database crash mid-transaction)
and the original ticket lifecycle event needs to be re-broadcast:

```bash
# Look up the original payload from admin_audit_log
docker compose exec -T mysql sh -c \
  'mysql -uadmin -ppointofsale ospos -e "SELECT after_json FROM ospos_admin_audit_log
    WHERE entity_type = \"ticket\" AND entity_id = <TICKET_ID> AND action = \"issue\""'

# Then publish from PHP:
docker compose cp - ospos:/tmp/republish.php << 'EOF'
<?php
require_once '/app/vendor/autoload.php';
require_once '/app/vendor/codeigniter4/framework/system/Test/bootstrap.php';
$n = service('webhook_dispatcher')->publish('ticket.issued', [
    'ticket_id'  => <TICKET_ID>,
    'code'       => '<CODE>',
    'manual_republish' => true,
]);
echo "enqueued $n delivery rows\n";
EOF
docker compose exec -T ospos php /tmp/republish.php
docker compose exec -T ospos rm /tmp/republish.php
```

Then run `php spark tickets:dispatch-webhooks` to flush them out.

## Monitoring + alerting

Set Prometheus alerts on:

```
# DLQ growth alarm
sum(ospos_ticket_delivery_attempts{status="bounced"}) > 100

# Sustained retry-loop alarm
sum(rate(ospos_ticket_delivery_attempts{status="failed"}[5m])) > 1
```

These mean either a subscriber is down or our signing key was rotated
without updating the subscriber.

## Verification checklist

- [ ] Root cause of failures identified from `last_response_body` column
- [ ] Subscription paused (if scenario C) or fixed (B)
- [ ] DLQ rows replayed (A/B) OR cleared (C)
- [ ] `tickets:dispatch-webhooks` run once to flush queue
- [ ] Prometheus shows DLQ count returning to baseline within ~15 min
- [ ] Incident logged with timeline + scenario + count of rows touched
