# 10 — Prometheus + Grafana wiring for `/api/metrics`

**Goal:** Get the `/api/metrics` Prometheus endpoint scraping into a
real Prometheus instance and visualised in Grafana.

## Endpoint reference

```
GET /api/metrics
Authorization: Bearer <pii_master_key.metrics_scrape_token>
→ 200 text/plain; version=0.0.4
→ 401 if Authorization is missing or wrong
→ 503 if no metrics_scrape_token is configured (deny-by-default)
```

Metric families exposed:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `ospos_tickets_total` | gauge | status | Count of ticket rows by status |
| `ospos_tickets_issued_total` | counter | — | Sum of quantity_issued across products |
| `ospos_tickets_redeemed_total` | counter | — | Successful redemptions all time |
| `ospos_ticket_delivery_attempts` | gauge | status, channel | Delivery attempts by status+channel |
| `ospos_scanner_devices` | gauge | state | active/revoked counts |
| `ospos_audit_log_recent_count` | gauge | minutes="60" | Audit entries in last hour |
| `ospos_seat_holds_active` | gauge | — | Currently-held seat reservations |
| `ospos_app_build_info` | gauge | version | Static pseudo-info (value always 1) |

## 1. Generate and configure the scrape token

```bash
SCRAPE_TOKEN=$(openssl rand -hex 32)
echo "Scrape token: $SCRAPE_TOKEN"  # 🔒 secret — save to your secret manager
```

Set via env (preferred):

```yaml
# docker-compose.yml
services:
  ospos:
    environment:
      METRICS_SCRAPE_TOKEN: ${METRICS_SCRAPE_TOKEN}  # from .env
```

Or via app_config:

```sql
INSERT INTO ospos_app_config (`key`, value)
VALUES ('metrics_scrape_token', '<the token>')
ON DUPLICATE KEY UPDATE value = VALUES(value);
```

Restart the PHP container.

## 2. Verify the endpoint works

```bash
curl -sH "Authorization: Bearer $SCRAPE_TOKEN" \
  http://localhost/index.php/api/metrics | head -20
```

Expected output starts with:

```
# Pesaswap / OSPOS metrics — scrape 2026-06-06T15:30:00+00:00

# HELP ospos_tickets_total Count of ticket rows partitioned by status.
# TYPE ospos_tickets_total gauge
ospos_tickets_total{status="issued"} 142
...
```

A 401 means the bearer doesn't match. A 503 means the token isn't
configured at all.

## 3. Add to Prometheus scrape config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'ospos'
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: '/index.php/api/metrics'
    bearer_token: '<the token>'
    static_configs:
      - targets: ['ospos.internal:80']
        labels:
          deployment: 'production'
          tenant: 'pesaswap-main'
```

For Kubernetes Prometheus Operator, use a `ServiceMonitor`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ospos
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: ospos
  endpoints:
    - port: http
      path: /index.php/api/metrics
      interval: 30s
      bearerTokenSecret:
        name: ospos-metrics-token
        key: token
```

Reload Prometheus (`SIGHUP` or `kubectl rollout restart`).

## 4. Verify scraping

In the Prometheus UI:

```
Status → Targets → look for 'ospos' job
  Expected: state=UP, last_scrape recent
```

Quick test queries:

```
ospos_tickets_total           # see all current ticket counts by status
sum(ospos_tickets_total)       # total non-deleted tickets
rate(ospos_tickets_issued_total[5m])  # issuance rate per second
ospos_scanner_devices{state="active"} # active scanner count
```

## 5. Recommended alerts

```yaml
# alerts/ospos.yml
groups:
  - name: ospos
    rules:
      - alert: OsposMetricsScrapeDown
        expr: up{job="ospos"} == 0
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "OSPOS metrics endpoint not reachable"

      - alert: OsposDeliveryDLQGrowing
        expr: sum(ospos_ticket_delivery_attempts{status="bounced"}) > 100
        for: 10m
        labels: { severity: warn }
        annotations:
          summary: "Bounced delivery queue > 100 — see runbook 06"

      - alert: OsposDeliverySustainedFailures
        expr: sum(rate(ospos_ticket_delivery_attempts{status="failed"}[5m])) > 1
        for: 10m
        labels: { severity: warn }
        annotations:
          summary: "Sustained delivery failures — check SMTP / SMS gateway"

      - alert: OsposSeatHoldsStuck
        expr: ospos_seat_holds_active > 500
        for: 15m
        labels: { severity: warn }
        annotations:
          summary: "Many active seat holds — cleanup may be stalled"

      - alert: OsposAuditLogIdle
        expr: ospos_audit_log_recent_count == 0
        for: 1h
        labels: { severity: info }
        annotations:
          summary: "No admin mutations in last hour (expected overnight; investigate during business hours)"
```

## 6. Recommended Grafana dashboard panels

- **Tickets pipeline (timeseries)**: rate(ospos_tickets_issued_total[5m]) + rate(ospos_tickets_redeemed_total[5m])
- **Tickets by status (stat)**: sum by(status) (ospos_tickets_total)
- **Delivery health (heatmap)**: ospos_ticket_delivery_attempts grouped by status+channel
- **Scanner fleet (stat)**: ospos_scanner_devices{state="active"} vs revoked
- **Seat holds (gauge)**: ospos_seat_holds_active
- **Audit activity (timeseries)**: ospos_audit_log_recent_count
- **Build info (table)**: ospos_app_build_info → label "version"

A minimal starter dashboard JSON could be exported from
`https://grafana.com/grafana/dashboards/` after you've created one,
or composed via Terraform / Grafonnet.

## Token rotation

The metrics token has the same Secrets_vault resolution rules as
everything else — see [`04-pii-master-key-rotation.md`](04-pii-master-key-rotation.md)
for the env > _FILE > app_config pattern. Rotation is just: set new
env value, restart container, update Prometheus `bearer_token`,
reload Prometheus.

## Verification checklist

- [ ] Token generated and stored in secret manager
- [ ] `/api/metrics` returns 200 with Bearer, 401 without
- [ ] Prometheus target state=UP
- [ ] Test queries return non-zero values
- [ ] Alert rules loaded
- [ ] Grafana dashboard shows live data
