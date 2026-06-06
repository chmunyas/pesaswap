# 0007 — X-Request-ID propagation via $GLOBALS for filter→filter handoff

## Status

Accepted (2026-06-06, commit `a09419189`)

## Context

We needed a per-request correlation ID flowing end-to-end:

- Inbound `X-Request-ID` header (if a load balancer / API gateway
  provided one) should be respected
- Outbound responses should set the header so the caller can echo
  it back into bug reports
- Server-side logs (audit_log, access_log, error log) should all
  carry the same ID for a given request
- Downstream side-effects (webhook deliveries, log warnings) should
  also carry the ID for full-stack tracing

The trace ID has to be available in three contexts:

1. The **before-filter** that generates / honors it
2. The **after-filter** that emits it on the response + access log
3. The **controller body** that may want to stamp it into rows
   (audit log, webhook deliveries)

## Decision

Stash the trace ID + start timestamp in PHP's `$GLOBALS` superglobal:

```php
// in CorrelationId::before()
$GLOBALS['__ospos_rid']   = $rid;
$GLOBALS['__ospos_start'] = $startSec;
```

Controllers and downstream libraries read it back:

```php
$rid = isset($GLOBALS['__ospos_rid']) && is_string($GLOBALS['__ospos_rid'])
    ? substr($GLOBALS['__ospos_rid'], 0, 64) : null;
```

The before-filter also calls `$request->setHeader('X-Request-ID', $rid)`
so the SAME instance of `IncomingRequest` carries it — controllers can
ALSO read via `$this->request->getHeaderLine('X-Request-ID')`.

## Consequences

**Easier:**

- Single source of truth, zero ceremony to read it back
- Works across CI4 filter boundaries (`before()` and `after()` get
  freshly-instantiated filter objects — no `$this` continuity)
- Works from worker context too — the spark commands don't have a
  request, so they only read `$GLOBALS` when it happens to exist
  (audit_log calls from cron leave request_id NULL, which is correct)
- Survives controller deferred-work patterns (e.g. webhook publish
  inside a try-catch after the transaction commits)

**Harder:**

- `$GLOBALS` is a global mutable state — historically frowned upon.
  Mitigated by: namespaced with `__ospos_` prefix, only used for
  per-request scoped data, never persists across requests because
  PHP-FPM re-initializes on each request.
- Tests that exercise the controller via FeatureTestTrait need to
  reset `$GLOBALS['__ospos_rid']` between test methods if asserting
  on it. None currently do — the value is opaque, so this is a
  hypothetical concern.
- A future migration to PHP-PM / RoadRunner (long-lived processes)
  would need to wipe these globals at request boundaries. Document
  in the migration plan.

## Alternatives considered

- **`Config\Services::correlationId()` shared service.** Cleaner
  in principle, but the CI4 service container holds state across
  the filter chain only because we make it `getShared()` — and
  then accidentally persists across requests in PHP-PM. Same
  underlying issue, more ceremony.
- **Request header alone** (`$request->setHeader('X-Request-ID')`).
  Works for controllers but NOT for the after-filter — it gets a
  freshly-instantiated request object that doesn't carry the
  before-filter's setHeader. Or rather: it CAN, depending on
  whether the same request instance is passed through... brittle.
- **Stash in `session()->set('__rid', $rid)`.** Wrong scope —
  sessions are persistent across requests. A second request from
  the same browser would inherit the previous request's id.
- **PSR-15 attribute on the request.** Right answer for a
  PSR-15-native framework. CI4 4.x isn't fully PSR-15, so the
  attribute pattern would need a custom carrier — same problem as
  the service container with more PHP-fluency required from
  contributors.
