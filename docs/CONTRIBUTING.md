# Contributing

[Back to README](../README.md)

Contributions that improve coverage, portability and reliability are welcome. See [Configuration](CONFIGURATION.md) and [Running tests](RUNNING.md) to prepare a store for live checks.

## Development setup

Use `./start.sh` from the checkout to start Docker Desktop and open the managed panel (`--no-open` for a headless host). The launcher reuses active services; it does not run validation.

Start Docker Desktop/Engine before any test. For Docker Desktop, use `docker desktop start`, then verify `docker info`. Keep Docker running throughout validation. If it cannot start, report the blocked validation without a host retry.

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
docker compose --profile validation build checks
```

Use Docker for every runtime check and reproduction, including unit tests and isolated retries. Runtime/validation services use `linux/amd64` and the pinned project Dockerfile. Its Playwright base image supplies the runtime Node version; `.nvmrc` is only for optional host report tooling, not an alternate test runtime. Host editing, Git/GitHub, guidance and report orchestration are allowed; host test/browser execution is not. If Docker is unavailable, start it or report validation as blocked without falling back to macOS/Windows. Do not restart an active user service to test changes.

## Upstream web guidance

Frontend agent tasks automatically start with `pnpm guidance:sync`, as required by [AGENTS.md](../AGENTS.md). It uses Google's official installer to refresh the complete [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) skill from upstream, including its guides and workflow. The generated skill and installer lock are ignored by Git: there is no maintained fork or pinned catalog to update in pull requests. The installed skill becomes available to Codex on the next turn; an agent can read it directly during the installing task.

```bash
pnpm guidance:sync
pnpm guidance search "validate form errors"
pnpm guidance retrieve "forms"
pnpm guidance:scan
```

Sync runs once at the beginning of each relevant agent task, not continuously in the background. Search and retrieval use `modern-web-guidance@latest`; syncing refreshes the skill from the GitHub repository. These commands need network access and execute upstream tooling. Offline work can use the last installed skill, but must disclose that freshness could not be checked. Ordinary store runs, builds and offline verification do not download guidance or change when upstream guidance changes.

Apply relevant recommendations to our existing Tailwind helpers and test fixtures. Our panel and reports target Baseline Widely available, with progressive enhancement for newer APIs. Native browser controls remain appropriate when they already solve the problem. A store should not fail a health check solely because it uses a working custom component. `legacy-scan` covers a subset of the catalog and its findings need contextual review.

## Validation

Executable Modern Web rules and their maintenance contract are tracked in [MODERN-WEB.md](MODERN-WEB.md). Their local desktop/mobile fixtures are part of `pnpm test:acceptance:local`; run them separately with `pnpm test:modern-web:local` after `pnpm build:css`.

```bash
docker compose run --build --rm -T checks pnpm check
docker compose run --build --rm -T checks pnpm format:check
```

`pnpm check` runs TypeScript, ESLint, offline unit tests and the Docker/Playwright toolchain check. ESLint covers storefront tests, local checks, configuration, Node scripts and browser JavaScript with the appropriate runtime globals. Formatting is a separate command.

The [Project checks workflow](../.github/workflows/ci.yml) uses one job for `pnpm check` and `pnpm build:css` on pull requests, pushes to `master` and manual dispatch. It runs in the same pinned Playwright base image as `Dockerfile`, using its Node runtime and the package pnpm version; there is no separate Node/browser installation or full browser acceptance run. The toolchain check rejects a mismatched CI image. A Markdown job summary and downloadable text artifact record passed, failed or skipped stages. A green CI result covers only these quick checks.

Full browser validation stays in local Docker. Acceptance covers both Chromium profiles; the additional cross-browser command covers Firefox, WebKit and Mobile WebKit without repeating Chromium. All runs use owned fixtures; live-store scans remain separate.

```bash
pnpm check:local
# Only the additional non-Chromium profiles, still inside Docker:
docker compose run --build --rm -T checks pnpm test:modern-web:cross-browser:local
# Focused Node regression:
docker compose run --build --rm -T checks node --test scripts/run-queue.test.js
```

### Publish local results to your PR

Install the GitHub CLI (`gh`), sign in with `gh auth login`, and commit/push your branch before running:

```bash
pnpm check:pr
# Or choose an open PR explicitly:
pnpm check:pr 29
```

The host script launches `pnpm check`, `pnpm build:css`, `pnpm test:acceptance:local` and `pnpm test:modern-web:cross-browser:local` sequentially through `docker compose run --build --rm -T checks`. It rebuilds the validation image from the current checkout and never falls back to host pnpm when Docker fails. Git metadata and GitHub authentication remain on the host; they are not mounted into the container. The report distinguishes the Docker runtime from its host controller. Progress stays in the terminal; after completion it automatically creates/updates its own marked PR comment with the commit, environment, timings and final results. It does not post running-status comments. A failure stops later checks, publishes a bounded redacted diagnostic tail and returns a nonzero exit code. Cancellation is reported when the process can shut down normally. GitHub publication failures also return nonzero; a green local result must not be inferred from an old comment.

The working tree must be clean and the PR must already point to the local commit. Local commit/worktree and remote PR changes during validation invalidate the result. Run one validation per checkout at a time. The command checks and reports; merging remains a separate explicit action.

Raw logs, `result.json` and the exact published `report.md` remain under the ignored `reports/local-quality/<commit>-<timestamp>/` directory. Only the Markdown summary and bounded diagnostic tails are posted; screenshots/traces/full logs stay local. Tails use the shared heuristic privacy filter and HTML escaping, not a guarantee that arbitrary secrets are detectable. GitHub Actions publishes its separate quick-check summary, without requiring GitHub CLI credentials or claiming a developer-local browser pass.

Node unit test files run sequentially in the canonical container so process/CLI fixtures do not starve each other during amd64 emulation; test deadlines and browser observation windows are unchanged. Unit tests also exercise the scheduler with stub runners: interval bounds, cooldowns, restart recovery, process shutdown, exclusive locks and start windows.

All package commands below are container commands: prefix focused runs with `docker compose run --build --rm -T checks`. Additional loopback acceptance checks:

`pnpm test:commerce:local` covers public product/JSON-LD/cart consistency and unavailable variants, with localized routes and shared cookie sessions. It is part of `pnpm test:acceptance:local`.

| Command                      | Covers                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm test:control:local`    | Browser forms, persistence, pause, mobile layout and axe                                            |
| `pnpm test:a11y:local` | Accessibility checks, custom overlays, native dialogs and popovers |
| `pnpm test:pacing`           | Request pacing and rate-limit behavior                                                              |
| `pnpm test:readiness`        | Content readiness and consent handling                                                              |
| `pnpm test:reporting`        | Metadata, coverage, skips and retries                                                               |
| `pnpm test:p2:local`         | DOM spelling, strict/report, accepted findings, inventory, OCR pipeline and touch/keyboard contexts |
| `pnpm test:vitals:local`     | Passive performance collection                                                                      |
| `pnpm test:pages:local`      | Shared document checks and request counts                                                           |
| `pnpm test:visual:local` | Explicit visual approval, immutable versions, image diffs and desktop/mobile viewport settings |
| `pnpm test:lighthouse:local` | Real Lighthouse integration against local pages                                                     |

The historical `test:p2:local` script name is retained as a command, not a documentation phase. Its OCR pipeline uses a fixture executable; a native OCR check additionally runs when Tesseract and its English model are installed.

These editing commands mount the checkout writable and keep Linux dependencies in a separate container volume, so changes persist without using host dependencies.

```bash
docker compose run --build --rm -T -v "$PWD:/app" -v /app/node_modules checks pnpm lint:fix
docker compose run --build --rm -T -v "$PWD:/app" -v /app/node_modules checks pnpm format
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

`pnpm test:woocommerce:local` validates Woo lifecycle hooks, suite isolation, classic/block and cookie/token/nonce carts, custom routes, price precision/taxes and variations through loopback fixtures. It is included in the common local acceptance command. `scripts/platform-config.test.js` and mixed-runner tests protect isolation and legacy Shopify configuration.

## Security workflow regression checks

`pnpm test:security:local` exercises security observations against owned desktop/mobile fixtures; `pnpm test:security:entry:local` verifies real Shopify/WooCommerce entry scenarios, including intentional strict failures and immutable baseline/history files. Both are included in local acceptance. Never use live stores to calibrate new rules without authorization.

`pnpm check` includes artifact-redaction and offline baseline review/history unit tests. `pnpm test:reporting` verifies original request execution, filtered diagnostics/encoded attachments and private atomic JSON publication. Security approvals in fixtures must provide an explicit reason; CLI approvals also require the review hash. Preserve exact security fingerprints and document raw artifact exclusions. See [artifact privacy](ARTIFACT-PRIVACY.md) and [baseline workflow](SECURITY-MONITORING.md).
