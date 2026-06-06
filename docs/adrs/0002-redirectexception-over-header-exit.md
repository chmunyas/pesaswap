# 0002 — RedirectException over header()+exit() in Secure_Controller

## Status

Accepted (2026-06-06, commit `9d4b67ee3`; extended to Reports controller in `5b8dd9129`)

## Context

The legacy `Secure_Controller` constructor (inherited by every
authenticated web controller) used this pattern when a request
failed auth:

```php
if (!$this->employee->is_logged_in()) {
    header("Location:" . base_url('login'));
    exit();
}
```

This works fine under Apache + mod_php in production. It fails
catastrophically under PHPUnit's `FeatureTestTrait`:

- `exit()` from inside the SUT terminates the entire PHP process,
  including the PHPUnit test runner itself
- The result is a silent suite hang at the first auth-required test
- Pre-fix baseline: **0 tests could run** because the very first
  authenticated test killed the runner

We discovered this while trying to ship `ent-tests-config-hang` (the
suite was hanging at test ~40). The session-not-shared issue
(addressed by `withSession()`) was the proximate cause for ConfigTest;
the structural cause was the `exit()` pattern in the controller.

## Decision

Replace `header()+exit()` with `throw new
CodeIgniter\HTTP\Exceptions\RedirectException($url)` everywhere in
`Secure_Controller` and any custom controller-level auth check.

CodeIgniter's main bootstrap catches `RedirectException` and emits a
proper HTTP 302 response with the URL as `Location`. From the test's
perspective the response is a normal redirect — assertable via
`$response->assertRedirect()`.

## Consequences

**Easier:**

- The entire test suite became runnable. Pre-fix: 0 passing. Post-fix
  + follow-up cleanup: 127 passing (out of 186) as of this writing.
- BOLA test patterns work cleanly: tests can call
  `$this->withSession($cred)->get('/employees/view/1')` and assert
  `$response->assertStatus(302)`.
- Production behaviour is unchanged — the framework's exception
  handler emits the same redirect that `header()` would have.

**Harder:**

- Existing tests that pinned the OLD pattern as the contract
  (`testRedirectPatternUsesHeaderAndExit`) had to flip. Done in
  the same commit as the controller change so neither lives in a
  broken state.
- Defensive null-pid guard had to be added — `RedirectException`
  unwinds via the framework's exception path, which means the
  controller's `get_logged_in_employee_info()` now actually runs
  (in the old version `exit()` short-circuited before this could
  fail). Stale sessions are detected and force a re-login.

## Alternatives considered

- **`return redirect()->to($url)` inside constructor.** Doesn't work
  — constructors can't return a value to the framework. Discarded.
- **Move the auth check out of constructors into per-method filters.**
  Right answer long-term — see `App\Filters\` and the CI4 filter
  groups pattern. Out of scope for this iteration; would require
  re-routing every existing controller route through filter definitions.
  Filed as future todo `ent-auth-via-filters`.
- **Keep `header()+exit()`, mock it in test setUp.** Tried briefly —
  PHPUnit can't intercept exit() from inside a subject-under-test.
  Workarounds (e.g. `runkit`) require non-standard PHP extensions.
