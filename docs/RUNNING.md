# Running tests

[Back to README](../README.md) · [Configuration](CONFIGURATION.md)

## Modes and browser selection

The runner defaults to `full` mode and `Desktop Chrome`. Suites are selected by the store platform; see [WooCommerce](WOOCOMMERCE.md). It selects the matching tag unless you supply `--grep`, which replaces the preset filter.

| Command             | Tag        | Purpose                                                               |
| ------------------- | ---------- | --------------------------------------------------------------------- |
| `pnpm test:smoke`   | `@smoke`   | Nine key homepage, product, cart and keyboard checks                  |
| `pnpm test:full`    | `@full`    | Functional and quality scenarios, including content and visual checks |
| `pnpm test:pages`   | `@pages`   | Shared read-only checks of each inventory document                    |
| `pnpm test:commerce` | `@commerce` | Public product/UI/JSON-LD/cart prices and variant sellability |
| `pnpm test:content` | `@content` | Inventory spelling checks                                             |
| `pnpm test:visual`  | `@visual`  | Snapshot comparisons                                                  |
| `pnpm test:audit`   | `@audit`   | Lighthouse and network throttling                                     |

```bash
pnpm test:full --project="Desktop Chrome" --project="Desktop Firefox" --project="Desktop Safari"
pnpm test:full --project="Mobile Chrome" --project="Mobile Safari"
pnpm test:full --grep="@content"
pnpm test:smoke --site=my-store
pnpm test:headed
pnpm test:debug
```

`--site=<slug>` selects one configured store. `--sites-file=<path>` selects a different store file; both options are consumed by the runner.

Desktop projects cover the full suite. Mobile Chrome (Pixel 7) and Mobile Safari (iPhone 13) select mobile, visual, accessibility, keyboard, content, inventory visual, shared-page and commerce consistency specs. Desktop specs that resize the viewport are distinct from these touch/device projects.

Lighthouse runs only in the first selected Chromium project. Firefox and WebKit skip it. For unattended execution with configurable per-store intervals, use the [long-running Docker scheduler](SCHEDULER.md).

## Lifecycle and request pacing

Setup launches Chromium, accepts cookie consent and saves cookies/localStorage to `storageState.<slug>.json` in the project root (`storageState.json` without a slug). Tests reuse that state. Fresh-context consent tests create their own sessions. Setup also prepares the shared inventory. Shopify teardown clears the session cart unless rate-limited. Woo mutation scenarios clean their own cookie/token cart session; Woo global teardown makes no Shopify requests.

Live tests use one worker, no automatic retries, 5–8 seconds before tests and 2–4 seconds before paced document navigations and browser/API requests. Static images, scripts and CSS load normally. Service workers are blocked so navigations pass through the pacing layer. Large runs can take substantial time.

HTTP 429 writes `.rate-limit.<site>.json`, stops further store requests and skips remaining scenarios for that store. Teardown also avoids store traffic. `Retry-After` is recorded; start a new run manually after the cooldown. Pacing reduces request pressure but does not guarantee acceptance by the store.

Use zero pacing only for loopback fixtures. Pacing can affect synthetic load and ready-state timings.

## Content readiness

Shared navigation helpers wait for visible, non-empty content. Returning sessions only probe for visible consent controls; setup and fresh consent tests wait for a banner to appear. An undismissable visible banner fails the operation.

Specs use locator assertions, state polling and response listeners registered before actions. Visual checks wait for fonts and viewport images; image audits scroll lazy images into view. Optional-widget discovery has a bounded timeout and propagates other errors. `networkidle` and `page.waitForTimeout()` are lint errors.

## Visual baselines

Each store has an explicitly approved version. Test runs compare with that version until a user approves a replacement; the latest run never becomes the baseline automatically. Browser projects have separate images within the store version.

1. Run `pnpm test:visual --site=my-store` in the environment that will perform future comparisons.
2. Open the control panel, choose **Reports → store → run**, and review the visual section: baseline used by that run, candidate and difference.
3. Select only the correct candidates, click **Approve selected screenshots**, and confirm the store. Nothing is selected automatically.
4. Run the checks again. Approval changes future comparisons; historical failed results remain unchanged.

The first capture fails with a missing-baseline message and produces reviewable candidates. New inventory URLs and browser projects also need approval. Interrupted/in-progress runs cannot be approved until they have finished. Unavailable captures cannot be approved. Concurrent approvals from stale tabs return a conflict and require refresh.

Approved versions live outside report retention:

```text
visual-baselines/<store>/
  approved.json
  versions/<revision>/
    manifest.json
    <screenshot-id>.png
reports/<store>/<run>/visual/
  entries/<screenshot-id>.json
  <screenshot-id>-current.png
  <screenshot-id>-baseline.png
  <screenshot-id>-diff.png
```

A new approval copies unselected existing images and replaces only selected images. Old versions remain available and a run pins its approved revision at startup. Deleting old reports does not delete approved images. Back up `visual-baselines/` alongside configuration; it is gitignored, excluded from Docker builds and mounted in all Compose services. `VISUAL_BASELINES_DIR` can override its location for CLI and control services.

Use the same pinned Docker image and CPU architecture to capture and compare. The image sets `VISUAL_ENVIRONMENT`; compatibility also includes platform, architecture, browser/Playwright versions, locale, timezone, device properties, viewport and capture policy. A mismatch produces candidates with an **incompatible** status rather than a misleading pixel regression. Re-run in the approved environment, or review and explicitly approve the new environment. Updating the browser or image therefore requires a reviewed migration. Native and Docker baselines are not interchangeable.

For file-based use, review the images in the report before invoking explicit approval:

```bash
pnpm visual:review --site=my-store --run=<run-timestamp>
# Use the revision and IDs returned by review; use none only for the first approval.
pnpm visual:approve --site=my-store --run=<run-timestamp> --revision=none --ids=<id>,<id>
```

Automatic `--update-snapshots`, `-u` and ignored-snapshot comparisons are rejected. Playwright receives disposable run-local copies, never writable approved images.

The six old store screenshots and saved image artifacts from that store were deleted at the user’s request. No legacy screenshots are seeded as baselines. Capture and explicitly approve new candidates for each configured store when needed.

The default difference ratio is 0.03. Per-store `thresholds.visual.components` overrides it by screenshot name without `.png`, for example `{ "header": 0.005, "product-hero": 0.01 }`. Viewport screenshots use the actual configured viewport, including mobile projects. Dynamic elements are masked by the spec. Spelling evidence remains separate from baseline images.

Local lifecycle checks: `pnpm test:visual:local` checks desktop/mobile Chromium; `VISUAL_CHECK_ALL_BROWSERS=1 pnpm test:visual:local` checks all five projects after installing Firefox and WebKit too. These commands use intercepted local pages and temporary approval stores.

## Docker

The commands below run once. For a persistent service, see [Docker scheduler](SCHEDULER.md).

```bash
cp examples/.env.example .env
# Replace the placeholders in .env before running.
docker compose run --build --rm e2e
```

Compose loads `.env` and mounts `./reports`. To pass a multi-store configuration, mount `sites.json` explicitly:

```bash
docker build -t e2e .
docker run --rm --env-file .env \
  -v "$PWD/reports:/app/reports" \
  -v "$PWD/visual-baselines:/app/visual-baselines" \
  -v "$PWD/sites.json:/app/sites.json:ro" \
  e2e
```

The Playwright image includes browsers and system dependencies. Keep its version aligned with the pinned `@playwright/test` dependency. For optional Tesseract and English/Bulgarian models, build with `--build-arg INSTALL_OCR=1` and enable OCR in the store settings.

## Reports and local checks

The runner keeps the latest 30 runs per store and regenerates the dashboard. See [Reports](REPORTS.md) for artifacts and interpretation, and [Contributing](CONTRIBUTING.md) for checks that do not contact a store.
