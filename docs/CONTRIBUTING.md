# Contributing

[Back to README](../README.md)

Contributions that improve coverage, portability and reliability are welcome. See [Configuration](CONFIGURATION.md) and [Running tests](RUNNING.md) to prepare a store for live checks.

## Development setup

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
pnpm install --frozen-lockfile
pnpm run install:browsers
```

Use Node.js 22.13+ and pnpm 11+. Keep the pinned Playwright dependency and Docker image version aligned. TypeScript is pinned for compatibility with the installed ESLint parser.

## Validation

```bash
pnpm check
pnpm format:check
```

`pnpm check` runs TypeScript, ESLint, offline unit tests and the Docker/Playwright toolchain check. ESLint covers storefront tests, local checks, configuration, Node scripts and browser JavaScript with the appropriate runtime globals. Formatting is a separate command.

The [Project checks workflow](../.github/workflows/ci.yml) runs `pnpm check` and `pnpm test:acceptance:local` on pull requests, pushes to `master` and manual dispatch. It installs the pnpm version from `package.json`, Node from `.nvmrc`, and Chromium with its system dependencies. The acceptance command runs pacing, readiness, reporting, control panel, shared-page, performance-observation, approved-visual lifecycle, Shopify/WooCommerce public commerce consistency SEO and continuous buyer-journey checks sequentially against local fixtures. Live store checks are scheduled separately. Failed CI runs retain available local report artifacts for seven days.

To run the same checks locally:

```bash
pnpm exec playwright install chromium
pnpm check
pnpm test:acceptance:local
```

Unit tests also exercise the scheduler with stub runners: interval bounds, cooldowns, restart recovery, process shutdown, exclusive locks and start windows.

Additional loopback acceptance checks:

`pnpm test:commerce:local` covers public product/JSON-LD/cart consistency and unavailable variants, with localized routes and shared cookie sessions. It is part of `pnpm test:acceptance:local`.

| Command                      | Covers                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm test:control:local`    | Browser forms, persistence, pause, mobile layout and axe                                            |
| `pnpm test:pacing`           | Request pacing and rate-limit behavior                                                              |
| `pnpm test:readiness`        | Content readiness and consent handling                                                              |
| `pnpm test:reporting`        | Metadata, coverage, skips and retries                                                               |
| `pnpm test:p2:local`         | DOM spelling, strict/report, accepted findings, inventory, OCR pipeline and touch/keyboard contexts |
| `pnpm test:vitals:local`     | Passive performance collection                                                                      |
| `pnpm test:pages:local`      | Shared document checks and request counts                                                           |
| `pnpm test:visual:local` | Explicit visual approval, immutable versions, image diffs and desktop/mobile viewport settings |
| `pnpm test:lighthouse:local` | Real Lighthouse integration against local pages                                                     |

The historical `test:p2:local` script name is retained as a command, not a documentation phase. Its OCR pipeline uses a fixture executable; a native OCR check additionally runs when Tesseract and its English model are installed.

```bash
pnpm lint:fix
pnpm format
```

These commands modify files. Keep formatting changes scoped to your contribution.

## Adding or changing tests

1. Use the matching spec or the next available number. Import `test` and `expect` from `tests/fixtures.ts` to retain pacing, capability handling and performance collection.
2. Reuse `tests/helpers.ts` and site settings instead of duplicating URLs/selectors. Tag scenarios for the intended run mode. Add new mobile specs to the project's `testMatch` when appropriate.
3. Use locator assertions, state polling and response listeners registered before actions. Avoid `networkidle` and `waitForTimeout`; both are lint errors.
4. Keep scenarios independent and establish their own state. Respect the shared inventory and opt-in product discovery.
5. Skip optional features with a clear reason. Mark a skip `not-applicable` only when the feature is confirmed unsupported; do not use it for a blocked/failed operation or an unfinished test.
6. Guard browser-specific APIs with an explicit skip. Do not add retries or extra live requests to hide instability.
7. Update [TESTS.md](TESTS.md) and the relevant user guide when behavior changes. Prefer deterministic loopback fixtures for regression checks.

```ts
testInfo.annotations.push({
  type: 'not-applicable',
  description: 'This store has no wishlist',
});
test.skip(true, 'Wishlist feature is not configured');
```

## Pull requests and issues

Use conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and keep one logical change per commit. Target the repository's default branch. Describe the concrete behavior change and validation performed; note any checks not run.

For issues, include the failing scenario, selected project/mode, relevant version information and sanitized report evidence. Include a store URL only if it is public and appropriate to share. Do not commit local store configuration, session state or generated reports.

`pnpm test:woocommerce:local` validates Woo lifecycle hooks, suite isolation, classic/block and cookie/token/nonce carts, custom routes, price precision/taxes and variations through loopback fixtures. It is included in the common acceptance command and CI. `scripts/platform-config.test.js` and mixed-runner tests protect isolation and legacy Shopify configuration.
