# e-commerce-tester

A local [Playwright](https://playwright.dev) health-check suite for Shopify and WooCommerce stores. It checks storefront functionality, visual changes, accessibility, content, security signals and synthetic performance, with reports grouped by store and run.

The suite supports desktop Chromium, Firefox and WebKit, plus selected mobile scenarios. The runner defaults to **Desktop Chrome** and runs stores and tests sequentially. Live tests can change the session cart and exercise storefront forms; checkout checks stop before submitting an order. Woo checkout pages can initiate normal draft checkout state.

## Quick start

Docker Engine/Desktop with Docker Compose is required for all project execution and validation. Containers use the project Playwright image on `linux/amd64`; do not install or run browsers/tests directly on the host. Host Node/pnpm and GitHub CLI are optional report-controller tools only.

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
cp examples/sites.example.json sites.json
```

For Shopify, edit `sites.json` with your store URL, two product handles and a search term that returns products. For WooCommerce, use [the Woo example](examples/woocommerce-sites.example.json) and [setup guide](docs/WOOCOMMERCE.md). Remove unused example stores, then run:

```bash
docker compose run --build --rm -v "$PWD/sites.json:/app/sites.json:ro" e2e pnpm test:smoke
```

`sites.json`, `.env`, browser storage and generated reports are local files excluded from version control. Configure your own store before running: the code retains legacy store defaults when configuration is omitted.

## Browser management

For unattended checks managed through forms, run:

```bash
docker compose --profile managed up -d --build control
```

Open **http://localhost:8080** to add stores, choose checks and schedules, pause stores and view reports. No configuration files need editing. The service starts empty and has no password/login; see [Browser control panel](docs/CONTROL-PANEL.md) for local hosting and domains.

## Run modes

| Command                        | Scope                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm test:smoke`              | Nine core homepage, product, cart and keyboard checks                                   |
| `pnpm test` / `pnpm test:full` | All `@full` scenarios                                                                   |
| `pnpm test:pages`              | Shared metadata, media, accessibility, spelling and screenshot checks per inventory URL |
| `pnpm test:commerce` | Selected variant prices, JSON-LD, cart and availability via the public storefront |
| `pnpm test:content`            | Dictionary spelling checks across the inventory                                         |
| `pnpm test:visual`             | Visual snapshot comparisons and inventory snapshots                                     |
| `pnpm test:audit`              | Opt-in Lighthouse and throttled network checks                                          |

```bash
pnpm test:full --project="Desktop Firefox" --project="Desktop Safari"
pnpm test:pages --project="Mobile Chrome"
pnpm test:headed
pnpm test:debug
pnpm dashboard:preview
```

Visual checks compare with an explicitly approved version per store. Review and approve candidates in the control panel; runs never update approval automatically. See [Visual baselines](docs/RUNNING.md#visual-baselines).

Opt-in script-content, outbound destination and checkout-interface monitoring supports Shopify/WooCommerce with reviewed baselines. See [Security monitoring](docs/SECURITY-MONITORING.md). Persisted diagnostics use a [shared privacy filter](docs/ARTIFACT-PRIVACY.md); raw browser HTML/trace/image artifacts remain sensitive.

The dashboard preview uses offline sample data. Live runs use request pacing, no automatic retries and one worker. For unattended checks across multiple stores, use the [long-running Docker scheduler](docs/SCHEDULER.md) with configurable intervals and cooldowns. Optional features may be skipped; review coverage and skip reasons alongside pass rate.

## Coverage

| Area               | Examples                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Storefront         | Navigation, collections, products, variants, cart, search, static pages and media                       |
| Commerce           | Checkout redirect, discounts, currency/language switching, recommendations and recently viewed products |
| Quality            | Responsive layout, keyboard interaction, axe WCAG 2.2 AA checks and visual regression                   |
| Content            | Local Bulgarian/English dictionary checks, optional OCR and opt-in catalogue discovery                  |
| Performance        | Passive navigation/LCP/CLS observations and named interactions; separate Lighthouse audits              |
| Security and trust | Headers, cookies, exposed-key patterns, structured data, policy links and consent behavior              |

These are automated checks of selected scenarios. Dictionary checks do not establish grammatical correctness, axe does not establish full accessibility compliance, and local performance measurements are synthetic rather than field Core Web Vitals.

## Documentation

- [Modern Web checks and maintenance](docs/MODERN-WEB.md): executable checks, findings, coverage limits and maintenance. Run with `pnpm test:modern-web --site=<slug>`; Full and Pages include them.

- [Checkout, analytics, markets and operations](docs/OPERATIONS-AND-COMMERCE.md): expected checkout totals, tracking/consent, market journeys, open problems, retention, backups and setup discovery.

- [Browser control panel](docs/CONTROL-PANEL.md): manage stores and schedules without editing files.
- [Docker scheduler](docs/SCHEDULER.md): unattended multi-store checks, random intervals, start windows and persistent cooldowns.
- [WooCommerce](docs/WOOCOMMERCE.md): platform selection, product URLs, Store API, cart sessions and tax rules.
- [Configuration](docs/CONFIGURATION.md): stores, environment variables, capabilities, selectors and thresholds.
- [Running tests](docs/RUNNING.md): modes, browsers, pacing, visual baselines and Docker.
- [Reports](docs/REPORTS.md): artifacts, dashboard metrics, coverage and comparisons.
- [Content checks](docs/CONTENT.md): inventory, spelling, accepted findings and OCR.
- [Performance](docs/PERFORMANCE.md): passive measurements, missing data and Lighthouse.
- [Price and availability](docs/COMMERCE.md): public storefront, JSON-LD and same-session cart consistency.
- [Test reference](docs/TESTS.md): scenario coverage by spec.
- [Contributing](docs/CONTRIBUTING.md): development workflow and offline validation.

## Project layout

```text
tests/                 Storefront specs, browser fixtures and shared helpers
checks/                Offline browser fixtures and acceptance checks
config/                Settings, lifecycle hooks and metadata reporter
scripts/               Multi-store runner, dashboard and local validation
examples/              Store and environment templates
docs/                  User and contributor guides
playwright.config.ts   Projects, artifacts and snapshot paths
run.sh                 Entry point for the multi-store runner
```

GitHub Actions runs one quick job inside the same pinned Playwright base image for TypeScript, lint, unit tests, toolchain/metadata validation and CSS build. It publishes a text summary and runs no browser suites. Full fixture browser tests run in local Docker; live store checks run separately through the CLI or scheduler. Dependabot provides dependency update PRs.

Run quick checks with `docker compose run --build --rm -T checks pnpm check`. Run full local Docker validation with the host report controller `pnpm check:local`, including acceptance and all five Modern Web profiles without repeating Chromium. Use `pnpm check:pr` on a committed/pushed PR branch to run them and automatically publish the results as a PR comment. See [local PR validation](docs/CONTRIBUTING.md#publish-local-results-to-your-pr) for setup, failure reporting and log limits.

## License

[MIT](LICENSE) © Gabriel Kanev. Bundled dependencies and dictionaries retain their own licenses; see [Content checks](docs/CONTENT.md#licenses).

SEO checks across the whole inventory: `pnpm test:seo --site=<slug>`. Details: [docs/SEO.md](docs/SEO.md).
