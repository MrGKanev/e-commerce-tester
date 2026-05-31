# e-commerce-tester — Shopify Store Health Check

Automated health-check suite for Shopify stores, built with [Playwright](https://playwright.dev). Point it at any Shopify store and it validates 28 aspects of store health — from broken images and Core Web Vitals to exposed API keys and GDPR consent persistence — across Chrome, Firefox, and Safari.

## What gets tested

| Area | What's covered |
|------|----------------|
| **Core functionality** | Homepage, navigation, collections, product pages, cart, search, static pages, media |
| **Checkout** | Cart → checkout redirect, HTTPS enforcement, form fields, express checkout (Apple Pay, Shop Pay) |
| **Product features** | Variants (sold-out indicators, URL updates, image swaps), filters, sorting, pagination |
| **Discount codes** | Cart discount field, invalid-code error handling, valid-code price reduction |
| **Cross-sell & upsell** | Related products, Shopify Recommendations API, "Frequently bought together", cart upsell |
| **Recently viewed** | localStorage tracking, widget presence across pages, history persistence |
| **Multi-currency & i18n** | Currency/language switchers, price symbol consistency, Shopify Markets |
| **Mobile & responsive** | Overflow at 375/390/768 px, z-index overlaps, touch targets ≥ 40 px, font sizes |
| **Accessibility** | WCAG 2.1 AA via axe-core on all key pages |
| **Performance** | TTFB, Lighthouse (≥ 50/80/80/85), Core Web Vitals (LCP/CLS/INP), network throttling |
| **Security** | HTTPS, HSTS, CSP, cookie flags, `/admin` access, **private API keys in JS bundles** |
| **Trust & SEO** | Payment badges, policies, structured data (JSON-LD), Open Graph, sitemap, robots.txt |
| **GDPR** | Cookie consent first-visit behaviour, persistence, localStorage validation |
| **Dynamic coverage** | Live catalogue crawl from `/products.json` — up to 25 products automatically |
| **API resilience** | Shopify AJAX mocks — 422, 500, network abort, malformed JSON |
| **Visual regression** | Pixel-level snapshots with 3 % tolerance, dynamic elements masked |

Full test case reference: [docs/TESTS.md](docs/TESTS.md)

---

## How it works

### Global setup & teardown

Before any test runs, `config/global-setup.ts` launches a Chromium browser, navigates to the store, and accepts any cookie consent banner — saving the resulting browser state (cookies, localStorage) to `storageState.json` in the project root. Every subsequent test loads this snapshot instead of starting from a blank context, which means:

- Cookie banners don't interrupt individual tests
- Shopify sees a consistent returning visitor rather than a new bot on every request
- Rate-limit and bot-detection risk is significantly reduced

After all tests finish, `config/global-teardown.ts` clears the cart so the next run starts clean.

### Human-like delays

Every navigation in `helpers.ts` waits a random 150–550 ms before the `page.goto()` call. This mimics natural browsing pace. Shopify's bot-detection triggers on burst traffic patterns; the jitter keeps request timing unpredictable.

### Soft-skip pattern

Tests that depend on optional store features (discount codes, currency switchers, recently-viewed widgets, etc.) use `test.skip(true, reason)` when the relevant element isn't found. This means a run against a store without a wishlist widget doesn't produce a failure — it produces a skipped test with a clear reason. Only genuinely broken things fail.

### Multi-site orchestration

`scripts/run-sites.js` reads `sites.json` and runs the full test suite sequentially for each store, setting `STORE_URL`, `SITE_SLUG`, and related env vars before each run. Reports land in `reports/<slug>/YYYY-MM-DD_HH-MM/` so results from different stores never overwrite each other.

### Reports & dashboard

Each run writes an HTML report, a JSON results file, and failure screenshots under `reports/`. After every run, `scripts/update-history.js` reads all `results.json` files and regenerates `reports/dashboard.html` — a cumulative pass/fail history across all sites and runs.

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 22.13 + |
| pnpm | 11 + |
| Docker (optional) | any recent version |

---

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Install browsers (Chromium, Firefox, WebKit)
pnpm run install:browsers

# 3. Configure your store(s)
cp examples/sites.example.json sites.json
# Edit sites.json — see Configuration below
```

---

## Configuration

### Multi-store (recommended)

`sites.json` — one object per store. The file is gitignored so store URLs stay out of version control.

```json
[
  {
    "name":           "My Store",
    "slug":           "my-store",
    "url":            "https://my-store.myshopify.com",
    "productHandle":  "some-product",
    "productHandle2": "another-product",
    "searchTerm":     "keyword"
  }
]
```

### Single-store / `.env` fallback

If `sites.json` is absent the runner reads environment variables instead. Copy `examples/.env.example` to `.env` and fill in:

```env
STORE_URL=https://my-store.myshopify.com
PRODUCT_HANDLE=some-product
PRODUCT_HANDLE_2=another-product
SEARCH_TERM=keyword

# Optional — enables the valid-code test in suite 25
DISCOUNT_CODE=YOURCODE
```

---

## Running tests

```bash
# Headless (recommended for CI and scheduled runs)
pnpm test

# Watch the browser execute tests
pnpm run test:headed

# Step-through debugger — pause on failures
pnpm run test:debug
```

The `pnpm test` command runs `run.sh`, which:
1. Iterates over every site in `sites.json`
2. Runs the full Playwright suite for each site
3. Updates `reports/dashboard.html` with the new results
4. Prunes old reports — keeps the last 30 runs per site

### Output structure

```
reports/
├── dashboard.html              ← cumulative history across all runs
└── my-store/
    └── 2024-01-15_10-30/
        ├── index.html          ← HTML report (open with Playwright viewer)
        ├── results.json        ← machine-readable pass/fail data
        └── screenshots/        ← one screenshot per failed test
```

Open a report interactively:
```bash
pnpm exec playwright show-report reports/my-store/2024-01-15_10-30
```

---

## Docker

Run the full suite in a container — no local Node.js or browser installation required:

```bash
# Build the image and run once
docker compose run e2e

# Or build manually and pass env vars
docker build -t e2e .
docker run --rm -v $(pwd)/reports:/app/reports --env-file .env e2e
```

The `mcr.microsoft.com/playwright` base image already contains Chromium, Firefox, and WebKit with all system dependencies. The `Dockerfile` only installs pnpm and your npm dependencies on top of it.

Reports are written to `/app/reports` inside the container, which is bind-mounted to `./reports` on the host — so results persist after the container exits.

---

## CI / GitHub Actions

`.github/workflows/health-check.yml` runs daily at **07:00 UTC** and on manual dispatch.

### Secrets

| Secret | Applies to | Description |
|--------|-----------|-------------|
| `SITES_JSON` | multi-store | Full `sites.json` contents as a repository secret |
| `STORE_URL` | single-store | Store URL |
| `PRODUCT_HANDLE` | single-store | First product handle |
| `PRODUCT_HANDLE_2` | single-store | Second product handle |
| `SEARCH_TERM` | single-store | Search keyword |
| `DISCOUNT_CODE` | optional | Enables the valid-discount-code assertion in suite 25 |

`SITES_JSON` takes precedence. If it is set, the individual `STORE_URL` variables are ignored.

CI runs Chromium only (Firefox and Safari are omitted for speed). Reports are uploaded as workflow artifacts with 30-day retention.

---

## Code quality

### Linting (ESLint + eslint-plugin-playwright)

```bash
pnpm lint          # check for issues
pnpm lint:fix      # auto-fix what's possible
```

`eslint.config.mjs` uses the flat-config format with:
- **`typescript-eslint`** — type-aware TypeScript rules
- **`eslint-plugin-playwright`** — Playwright-specific rules (`no-wait-for-timeout`, `prefer-web-first-assertions`, `no-force-option`)
- **`eslint-config-prettier`** — disables formatting rules that conflict with Prettier

### Formatting (Prettier)

```bash
pnpm format          # format all TypeScript files in-place
pnpm format:check    # verify formatting without writing changes (good for CI)
```

`.prettierrc` enforces: single quotes, trailing commas, 100-character line width.

### Type checking

```bash
pnpm run type-check   # tsc --noEmit — catches type errors without running tests
```

---

## Project structure

```
e-commerce-tester/
│
├── tests/                          all Playwright spec files + shared helpers
│   ├── helpers.ts                  BASE URL, selectors, goto(), fetchProductHandles()
│   ├── 01-homepage.spec.ts         HTTP 200, title, meta, canonical, header/footer, JS errors
│   ├── 02-navigation.spec.ts       desktop nav, dropdown, footer links, mobile hamburger
│   ├── 03-collections.spec.ts      product grid, card structure, alt text, overflow
│   ├── 04-product.spec.ts          title, price, JSON-LD, images, variants, breadcrumbs
│   ├── 05-cart.spec.ts             add/remove, quantity, checkout button, mobile
│   ├── 06-search.spec.ts           icon, input, submission, results, predictive suggestions
│   ├── 07-mobile.spec.ts           overflow, z-index, touch targets, font sizes, sticky header
│   ├── 08-pages.spec.ts            contact, about, FAQ, privacy, terms, refund, shipping
│   ├── 09-media.spec.ts            broken images, alt text, srcset, @font-face, failed assets
│   ├── 10-visual.spec.ts           pixel-level snapshots (3 % tolerance), masked dynamic elements
│   ├── 11-accessibility.spec.ts    axe-core WCAG 2.1 AA on 6 key pages
│   ├── 12-performance.spec.ts      Lighthouse, CWV (LCP/CLS/INP), TTFB, network throttling
│   ├── 13-api-mock.spec.ts         Shopify AJAX error mocks — 422, 500, abort, malformed JSON
│   ├── 14-structured-data.spec.ts  JSON-LD (Product/WebSite/Org), Open Graph, sitemap, robots.txt
│   ├── 15-gdpr.spec.ts             cookie banner, persistence, localStorage, decline button
│   ├── 16-dynamic-products.spec.ts live /products.json crawl — up to 25 products
│   ├── 17-checkout.spec.ts         cart → checkout, HTTPS, form fields, express checkout
│   ├── 18-variants.spec.ts         sold-out indicators, ?variant= URL, image swap, keyboard a11y
│   ├── 19-filters.spec.ts          sort params, tag filters, pagination, URL persistence
│   ├── 20-security.spec.ts         headers, HTTPS/HSTS, cookies, /admin, API keys in JS bundles
│   ├── 21-trust.spec.ts            payment badges, policies, contact info, reviews
│   ├── 22-newsletter.spec.ts       email input, validation, GDPR notice
│   ├── 23-404.spec.ts              HTTP 404, custom page, navigation, no stack trace
│   ├── 25-discount-codes.spec.ts   cart discount field, invalid/empty/valid code handling
│   ├── 26-currency-i18n.spec.ts    currency/language switchers, price consistency, Markets API
│   ├── 27-cross-sell.spec.ts       related products, Recommendations API, FBT, cart upsell
│   └── 28-recently-viewed.spec.ts  localStorage tracking, widget presence, history persistence
│
├── config/                         Playwright lifecycle hooks
│   ├── global-setup.ts             accepts cookie consent, saves storageState.json to project root
│   └── global-teardown.ts          clears cart via POST /cart/clear.js after each run
│
├── scripts/                        Node.js orchestration scripts
│   ├── run-sites.js                iterates sites.json, runs tests per site, sets env vars
│   └── update-history.js           reads results.json files → regenerates dashboard.html
│
├── .github/workflows/
│   └── health-check.yml            daily CI at 07:00 UTC, uploads artifact, 30-day retention
│
├── docs/                           project documentation
│   ├── TESTS.md                    full test case reference table
│   └── CONTRIBUTING.md             contribution guide
│
├── examples/                       template files — copy and customise
│   ├── sites.example.json          multi-store config template → copy to sites.json in root
│   └── .env.example                single-store env template → copy to .env in root
│
├── Dockerfile                      playwright base image + pnpm + dependencies
├── docker-compose.yml              bind-mounts ./reports, reads .env
├── eslint.config.mjs               ESLint flat config — TypeScript + Playwright rules + Prettier
├── playwright.config.ts            Chrome + Firefox + Safari, sequential, 60 s timeout
├── run.sh                          entry point — delegates to scripts/run-sites.js
├── .prettierrc                     Prettier config
├── tsconfig.json
└── package.json
```

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STORE_URL` | yes (if no sites.json) | Full URL of the store, e.g. `https://example.myshopify.com` |
| `PRODUCT_HANDLE` | yes | Handle of a known in-stock product |
| `PRODUCT_HANDLE_2` | yes | Handle of a second known product |
| `SEARCH_TERM` | yes | Term that returns results in the store's search |
| `DISCOUNT_CODE` | no | Valid discount code — enables the passing-code assertion in suite 25 |
| `SITE_SLUG` | set by run-sites.js | Used to namespace report output directories |

---

## License

[MIT](LICENSE) © Gabriel Kanev
