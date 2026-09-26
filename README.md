# Playwright Hybrid API/UI Test Suite — Toolshop

Playwright + TypeScript test suite for [Toolshop](https://practicesoftwaretesting.com), a demo e-commerce application with a REST API and an Angular front end.

This repo shows how I design test automation: **API-driven setup, UI-driven verification**, strict API contracts, readable Gherkin-style scenarios, and AI-assisted development kept in check by enforced rules. It also shows how I'd get a team started quickly: adopt a proven open-source scaffold ([agentic-playwright](https://github.com/idavidov13/agentic-playwright)), adapt it to the application, and put the effort into tests that find bugs. [Credits](#credits) lists exactly what came from the scaffold and what I built.

---

## Bugs found

Building this suite uncovered real defects in the application under test. Each one is written as a test that asserts the **correct** behaviour and is marked `test.fail()`. The suite stays green while the bug exists; once the bug is fixed, Playwright reports an unexpected pass, prompting removal of the marker.

| Finding | Severity | Test |
|---|---|---|
| **Broken access control.** `GET /users` correctly returns 403 to a customer, but `GET /users/search` returns 200 with other users' names, emails, dates of birth, and addresses. | High (data exposure) | [roleAccess.spec.ts](tests/app/api/roleAccess.spec.ts) |
| **Silent data loss.** On *Add Product*, ticking "Item for rent" clears the Stock value the admin already typed. Checked live: the backend accepts a rental product with stock, so the problem is in the page's own code, not a business rule. | Medium | [productCrud.spec.ts](tests/app/e2e/productCrud.spec.ts) |
| **Contract drift.** `GET /invoices/{id}` returns a `payment` object and `eco_discount_*` fields that the OpenAPI `InvoiceResponse` doesn't document. | Low (docs/API mismatch) | [invoice.spec.ts](tests/app/api/invoice.spec.ts) |
| **Undocumented status codes.** Role-protected endpoints return 403 to customers, but the OpenAPI spec lists 403 for none of them. | Low (docs) | [roleAccess.spec.ts](tests/app/api/roleAccess.spec.ts) |
| **Wrong session returned on login.** Intermittently, a customer UI login comes back with the admin's session. Investigated and guarded against; see [Known limitations](#known-limitations). | Unknown (server-side) | [createStorageState.ts](helpers/app/createStorageState.ts) |

---

## Design decisions

**Seed through the API, verify in the UI, confirm through the API.** A test for changing an invoice's status shouldn't spend forty seconds creating a user and checking out before it reaches the thing it means to assert. Preconditions are created by API in milliseconds, the browser drives only the feature under test, and a final API call confirms that the change was saved, not just displayed.

**Gherkin scenarios without Cucumber.** Steps are native `test.step()` calls titled `GIVEN / WHEN / THEN / AND`. Stakeholders can read the scenario, and it appears step by step in the HTML report and trace viewer. There are no feature files, no regex step matching, and no separate runner. Types, IDE navigation, and renames work across every step.

```typescript
await test.step('GIVEN an invoice has been seeded via the API as admin', async () => {
    expect(seededInvoice.status).toBe(InvoiceStatus.AWAITING_FULFILLMENT);
});

await test.step('WHEN the admin opens the invoice in the admin UI', async () => {
    await adminOrderEditPage.open(seededInvoice.id);
});

await test.step('AND transitions the invoice status to ON_HOLD', async () => {
    await adminOrderEditPage.updateStatus(InvoiceStatus.ON_HOLD);
});

await test.step('THEN GET /invoices/{id} confirms the status was persisted', async () => {
    const { status, body } = await apiRequest({ method: 'GET', url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}` /* … */ });
    expect(status).toBe(200);
    expect(InvoiceStatusResponseSchema.parse(body).status).toBe(InvoiceStatus.ON_HOLD);
});
```

| Cucumber | This repo |
|---|---|
| `.feature` files plus step-definition files | One `.spec.ts` file |
| Steps matched by regex or string patterns | Steps are code; renames are type-checked |
| State passed through a shared "World" object | Ordinary variables and Playwright fixtures |
| Extra runner, reporter, and config | Native Playwright runner, report, trace, and UI mode |

**API contracts are strict and follow the documentation.** Responses are parsed with Zod `z.strictObject()` schemas that mirror the OpenAPI spec one-to-one, including nested and recursive types. TypeScript types are inferred from the schemas, so the runtime check and the compile-time type can't disagree. When the live API disagrees with its spec, the schema stays faithful to the spec and the mismatch is recorded as a bug. Loosening the schema would hide it.

```typescript
export const InvoiceResponseSchema = z.strictObject({ /* mirrors OpenAPI InvoiceResponse */ });
export type InvoiceResponse = zOutput<typeof InvoiceResponseSchema>;

expect(InvoiceResponseSchema.parse(body)).toBeTruthy();
```

**Choose data that lets the test fail.** The category-filter test uses *Chisels*, not *Hand Tools*. Hand tools already sort first, so the first page of Hand Tools results is identical to the unfiltered page, and a test asserting on visible products would pass even if filtering were broken. The test also takes the expected product list from the API, not hard-coded names.

**Assert the exact failure.** Access-control tests expect 403, never "401 or 403". A 401 would mean the customer was never authenticated, which is a different and worse result than "correctly forbidden". Each denial is paired with an admin call to the same endpoint, proving the endpoint works and the 403 is really about permissions.

**Verify identity, don't assume it.** Auth setup checks that each saved session belongs to the expected user before writing it to disk. A spec that says it runs as a customer is guaranteed to run as the customer.

**Cleanup is guaranteed.** Seeded data is created and reverted by helper fixtures, whose teardown runs even when an assertion fails.

---

## What I built

On top of the scaffold (about 2,200 lines across 35 files):

- **Role switching.** [role-fixture.ts](fixtures/role/role-fixture.ts) makes `role` a Playwright option. `test.use({ role: Roles.CUSTOMER })` switches both the browser session and the API token for a file, and `tokenFor(role)` mints a token for the other role to compare.
- **Multi-role auth with identity checks.** Admin and customer storage states are generated in [auth.setup.ts](tests/app/auth.setup.ts) and [createStorageState.ts](helpers/app/createStorageState.ts), with checks that each session belongs to the expected user.
- **Invoice seeding fixture.** `seededInvoice` in [helper-fixture.ts](fixtures/helper/helper-fixture.ts) creates an invoice through the API and reverts it afterward.
- **Zod schemas** for invoices (with nested product, brand, category, and image types) and products.
- **Page objects** for the admin dashboard, admin order edit, admin product add, and the product listing.
- **Tests:**
  - API role-based access control across four endpoints
  - Invoice lifecycle end to end: seeded by API, changed in the UI, confirmed by API
  - Product create through the UI, verified field by field through the API
  - Admin-page access for admins and customers
  - Add Product form validation
  - Product listing, pagination, and category filtering checked against the API
- **CI.** Credentials moved to GitHub secrets, with a second account for role tests. Vendored skill files are pinned to LF line endings so the integrity check is stable on Windows.

---

## Foundation: reusing a proven scaffold

I didn't build the framework plumbing from scratch, and on a real team I wouldn't either. I evaluated [agentic-playwright](https://github.com/idavidov13/agentic-playwright), adopted it, adapted it to Toolshop (config, CI, roles, and removing monorepo-only workflows), and spent my time on tests that find bugs. Reusing and extending a good foundation is how I'd get a team's automation productive in days rather than weeks.

What the foundation provides, and why I kept each part:

| Capability | What it gives the team |
|---|---|
| **Fixture-based architecture** | Specs never construct page objects. They destructure fixtures from one import point (`fixtures/pom/test-options.ts`), so adding a page object never means editing existing specs. |
| **`apiRequest` fixture + Zod** | Typed `{ status, body }` responses with Bearer/Token/Basic auth, parsed against strict schemas. Types are inferred from those schemas. |
| **Helper fixtures** | Multi-call setup runs before the test, data is passed in, and teardown is guaranteed even on failure. |
| **Auth runs once** | A setup project writes an API token and browser storage state from the same credentials, so API-seeded data is visible in the UI session. |
| **Page Object Model** | Getter-based locators with a fixed priority: `getByRole` → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId`. Never XPath. |
| **Enums for every value** | Endpoints, routes, statuses, and messages live in `enums/`, with no string literals in specs. |
| **Data strategy** | Faker factories for happy paths and typed `as const` files for invalid and boundary sets. |
| **Environment management** | Per-environment `.env` files selected by `ENVIRONMENT`, with typed config objects. |
| **Multi-browser and parallel** | Chromium, Firefox, and WebKit projects; configurable workers. |
| **Reporting** | HTML report with a trace on first retry, and screenshots and video kept on failure. |
| **Code quality** | TypeScript strict mode, ESLint, Prettier, and Husky with lint-staged. |
| **Version single-source** | `VERSION` is the source of truth. `check:version` fails if `package.json` or `CHANGELOG.md` disagree. |
| **Skill drift lints** | Pre-commit and CI checks catch broken cross-references between skills and rules that drift from their owning skill. |
| **Upstream skill sync** | `skills-lock.json` stores SHA-256 hashes of the vendored skills. `skills:verify` detects local drift; `skills:reinstall` pulls fresh upstream copies. |

---

## AI-assisted development

I develop with an AI coding agent (Claude Code), and this repo shows how I keep an agent's output consistent and reviewable. The agent layer comes from the scaffold. My contribution is using it on real work: every test and page object above went through this workflow. The same rules are mirrored for **Claude Code, Cursor, and GitHub Copilot**, so the team isn't tied to one assistant.

**Workflow.** Every non-trivial task goes through 8 phases: *classify → route to a skill → explore → plan with a 1–10 confidence score → human approval → apply → verify → report*. Below confidence 5, the agent must stop and ask rather than guess. It writes no code before approval and commits only when asked.

**Explore before generating.** Selectors come from the live app via `playwright-cli`; schemas come from the OpenAPI spec. The agent never guesses either.

| # | Phase | What happens |
|---|---|---|
| 1 | Classify | Map the request to an intent: codegen, edit, refactor, debug, or explore |
| 2 | Route | Pick the first skill to load from the routing table |
| 3 | Explore | Gather evidence: OpenAPI spec, the live app via `playwright-cli`, existing files. Missing input → ask |
| 4 | Plan + confidence | Propose scope, trade-offs, unknowns, and a 1–10 confidence score. Below 5 → go back and ask |
| 5 | Human gate | Wait for approve / modify / reject. No code before approval |
| 6 | Apply | Edit following the loaded skill's rules |
| 7 | Verify | Lint and run the affected tests. Never suppress failures or raise timeouts |
| 8 | Report | List changed files and lint status. Commit only when asked |

**17 skills** in `.claude/skills/`. The agent loads only the ones a task needs, and they chain together: "add tests for `POST /invoices`" loads `api-testing`, which pulls in `data-strategy`, `enums`, `type-safety`, and `debugging` as needed.

| Skill | Purpose |
|---|---|
| `ai-native-workflow` | Entry point: runs the 8-phase workflow, routes each task to the right skill, applies the confidence gate |
| `common-tasks` | Prompt templates for adding page objects, tests, schemas, factories, fixtures, and components |
| `api-testing` | `apiRequest` usage, Zod schema creation, `test.step` wrapping, negative and path-parameter testing, helper fixtures |
| `type-safety` | No `any`, Zod 4 patterns (`strictObject`, `z.uuid`, `z.email`, …), type inference, the mandatory `Schema.parse` assertion |
| `test-standards` | Spec structure, Gherkin `test.step` layout, the one-tag rule, test types, data-driven loops, web-first assertions |
| `page-objects` | Page Object Model structure, getter locators, action methods, components, fixture registration |
| `selectors` | Locator priority and exploring the live app before writing any selector |
| `playwright-cli` | Terminal browser driver the agent uses to explore the live app, trace flows, and inspect storage |
| `fixtures` | Dependency-injection pattern, `mergeTests`, the three fixture categories |
| `helpers` | Plain utility functions, auth bootstrap, storage-state creation |
| `data-strategy` | Faker factories vs. `as const` static data vs. shared invalid-value sets |
| `enums` | Naming and location rules for endpoints, routes, messages, and roles |
| `config` | Env-file layout, `ENVIRONMENT` loading, config objects |
| `refactor-values` | Impact analysis and cascading updates before changing an enum or static value |
| `debugging` | Classifying failures (timeouts, `ZodError`, strict-mode, schema drift), choosing a debug tool, replaying CI failures |
| `pr-reviewer` | Reviews a branch against the rules and the relevant skills, runs lint/tsc/tests, reports tiered findings |
| `skill-creator` | Creates, evaluates, and benchmarks new or changed skills |

[AI-WORKFLOWS.md](AI-WORKFLOWS.md) maps 12 common flows to their skills and phases, including an API suite for a controller, functional tests from a ticket, and debugging a flaky test. It also has an anti-drift guardrails table, so the agent behaves the same way across sessions.

**Guardrails.**
- A Claude Code `PreToolUse` hook ([enforce_constitution.py](.claude/scripts/enforce_constitution.py)) blocks any edit that adds a hard wait, XPath, a loose `z.object()` schema, a direct `@playwright/test` import in a spec, JSON static data, or a tag on a `describe` block.
- Husky runs ESLint and Prettier on commit.
- CI checks the skill files for drift.

These checks enforce consistency, not correctness: code can pass every rule and still assert nothing meaningful. Every change was reviewed by me.

Full details: [CLAUDE.md](CLAUDE.md) (rules), [AI-WORKFLOWS.md](AI-WORKFLOWS.md) (playbooks), and the [upstream README](https://github.com/idavidov13/agentic-playwright).

---

## Structure

```
pages/           Page objects — locator getters and the actions that use them
fixtures/
  pom/           Page-object fixtures; the single import point for specs
  api/           apiRequest fixture, Zod response schemas
  helper/        Multi-step API setup/teardown with guaranteed lifecycle
  role/          Admin/customer switching for browser session and API token
helpers/         Auth bootstrap — API tokens and browser storage states
enums/           Endpoint paths, routes, statuses, roles
config/          Environment resolution
env/             Per-environment variables (gitignored)
test-data/
  factories/     Faker-generated happy-path data
  static/        Boundary and invalid cases, as const
tests/
  app/api/         API contract and access-control tests
  app/functional/  Single-feature UI tests
  app/e2e/         Cross-layer journeys
  app/auth.setup.ts
```

---

## Tags

| Tag | Scope |
|---|---|
| `@smoke` | Fast happy-path checks |
| `@sanity` | Quick checks after a change |
| `@regression` | Negative and edge cases |
| `@api` | Contract, status-code, and access-control coverage |
| `@e2e` | Cross-layer journeys touching both API and UI |
| `@destructive` | Changes shared data; excluded from the default run |

Each test carries exactly one tag.

---

## Running

```bash
npm ci
npx playwright install chromium
cp env/.env.example env/.env.dev    # set APP_URL, API_URL, APP_EMAIL, APP_PASSWORD, CUSTOMER_EMAIL, CUSTOMER_PASSWORD
npm test
```

```bash
npm run test:api          # API tests only
npm run test:smoke        # fast feedback
npm run test:e2e          # cross-layer journeys
npm run test:ui           # time-travel debugging
npm run report            # open the HTML report
```

---

## Known limitations

**CI runs API tests only.** The public Toolshop instance is behind Cloudflare bot protection, which challenges datacenter IPs including GitHub's runners. The full suite runs locally.

**Cleanup is partial.** The Invoice API has no DELETE endpoint, so seeded invoices are reverted rather than removed and stay on the shared instance.

**Shared state.** Tests run against a public instance other people also use, so data may change between runs.

**Logins can return the wrong user's session.** In roughly one full-suite run in three, a UI login with the customer's credentials comes back as the admin. It reproduces with a burst of concurrent admin logins alongside a single customer UI login. It does not reproduce with concurrent API-only logins, and the login response is sent `no-cache, private`, so it is not a simple edge cache. The root cause can't be diagnosed without server access. Setup therefore checks each session's email against the expected role and fails loudly rather than giving customer specs an admin session. Expect an occasional red setup on a full run; re-run it.

---

## Planned

- Self-hosted Toolshop via Docker Compose in CI: deterministic state and full-suite coverage
- Cart and checkout calculation tests

---

## Credits

Built on [agentic-playwright](https://github.com/idavidov13/agentic-playwright) by Ivan Davidov (MIT). From the scaffold, used as provided:
- the fixture architecture and `apiRequest` fixture
- the Zod contract conventions
- the `GIVEN / WHEN / THEN` step convention
- the AI rules layer: `CLAUDE.md`, `AI-WORKFLOWS.md`, the 17 skills, and the enforcement hook
- the lint, drift, and version tooling

Everything listed under [Bugs found](#bugs-found) and [What I built](#what-i-built) is mine. Third-party skill notices are in [NOTICE.md](NOTICE.md).
