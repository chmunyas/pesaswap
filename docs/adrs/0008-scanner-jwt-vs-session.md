# 0008 — Scanner JWT auth coexisting with session auth on /tickets/redeem

## Status

Accepted (2026-06-06, commit `53bb0f7fb`)

## Context

`POST /api/tickets/redeem` has two distinct consumer types:

- **Cashiers / venue staff at a terminal** — already-logged-in via
  the standard merchant portal session. Browser cookies, CSRF, the
  usual.
- **Headless gate scanners** — dedicated hardware (Android scanner,
  Raspberry Pi at a turnstile) configured once with a long-lived
  token. No interactive login. May not even support cookies
  (some embedded HTTP libraries don't).

A scanner provisioning flow already existed (RS256 JWT minted by
`scannerDeviceCreate`, `jti` stored in `ticket_scanner_devices` for
revocation). But the redeem endpoint only accepted session auth, so
scanners had no way to use their token — they had to log in as a
cashier instead, defeating the point of device-scoped credentials.

Three design options:

- **Replace** session auth with JWT auth (force everyone to use the
  token model)
- **Coexist** — accept either Bearer JWT OR session, with fallthrough
- **Separate endpoints** — `/redeem-session` and `/redeem-jwt`

## Decision

Coexist. `requireRedeemAccess()` tries three modes in order:

1. **Authorization: Bearer <JWT>** is present:
   - Verify RS256 via `Ticket_token_lib::verify()`
   - Check `jti` against `ticket_scanner_devices.revoked_at IS NULL`
   - On success, stash the resolved device row on the controller
     for downstream rate-limit + audit-log use
   - On invalid JWT: **REFUSE with 401** — do NOT fall through to
     session auth (see "Hard refuse vs fallthrough" below)

2. **Session with `tickets_redeem` grant** — scanner-only cashier
3. **Session with `tickets` grant** — admin or full ticket-manager

## Consequences

**Easier:**

- Both consumer types just work without code changes per endpoint
- Per-device rate-limit keying — scanner JWT keys the limiter on
  `-device_id` (negative range to avoid collision with employee ids),
  so a flooding scanner doesn't starve a cashier sharing the same IP
- Per-device audit trail — `actor_scanner_device_id` is populated
  in admin_audit_log entries from JWT-authenticated redemptions
- `last_seen_at` / `last_seen_ip` bookkeeping for the device fleet
  comes for free (best-effort UPDATE on every JWT verify)

**Harder:**

- Two auth paths to test (mitigated by the smoke test in commit
  `53bb0f7fb` exercising all 6 scenarios: admin session, cashier
  session, JWT valid, JWT invalid, JWT revoked, no auth)
- Rate-limit key collision risk if employee IDs ever go negative.
  Defensive check: the scanner branch uses `-(int) $device_id`,
  guaranteeing the result is negative for any positive device_id.

## Hard refuse vs fallthrough on invalid JWT

The most important design decision in this ADR: if a Bearer header
is present but the JWT is invalid/expired/revoked, we refuse with
401 and do NOT fall through to session auth.

The motivating scenario:

> A scanner device is reported lost. Operator revokes it via
> `/scanner-devices/<id>/revoke`. The device's operator (a cashier)
> is also logged in as a cashier session in the same browser. If
> the redeem endpoint fell through from "JWT revoked" to "session
> authenticated", the revoked scanner could still operate as long
> as the cashier kept their session alive — which defeats the
> revocation entirely.

Hard refuse means: if a client sends a Bearer header, they're
asserting "I am a scanner". A stolen-then-revoked device can't
masquerade as a cashier session.

## Alternatives considered

- **Replace session auth.** Rejected — would force browser-based
  cashiers to manage tokens (they already have a session; adding
  a token they have to store somewhere is friction). Also breaks
  every existing UI flow that calls /redeem from the merchant
  portal.
- **Separate endpoints.** Rejected — would require two route entries,
  two RBAC checks, two test paths, two sets of docs. Coexist
  delivers the same security with one endpoint.
- **JWT for all, with a session-bridge endpoint that mints a JWT
  from a session.** Most consistent architecturally but introduces
  a chicken-and-egg for the merchant portal: every redeem now needs
  a JWT mint step. Adds latency and a coupling that doesn't pay off.
- **Fallthrough on invalid JWT.** Rejected for the security reason
  above.
