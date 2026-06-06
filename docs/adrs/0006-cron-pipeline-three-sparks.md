# 0006 — Three cooperating spark commands over one mega-worker

## Status

Accepted (2026-06-06, commits `c64fe9c19` + `429866f60` + `f6ef9144c`)

## Context

We needed background processing for three orthogonal pipelines:

- **Cleanup**: expired seat holds, stuck failed deliveries, expired
  transfer tokens
- **Delivery retry**: re-attempt email/SMS sends that previously
  failed
- **Webhook dispatch**: POST signed payloads to subscriber URLs,
  retry on failure with exponential backoff

Two design directions:

- **One unified worker** (`php spark tickets:worker` or similar) that
  runs all three jobs on a tick — easier to orchestrate, single
  cron entry, single log
- **Three cooperating spark commands** — each runs independently on
  its own cron schedule

Adjacent constraints:

- Cron is the deployment scheduler (Docker installs, no Kubernetes
  CronJob assumption)
- Workers must honor graceful shutdown (ADR-implicit) so deploys
  drain cleanly
- Each pipeline has materially different cadence requirements:
  - Cleanup is **idempotent** and cheap — fine to run hourly
  - Retry needs to respect a **--min-age** rate limit (5 min) per
    row — make sense to run every 5 min
  - Webhook dispatch is **latency-sensitive** for paying subscribers
    — every 1 min

## Decision

Three separate spark commands:

```
0   * * * * php /app/spark tickets:cleanup            # hourly
*/5 * * * * php /app/spark tickets:retry-deliveries   # every 5 min
*/1 * * * * php /app/spark tickets:dispatch-webhooks  # every 1 min
```

Each command:

- Has its own `--limit` knob for batch sizing
- Returns a JSON-shaped summary suitable for log aggregation
- Honors `Graceful_shutdown::isStopping()` between rows
- Logs at INFO on completion + WARN/ERROR on per-row failures
- Returns exit code 0 on success, 1 on fatal error (alertable)

The three pipelines also feed each other in a loop:

```
queued/failed → retry-deliveries → sent (done)
                                 → failed → retry next cycle
                                          → bounced (cleanup gate)
                ↑ rate-limited by --min-age, capped by --max-retries
                ↓
            cleanup
                → marks status='failed' AND attempts >= max → 'bounced'
                → marks status='failed' AND aged > ttl     → 'bounced'
```

## Consequences

**Easier:**

- Each pipeline can be tuned independently — change retry cadence
  without touching cleanup
- Cron schedules are the source of truth — no app-internal scheduler
  to reason about
- A stuck pipeline doesn't affect the others (e.g. retry hanging on
  an SMTP timeout doesn't delay webhook dispatch)
- Individual commands can be invoked manually for ad-hoc work
  (replay, dry-run, custom limits) without touching the others
- Logs are pipeline-scoped — `grep tickets:cleanup` separates from
  `grep tickets:retry` cleanly

**Harder:**

- Three cron entries to manage rather than one
- Three log files to aggregate (mitigated by structured-logging
  ADR 0007 — all three include the same `pipeline` field in their
  log lines, queryable in Loki/ELK)
- Two cron-pipeline interlocks (retry → cleanup state machine)
  introduce a temporal ordering concern: cleanup must NOT bounce a
  row that's about to be retried. Mitigated by retry honoring
  --min-age before flipping to retry, so a row that just failed has
  at least 5 min before cleanup considers it terminal.

## Alternatives considered

- **One unified worker** (`tickets:worker --all` or
  `tickets:worker --pipeline=cleanup,retry,webhooks`). Rejected
  because of the cadence mismatch — running webhook dispatch every
  hour would be unacceptable for paying subscribers, and running
  cleanup every minute would burn DB cycles for no benefit.
- **Long-lived daemon process** with internal scheduler (PHP-PM,
  Roadrunner, supervisord). Rejected — adds operational complexity
  (process supervision, restart-on-crash, memory leak management)
  that cron handles for free. Also harder to deploy gracefully.
- **External job queue** (Beanstalkd, RabbitMQ, AWS SQS). Right
  answer at much higher scale. Current volume (sub-thousand events
  per minute) is comfortably within DB-backed queue performance.
- **Off-platform scheduler** (k8s CronJob, AWS EventBridge).
  Equivalent to cron for our purposes; both are supported by the
  spark commands as-is (just change the trigger).
