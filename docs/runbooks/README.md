# Operations Runbooks

This directory contains step-by-step procedures for operating the
ticketing + payments features of OSPOS in production. Each runbook is
written for an on-call engineer who is paged at 3 AM and needs to
recover service without reading source code first.

## Index

| Runbook | When to use |
|---|---|
| [`01-deploy-drain.md`](01-deploy-drain.md) | Pre-deploy: drain a node so in-flight redemptions finish |
| [`02-cert-rotation-apple.md`](02-cert-rotation-apple.md) | Apple Pass Type ID cert is expiring or compromised |
| [`03-cert-rotation-google.md`](03-cert-rotation-google.md) | Google Wallet service-account key rotation |
| [`04-pii-master-key-rotation.md`](04-pii-master-key-rotation.md) | Rotate the `pii_master_key` used by audit-log encryption |
| [`05-scanner-jwt-revocation.md`](05-scanner-jwt-revocation.md) | Lost or stolen scanner device |
| [`06-webhook-dlq-recovery.md`](06-webhook-dlq-recovery.md) | Webhook subscribers are returning errors; replay or bounce |
| [`07-gdpr-erasure.md`](07-gdpr-erasure.md) | Customer requests right-to-erasure (GDPR Article 17) |
| [`08-audit-log-queries.md`](08-audit-log-queries.md) | Cookbook of common audit-log queries for investigations |
| [`09-cron-pipeline-troubleshooting.md`](09-cron-pipeline-troubleshooting.md) | tickets:cleanup / retry-deliveries / dispatch-webhooks not making progress |
| [`10-metrics-prometheus-setup.md`](10-metrics-prometheus-setup.md) | Wire `/api/metrics` into a Prometheus + Grafana stack |

## Conventions

- All commands assume `docker compose` is the deployment mechanism.
  For non-Docker installs, substitute `php` for `docker compose exec -T ospos php`.
- `<>` placeholders need to be filled by the operator before running.
- Steps marked **⚠️ destructive** cannot be undone — read twice before pressing enter.
- Steps marked **🔒 secret** echo sensitive material; do them on a private terminal.

## Escalation

If a runbook step does not resolve the issue in 15 minutes, page the
on-call engineer for the affected subsystem (tickets / payments /
infra). Do not improvise schema changes or shell-edit production
config files without a peer reviewer.
