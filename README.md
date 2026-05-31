# e-commerce-tester — Shopify Store Health Check

Automated health-check suite for Shopify stores, built with [Playwright](https://playwright.dev). Point it at any Shopify store via a `.env` file and it validates every critical aspect — from broken images to GDPR consent persistence.

## What we test

- **Functionality** — homepage, navigation, collections, product pages, cart, search, static pages
- **Checkout flow** — cart → checkout redirect, HTTPS, form fields, express checkout (Apple Pay / Shop Pay)
- **Product variants** — out-of-stock indicators, URL `?variant=` updates, image swaps, keyboard accessibility
- **Filters & sorting** — all sort options, URL persistence, tag/facet filters, pagination
- **Responsive design** — overflow, z-index, touch targets, font sizes at 375 / 390 / 768 px
- **Media** — broken images, alt text, srcset, fonts, video assets
- **Visual regression** — pixel-level snapshot comparisons with 3 % tolerance
- **Accessibility** — WCAG 2.1 AA via axe-core on all key pages
- **Performance** — TTFB, DOMContentLoaded, Lighthouse (≥ 50 / 80 / 80 / 85), Core Web Vitals (LCP / CLS / INP), network throttling
- **Security** — HTTPS redirect, HSTS, `X-Content-Type-Options`, clickjacking protection, mixed content, cookie flags, `/admin` exposure
- **Trust signals** — payment badges, return/privacy policy links, contact info, shipping notes, reviews
- **Newsletter** — form presence, empty-submit validation, GDPR notice
- **404 page** — correct HTTP status, custom page, navigation links, no stack trace exposure
- **Structured data** — Product JSON-LD, Open Graph tags, canonical URL, sitemap.xml, robots.txt
- **API error handling** — Shopify AJAX mocks (422, 500, network abort, malformed JSON)
- **GDPR / Cookie consent** — first-visit behaviour, persistence, storage validation
- **Dynamic coverage** — live catalogue from `/products.json` (up to 25 products), fallback to `KNOWN_PRODUCTS`
- **Cross-browser** — Chrome, Firefox, and Safari (WebKit)

Full test case list: [TESTS.md](TESTS.md)

---

## Requirements

- **Node.js 22.13+**
- **pnpm 11+** — install with `npm install -g pnpm` if needed

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Install browsers (Chromium, Firefox, WebKit)
pnpm run install:browsers

# 3. Configure your store(s)
cp sites.example.json sites.json
```

Edit `sites.json` — add one object per store:

```json
[
  {
    "name": "My Store",
    "slug": "my-store",
    "url": "https://my-store.myshopify.com",
    "productHandle": "my-first-product",
    "productHandle2": "my-second-product",
    "searchTerm": "product"
  }
]
```

`sites.json` is gitignored so store URLs stay out of version control.

**Single-store / backwards compat:** if `sites.json` is absent the runner falls back to the `STORE_URL` / `PRODUCT_HANDLE` / `PRODUCT_HANDLE_2` environment variables (or `.env` file).

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
├── dashboard.html                ← cumulative dashboard (all runs)
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

The workflow at `.github/workflows/health-check.yml` runs daily at 07:00 UTC and on every manual dispatch. It uses Node.js 22 and the latest versions of all actions.

**Multi-site CI:** set the `SITES_JSON` secret to the full JSON array from your `sites.json`. The workflow writes it to `sites.json` before running tests.

**Single-site CI:** set the individual secrets below (same as before).

| Secret             | Used when          | Description                             |
|--------------------|--------------------|-----------------------------------------|
| `SITES_JSON`       | multi-site         | Full `sites.json` contents as a secret  |
| `STORE_URL`        | single-site        | Full URL of the store                   |
| `PRODUCT_HANDLE`   | single-site        | First product handle for targeted tests |
| `PRODUCT_HANDLE_2` | single-site        | Second product handle                   |
| `SEARCH_TERM`      | single-site        | Search term used by search tests        |

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
│   ├── 16-dynamic-products.spec.ts live product crawling via /products.json
│   ├── 17-checkout.spec.ts         cart → checkout flow, HTTPS, form fields
│   ├── 18-variants.spec.ts         out-of-stock, URL updates, image swap
│   ├── 19-filters.spec.ts          collection sort & tag filters
│   ├── 20-security.spec.ts         headers, HTTPS, cookies, /admin
│   ├── 21-trust.spec.ts            payment badges, policies, reviews
│   ├── 22-newsletter.spec.ts       signup form, validation, GDPR notice
│   └── 23-404.spec.ts              custom 404 page, links, no stack trace
├── sites.example.json              copy to sites.json and configure
├── scripts/
│   ├── run-sites.js                orchestrates per-site test runs
│   └── update-history.js           generates reports/dashboard.html
├── reports/                        auto-generated, gitignored
├── .env.example                    copy to .env and configure
├── playwright.config.ts            Chrome + Firefox + Safari projects
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
