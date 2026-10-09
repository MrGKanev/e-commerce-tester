# Running tests

[Back to README](../README.md) · [Configuration](CONFIGURATION.md)

## Modes and browser selection

The runner defaults to `full` mode and `Desktop Chrome`. It selects the matching tag unless you supply `--grep`, which replaces the preset filter.

| Command             | Tag        | Purpose                                                               |
| ------------------- | ---------- | --------------------------------------------------------------------- |
| `pnpm test:smoke`   | `@smoke`   | Nine key homepage, product, cart and keyboard checks                  |
| `pnpm test:full`    | `@full`    | Functional and quality scenarios, including content and visual checks |
| `pnpm test:pages`   | `@pages`   | Shared read-only checks of each inventory document                    |
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

Desktop projects cover the full suite. Mobile Chrome (Pixel 7) and Mobile Safari (iPhone 13) select mobile, visual, accessibility, keyboard, content, inventory visual and shared-page specs. Desktop specs that resize the viewport are distinct from these touch/device projects.

Lighthouse runs only in the first selected Chromium project. Firefox and WebKit skip it. For unattended execution with configurable per-store intervals, use the [long-running Docker scheduler](SCHEDULER.md).

## Lifecycle and request pacing

Setup launches Chromium, accepts cookie consent and saves cookies/localStorage to `storageState.<slug>.json` in the project root (`storageState.json` without a slug). Tests reuse that state. Fresh-context consent tests create their own sessions. Setup also prepares the shared inventory. Teardown clears the session cart unless rate-limited.

Live tests use one worker, no automatic retries, 5–8 seconds before tests and 2–4 seconds before paced document navigations and browser/API requests. Static images, scripts and CSS load normally. Service workers are blocked so navigations pass through the pacing layer. Large runs can take substantial time.

HTTP 429 writes `.rate-limit.<site>.json`, stops further store requests and skips remaining scenarios for that store. Teardown also avoids store traffic. `Retry-After` is recorded; start a new run manually after the cooldown. Pacing reduces request pressure but does not guarantee acceptance by the store.

Use zero pacing only for loopback fixtures. Pacing can affect synthetic load and ready-state timings.

## Content readiness

Shared navigation helpers wait for visible, non-empty content. Returning sessions only probe for visible consent controls; setup and fresh consent tests wait for a banner to appear. An undismissable visible banner fails the operation.

Specs use locator assertions, state polling and response listeners registered before actions. Visual checks wait for fonts and viewport images; image audits scroll lazy images into view. Optional-widget discovery has a bounded timeout and propagates other errors. `networkidle` and `page.waitForTimeout()` are lint errors.

## Visual baselines

Snapshots are separated by store, browser project and operating system. Generate them on the platform used for comparisons and review each image before accepting it:

```bash
pnpm test:visual --project="Desktop Chrome" --update-snapshots
```

To update just the original visual spec:

```bash
pnpm test:visual tests/10-visual.spec.ts --project="Desktop Chrome" --update-snapshots
```

The default pixel difference ratio is 0.03, configurable per store. Dynamic elements are masked by the spec. Spelling evidence is a separate screenshot and does not annotate the visual baseline.

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
  -v "$PWD/sites.json:/app/sites.json:ro" \
  e2e
```

The Playwright image includes browsers and system dependencies. Keep its version aligned with the pinned `@playwright/test` dependency. For optional Tesseract and English/Bulgarian models, build with `--build-arg INSTALL_OCR=1` and enable OCR in the store settings.

## Reports and local checks

The runner keeps the latest 30 runs per store and regenerates the dashboard. See [Reports](REPORTS.md) for artifacts and interpretation, and [Contributing](CONTRIBUTING.md) for checks that do not contact a store.
