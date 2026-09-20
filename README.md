# Playwright Hybrid API/UI Test Suite — Toolshop

Playwright + TypeScript test suite for [Toolshop](https://practicesoftwaretesting.com), a demo e-commerce application with a REST API and an Angular front end.

The organizing principle is **API-driven setup, UI-driven verification**. Preconditions are seeded through the API; the browser is used for the feature actually under test. A test for transitioning an invoice status should not spend forty seconds creating a user, searching for a product, and completing checkout before it reaches the thing it means to assert.

The fixture architecture, Zod contract layer, and AI rules system are a scaffold from [agentic-playwright](https://github.com/idavidov13/agentic-playwright) by Ivan Davidov (MIT), used here as provided. The invoice tests, invoice schema, admin order-edit page object, and the invoice seeding fixture are mine, built on top of that scaffold.

---

## Structure

```
pages/           Page objects — locator getters and the actions that use them
fixtures/
  pom/           Page-object fixtures; the single import point for specs
  api/           apiRequest fixture, Zod response schemas
  helper/        Multi-step API setup/teardown with guaranteed lifecycle
helpers/         Auth bootstrap — API token and browser storage state
enums/           Endpoint paths, routes, status values
config/          Environment resolution
env/             Per-environment variables (gitignored)
test-data/
  factories/     Faker-generated happy-path data
  static/        Boundary and invalid cases, as const
tests/
  app/api/         API contract tests
  app/functional/  Single-feature UI tests
  app/e2e/         Cross-layer journeys
  app/auth.setup.ts
```

---

## How it fits together

**Fixtures, not constructors.** Specs never instantiate a page object. They destructure a fixture from `fixtures/pom/test-options`, and the fixture owns construction and lifecycle. Adding a page object means registering it once rather than editing every spec that uses it.

```typescript
import { expect, test } from '../../../fixtures/pom/test-options';

test('example', async ({ appPage }) => {
    await appPage.openLoginPage();
});
```

**Auth runs once.** `tests/app/auth.setup.ts` is a setup project the others depend on. It produces two artifacts from the same credentials — an API token for `apiRequest`, and a browser storage state for the UI — so API-seeded data is visible to the browser session that exercises it.

**Contracts are validated at runtime.** API responses are parsed with Zod schemas built from the OpenAPI spec. Schemas use `strictObject`, so an undocumented field in a response is a failure rather than something silently ignored.

**Values live in enums.** Endpoint paths, application routes, and status values are defined in `enums/` and imported. No string literals in specs.

**Setup chains become helper fixtures.** When a precondition takes several API calls, it moves into `fixtures/helper/`, where setup runs before the test, the data is yielded to it, and teardown runs afterward — including when the test fails.

---

## Tags

| Tag | Scope |
|---|---|
| `@smoke` | Fast happy-path checks, run on every push |
| `@regression` | Negative and edge cases |
| `@api` | Contract and status-code coverage |
| `@e2e` | Cross-layer journeys touching both API and UI |

Each test carries exactly one tag.

---

## Running

```bash
npm ci
npx playwright install chromium
cp env/.env.example env/.env.dev    # set APP_URL, API_URL, APP_EMAIL, APP_PASSWORD
npx playwright test
```

```bash
npx playwright test --project=api            # API tests only
npx playwright test --grep @smoke            # fast feedback
npx playwright test --ui                     # time-travel debugging
npx playwright test path/to.spec.ts --debug  # step through
npx playwright show-report
```

Credentials come from `env/.env.<environment>`, which is gitignored. `env/.env.example` documents the required variables.

---

## AI rules

The repo carries the agent rules layer from the upstream scaffold, unmodified. `CLAUDE.md`, `AI-WORKFLOWS.md`, and `.claude/skills/` define conventions the assistant follows, and `.claude/scripts/enforce_constitution.py` runs as a pre-commit hook that rejects violations.

The hook checks structure: selector priority, no `any`, strict schemas, no hard waits, endpoint paths in enums, one tag per test. It enforces consistency, not correctness — a test can satisfy every rule and still assert nothing meaningful.

---

## Known limitations

**CI runs API tests only.** The public Toolshop instance is behind Cloudflare bot protection, which challenges datacenter IPs including GitHub's runners. The full suite runs locally.

**Cleanup is partial.** The Invoice API exposes no DELETE endpoint, so seeded invoices are reverted rather than removed and persist on the shared instance.

**Shared state.** Tests run against a public instance other people also use, so data is not guaranteed to be stable between runs.

**Logins can return the wrong user's session.** Roughly one full-suite run in three, a UI login submitting the customer's credentials comes back as the admin. Reproduced with a burst of concurrent admin logins alongside a single customer UI login; it does not reproduce with concurrent API-only logins, and the login response is sent `no-cache, private`, so it is not a simple edge cache. Root cause is not diagnosable without server access. `createAppStorageState` therefore confirms each session's identity against that role's email before writing anything, so setup fails loudly rather than handing `role: CUSTOMER` specs an admin session — expect the occasional red setup on a full run, and re-run it. Another argument for the self-hosted instance below.

---

## Planned

- Self-hosted Toolshop via Docker Compose in CI — deterministic state and full-suite coverage
- Role-based access coverage across admin and customer sessions
- Cart and checkout calculation tests