# e-commerce-tester

A local [Playwright](https://playwright.dev) health-check suite for Shopify stores. It checks storefront functionality, visual changes, accessibility, content, security signals and synthetic performance, with reports grouped by store and run.

The suite supports desktop Chromium, Firefox and WebKit, plus selected mobile scenarios. The runner defaults to **Desktop Chrome** and runs stores and tests sequentially. Live tests can change the session cart and exercise storefront forms; checkout checks stop before placing an order.

## Quick start

Requires Node.js **22.13+** (see `.nvmrc`) and pnpm **11+**. Docker is an alternative to installing browsers locally.

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
pnpm install --frozen-lockfile
pnpm run install:browsers
cp examples/sites.example.json sites.json
```

Edit `sites.json` with your store URL, two product handles and a search term that returns products. Remove unused example stores, then run:

```bash
pnpm test:smoke
pnpm dashboard
```

`sites.json`, `.env`, browser storage and generated reports are local files excluded from version control. Configure your own store before running: the code retains legacy store defaults when configuration is omitted.

## Run modes

| Command                        | Scope                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm test:smoke`              | Nine core homepage, product, cart and keyboard checks                                   |
| `pnpm test` / `pnpm test:full` | All `@full` scenarios                                                                   |
| `pnpm test:pages`              | Shared metadata, media, accessibility, spelling and screenshot checks per inventory URL |
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

- [Docker scheduler](docs/SCHEDULER.md): unattended multi-store checks, random intervals, start windows and persistent cooldowns.
- [Configuration](docs/CONFIGURATION.md): stores, environment variables, capabilities, selectors and thresholds.
- [Running tests](docs/RUNNING.md): modes, browsers, pacing, visual baselines and Docker.
- [Reports](docs/REPORTS.md): artifacts, dashboard metrics, coverage and comparisons.
- [Content checks](docs/CONTENT.md): inventory, spelling, accepted findings and OCR.
- [Performance](docs/PERFORMANCE.md): passive measurements, missing data and Lighthouse.
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

There are no GitHub Actions workflows that execute the suite or quality checks. Run them locally or through Docker; Dependabot provides dependency update PRs.

## License

[MIT](LICENSE) © Gabriel Kanev. Bundled dependencies and dictionaries retain their own licenses; see [Content checks](docs/CONTENT.md#licenses).
