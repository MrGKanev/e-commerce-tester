# e-commerce-tester — Shopify Store Health Check

Automated health-check suite for Shopify stores, built with [Playwright](https://playwright.dev). Point it at any Shopify store via a `.env` file and it validates every critical aspect — from broken images to GDPR consent persistence.

## What we test

- **Functionality** — homepage, navigation, collections, product pages, cart, search, static pages
- **Responsive design** — overflow, z-index, touch targets, font sizes at 375 / 390 / 768 px
- **Media** — broken images, alt text, srcset, fonts, video assets
- **Visual regression** — pixel-level snapshot comparisons with 3 % tolerance
- **Accessibility** — WCAG 2.1 AA via axe-core on all key pages
- **Performance** — TTFB, DOMContentLoaded, Lighthouse (≥ 50 / 80 / 80 / 85), Core Web Vitals (LCP / CLS / INP), network throttling
- **Structured data** — Product JSON-LD, Open Graph tags, canonical URL, sitemap.xml, robots.txt
- **API error handling** — Shopify AJAX mocks (422, 500, network abort, malformed JSON)
- **GDPR / Cookie consent** — first-visit behaviour, persistence, storage validation
- **Dynamic coverage** — live catalogue from `/products.json` (up to 25 products), fallback to `KNOWN_PRODUCTS`

Full test case list: [TESTS.md](TESTS.md)

---

## Requirements

- **Node.js 20+**
- **pnpm 9+** — install with `npm install -g pnpm` if needed

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Install Chromium (only needed once)
pnpm run install:browsers

# 3. Configure your store
cp .env.example .env
```

Edit `.env`:

```dotenv
# URL of the Shopify store to test (no trailing slash)
STORE_URL=https://your-store.myshopify.com

# Two product handles used by targeted tests
PRODUCT_HANDLE=your-first-product
PRODUCT_HANDLE_2=your-second-product
```

`STORE_URL` defaults to `https://zerno.co` and both handles default to `zerno-z1` / `zerno-z2` if omitted.

---

## Running the tests

```bash
# Headless (recommended for CI / scheduled checks)
pnpm test

# Watch the browser while testing
pnpm run test:headed

# Step-through debugger
pnpm run test:debug

# TypeScript type-check only (no browser launch)
pnpm run type-check
```

### Using the convenience script

```bash
./run.sh             # headless
./run.sh --headed    # with browser
./run.sh --debug     # debugger
```

The script prints a summary, updates the history dashboard, and prunes old reports (keeps last 30).

### Output after each run

```
reports/
├── history.html                  ← cumulative dashboard (all runs)
└── 2024-01-15_10-30/
    ├── index.html                ← HTML report with screenshots
    ├── results.json              ← machine-readable results
    └── screenshots/              ← one screenshot per test
```

Open the detailed report:
```bash
pnpm exec playwright show-report reports/2024-01-15_10-30
```

---

## GitHub Actions / CI

The workflow at `.github/workflows/health-check.yml` runs daily at 07:00 UTC and on every manual dispatch.

Set these repository secrets for your store:

| Secret             | Default          | Description                          |
|--------------------|------------------|--------------------------------------|
| `STORE_URL`        | `https://zerno.co` | Full URL of the store                |
| `PRODUCT_HANDLE`   | `zerno-z1`       | First product handle for targeted tests |
| `PRODUCT_HANDLE_2` | `zerno-z2`       | Second product handle                |

---

## Project structure

```
e-commerce-tester/
├── tests/
│   ├── helpers.ts                  shared selectors, utilities, fetchProductHandles()
│   ├── 01-homepage.spec.ts
│   ├── 02-navigation.spec.ts       desktop + mobile nav
│   ├── 03-collections.spec.ts
│   ├── 04-product.spec.ts          KNOWN_PRODUCTS + generic first-found product
│   ├── 05-cart.spec.ts
│   ├── 06-search.spec.ts
│   ├── 07-mobile.spec.ts           overflow, z-index, touch targets
│   ├── 08-pages.spec.ts
│   ├── 09-media.spec.ts
│   ├── 10-visual.spec.ts           visual regression snapshots
│   ├── 11-accessibility.spec.ts    axe-core WCAG 2.1 AA
│   ├── 12-performance.spec.ts      Lighthouse, CWV, network throttling
│   ├── 13-api-mock.spec.ts         Shopify AJAX error mocks
│   ├── 14-structured-data.spec.ts  JSON-LD, Open Graph, sitemap, robots.txt
│   ├── 15-gdpr.spec.ts             cookie consent UX & persistence
│   └── 16-dynamic-products.spec.ts live product crawling via /products.json
├── scripts/
│   └── update-history.js           generates reports/history.html
├── reports/                        auto-generated, gitignored
├── .env.example                    copy to .env and configure
├── playwright.config.ts
├── global-setup.ts
├── global-teardown.ts
├── run.sh
├── TESTS.md                        full test case reference
├── CONTRIBUTING.md
└── package.json
```

---

## License

[MIT](LICENSE) © Gabriel Kanev
