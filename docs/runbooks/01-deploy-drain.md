# 01 — Drain a node before deploy

**Goal:** Take a node out of the load balancer cleanly so in-flight
requests + cron workers (cleanup, retry, webhook dispatch) finish
their current row before the deploy SIGTERMs the process.

## When to run

- Before any deploy that touches PHP code, migrations, or env config
- Before scaling a node down
- Before a planned reboot

## Steps

### 1. Touch the shutdown lockfile

```bash
docker compose exec -T ospos sh -c 'mkdir -p writable/runtime && touch writable/runtime/shutdown.lock'
```

This makes `GET /api/health` return **503** with `{status: "draining"}`.
k8s readiness probes / ALB target group health checks see the 503 and
stop sending new traffic to this node within ~10 seconds.

### 2. Wait for the load balancer to drain

Wait at least the LB's max-drain interval. Typical values:
- AWS ALB target group deregistration delay: **30 seconds**
- k8s `terminationGracePeriodSeconds`: **30 seconds** (default)
- Nginx upstream `proxy_next_upstream_timeout`: **10 seconds**

Default to **45 seconds** if unsure.

### 3. (Optional) Verify no in-flight requests

If you have access to access logs:

```bash
docker compose exec -T ospos sh -c 'tail -f writable/logs/access-*.log'
```

Wait for the tail to go quiet. If a long-running endpoint is stuck
(e.g. a /reports/* query), wait it out or accept the loss.

### 4. SIGTERM the worker daemons

Spark commands (cleanup, retry-deliveries, dispatch-webhooks) honor
`Graceful_shutdown` — they check `isStopping()` between rows. With
the lockfile present, the next SIGTERM lets them finish the current
row and exit cleanly. The lockfile itself ALSO signals isStopping(),
so workers triggered between step 1 and the SIGTERM will already
respect the drain.

If you run workers via cron only (no long-lived daemon), skip this —
the next cron tick will read the lockfile and exit immediately.

### 5. Deploy

```bash
docker compose pull
docker compose up -d --force-recreate ospos
```

### 6. Remove the lockfile

```bash
docker compose exec -T ospos rm -f writable/runtime/shutdown.lock
```

Verify health flipped back:

```bash
curl -s http://localhost/index.php/api/health | jq .
# { "status": "ok", "draining": false, "db": "ok" }
```

The load balancer will start sending traffic again on the next probe
(usually 10-30 seconds).

## Rollback

If the deploy went wrong and you want to back out:

```bash
docker compose exec -T ospos sh -c 'touch writable/runtime/shutdown.lock'  # re-drain
docker compose pull ospos:<previous_tag>
docker compose up -d --force-recreate ospos
docker compose exec -T ospos rm -f writable/runtime/shutdown.lock
```

## Verification queries

- **Spark commands honored the lock?** Check the spark output for
  `"Shutdown signalled — stopping after N of M rows."` — if seen,
  the worker bailed mid-batch cleanly. The remaining rows will be
  picked up by the next cron tick.
- **No requests served during drain?**
  ```bash
  awk -F'"' '/"status":50[23]/{print}' writable/logs/access-*.log | tail
  ```
  Should show only `/api/health` 503s during the drain window.
