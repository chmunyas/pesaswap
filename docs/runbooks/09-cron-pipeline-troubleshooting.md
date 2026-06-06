# 09 — Cron pipeline troubleshooting

**Goal:** Restore the three-spark pipeline (cleanup ⇄ retry-deliveries
⇄ dispatch-webhooks) when it's stalled, stuck in a loop, or producing
unexpected counts.

## The pipeline at a glance

```
                                     ┌─────────────────────┐
                                     │ tickets:cleanup     │  hourly
                                     │  - releases expired │
                                     │    seat_holds       │
                                     │  - bounces stuck    │
                                     │    failed deliveries│
                                     │  - expires unused   │
                                     │    transfer tokens  │
                                     └──────────┬──────────┘
                                                │
ticketIssue → enqueues delivery row             ▼
       │                            ┌───────────────────────┐
       │                            │ ticket_delivery_      │
       └────────────────────────────┤ attempts table        │
                                    │                       │
                            ┌──────►│ status='queued'/...   │◄────────┐
                            │       └──────────┬────────────┘         │
                            │                  │ every 5 min          │
                            │       ┌──────────▼────────────┐         │
                            │       │ tickets:retry-        │         │
                            │       │   deliveries          │         │
                            │       │  - retryRow() in-place│         │
                            │       │  - increments attempts│         │
                            │       │  - flips status       │         │
                            └────── └──────────┬────────────┘         │
                                               │                      │
                                               │ if attempts >= max   │
                                               │    OR aged > ttl     │
                                               └──── tickets:cleanup ─┘

ticketIssue/refund/revoke → webhook_dispatcher.publish() enqueues
                                ┌──────────────────────┐
                                │ webhook_deliveries   │
                                │ status='queued'/...  │  every 1 min
                                └──────────┬───────────┘
                                           │
                                ┌──────────▼─────────────┐
                                │ tickets:dispatch-      │
                                │   webhooks             │
                                │  - HMAC sign + POST    │
                                │  - exponential backoff │
                                │  - bounce on 410 / max │
                                └────────────────────────┘
```

## Symptom checklist

### "tickets:retry-deliveries reports `considered=0` but rows are stuck"

Check the rate-limit filter (`--min-age`):

```sql
SELECT status, attempts, last_attempt_at, NOW() AS now_ts,
       TIMESTAMPDIFF(MINUTE, last_attempt_at, NOW()) AS age_min
FROM ospos_ticket_delivery_attempts
WHERE status IN ('queued', 'failed') AND attempts < 5
LIMIT 10;
```

Rows whose `age_min < 5` (the default `--min-age`) are skipped. Either
wait, or force:

```bash
docker compose exec -T ospos php spark tickets:retry-deliveries --min-age 0
```

### "tickets:dispatch-webhooks reports `considered=0` but rows have status='failed'"

`next_attempt_at` must be in the past. After a few failures the
exponential backoff pushes it hours into the future:

```sql
SELECT delivery_id, status, attempts, last_attempt_at, next_attempt_at,
       TIMESTAMPDIFF(MINUTE, NOW(), next_attempt_at) AS minutes_until_retry
FROM ospos_webhook_deliveries
WHERE status IN ('queued', 'failed')
ORDER BY next_attempt_at;
```

To force an immediate retry of one row (skip the backoff):

```sql
UPDATE ospos_webhook_deliveries
SET next_attempt_at = NOW()
WHERE delivery_id = <ID>;
```

### "Cron spark fires but no rows ever flip to 'sent'"

Check the transport actually works:

```bash
# Email — sendmail must be installed in the container
docker compose exec ospos which sendmail
# Webhook — check curl connectivity from inside the container
docker compose exec -T ospos curl -sI https://httpbin.org/post
```

If `which sendmail` returns nothing, that's a packaging issue — the
production container needs `apt-get install -y exim4-base` or similar.
Same applies to TLS roots for HTTPS webhooks.

### "Cron isn't running at all"

Verify the schedule:

```bash
# On the host system
crontab -l | grep -E 'tickets:|ospos'
```

Expected entries (adjust paths for your install):

```
*/5 * * * * docker exec ospos_dev php /app/spark tickets:retry-deliveries  >> /var/log/ospos-retry.log 2>&1
0   * * * * docker exec ospos_dev php /app/spark tickets:cleanup           >> /var/log/ospos-cleanup.log 2>&1
*/1 * * * * docker exec ospos_dev php /app/spark tickets:dispatch-webhooks >> /var/log/ospos-webhook.log 2>&1
```

Check logs for the most recent run:

```bash
tail -5 /var/log/ospos-cleanup.log
```

### "Workers exit immediately with 'Shutdown signalled'"

The `Graceful_shutdown` lockfile is present. Either you're in the
middle of a deploy drain (expected) or it was left behind from a
prior drain that wasn't cleaned up.

```bash
# Check
docker compose exec -T ospos ls -la writable/runtime/shutdown.lock

# Remove if appropriate
docker compose exec -T ospos rm -f writable/runtime/shutdown.lock
```

See [`01-deploy-drain.md`](01-deploy-drain.md) for the full drain
procedure.

### "Worker says 'migration is required.'"

The 3.4.x ticket-related migrations haven't been run yet. Catch up:

```bash
docker compose exec -T ospos php spark migrate
```

## Manual one-off jobs

### Run cleanup with custom thresholds

```bash
# Bounce delivery attempts more aggressively (3 attempts vs default 5)
docker compose exec -T ospos php spark tickets:cleanup --max-retries 3

# Bounce after 6 hours stale vs default 24
docker compose exec -T ospos php spark tickets:cleanup --failed-ttl 6

# Larger batch for catch-up after long downtime
docker compose exec -T ospos php spark tickets:cleanup --limit 5000
```

### Dry-run retry to see what WOULD happen

```bash
docker compose exec -T ospos php spark tickets:retry-deliveries --dry-run --min-age 0
```

Prints the rows that would be processed without actually calling
SMTP / SMS / HTTP.

### Replay one specific webhook delivery

```sql
UPDATE ospos_webhook_deliveries
SET status = 'queued', attempts = 0, next_attempt_at = NOW()
WHERE delivery_id = <ID>;
```

Then trigger:

```bash
docker compose exec -T ospos php spark tickets:dispatch-webhooks --limit 1
```

## Health metrics

Set Prometheus alerts on these (assuming `/api/metrics` is wired up):

```
# Cleanup not running
absent(ospos_seat_holds_active)
absent(ospos_ticket_delivery_attempts)

# DLQ growth
sum(ospos_ticket_delivery_attempts{status="bounced"}) > 100
sum(ospos_ticket_delivery_attempts{status="failed"}) > 50

# Workers haven't processed anything recently
# (compute via job_last_success_unix metric from a wrapper script
#  that records `date +%s` after each spark run)
```

## Verification checklist

After resolving any of the symptoms above:

- [ ] Spark command runs to completion without errors
- [ ] Affected row counts moved in the expected direction
- [ ] Prometheus metric returns to baseline within 15 min
- [ ] No `writable/runtime/shutdown.lock` accidentally left behind
- [ ] Incident logged in ops journal if it was an actual outage
