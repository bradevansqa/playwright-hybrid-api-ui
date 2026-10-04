# Changelog

All notable changes to playwright-hybrid-api-ui are documented here.

---

## v0.2.0 -- Self-hosted Toolshop in Docker -- 2026-10-04

### Added

- `docker/toolshop/docker-compose.yml`: upstream's prebuilt sprint 5 images, pinned to `2.5`. `SPRINT` selects another build.
- `scripts/toolshop.sh` and `npm run toolshop:up|reset|down`: start, reseed (clearing the API's lookup cache), and stop the stack.
- `test-docker` CI job: the full suite, UI included, against a freshly seeded instance.

### Fixed

- Customer setup could save the admin's session. The login context inherited the previous run's admin storage state through the `storageState` option. It now starts empty. This was previously documented as a server-side bug.
- The checkout page object locates the payment button by `data-test="finish"`, because its label differs between the public site and the published image.

### Changed

- Devcontainer Playwright image aligned with `@playwright/test` 1.62.1 (was 1.60.0).

---

## v0.1.0 -- Project scaffolded -- 2026-09-10

Scaffolded with [create-agentic-playwright](https://github.com/idavidov13/agentic-playwright).
