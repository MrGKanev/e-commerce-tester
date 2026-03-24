# Zerno.co — Automated Store Health Check

Automated weekly health-check system for [zerno.co](https://zerno.co), built with [Playwright](https://playwright.dev).

## Test coverage

| File | Suite | What's checked |
|------|-------|----------------|
| `01-homepage` | Homepage | HTTP 200, title, meta description, canonical, favicon, header, footer, logo, hero section, no JS errors, no failed requests, CSS loaded, fixed-element audit |
| `02-navigation` | Desktop nav | Nav links visible & non-empty, all links respond 200, clicking navigates correctly, dropdown hover, cart icon, search icon |
| `02-navigation` | Footer nav | Link count, all links respond 200, social media links |
| `02-navigation` | Mobile nav | Hamburger visible, menu opens/closes, links visible when open, touch target sizes, no overlay after close, 404 page has header |
| `03-collections` | Collections | `/collections/all` loads, product grid visible, card has name+price+image+link, alt text, no overflow |
| `04-product` | **zerno-z1** | 200, redirect check, title/meta/JSON-LD, H1 visible, price+currency, description, images (loaded+sized+alt+srcset), gallery thumbnails, add-to-cart button (visible+enabled+not covered), quantity selector, variants, breadcrumbs, related products, no overflow, mobile sizing, mobile add-to-cart accessible |
| `04-product` | **zerno-z2** | Same full suite as zerno-z1 |
| `04-product` | First collection product | Loads, add-to-cart triggers visible response |
| `05-cart` | Cart | Cart page loads, empty state, cart link in header, add product, cart shows name & price, quantity increase, remove item, checkout button present & correct |
| `05-cart` | Mobile cart | No overflow, checkout visible on 390px |
| `06-search` | Search | Icon visible, input appears on click, accepts text, submits & redirects, results for "zerno", no-results for nonsense, no overflow, predictive suggestions |
| `07-mobile` | Overflow | Every key page × 3 viewports (375, 390, 768px) — overflow detected with culprit elements |
| `07-mobile` | Overlap/z-index | Add-to-cart buttons (z1, z2), checkout, hamburger — `elementFromPoint` check for covering elements; fixed-element audit with overlay detection |
| `07-mobile` | Font sizes | Body ≥14px, description ≥14px, inputs ≥16px (iOS zoom prevention) |
| `07-mobile` | Touch targets | Cart icon, hamburger, add-to-cart all ≥40px |
| `07-mobile` | Images | Product & homepage images don't exceed viewport width |
| `07-mobile` | Sticky header | Visible after 500px scroll, ≤120px height when sticky, doesn't block product |
| `07-mobile` | Tablet 768px | No overflow on homepage & product page, nav visible |
| `08-pages` | Static pages | Contact, About, FAQ, Privacy, Terms, Refund, Shipping — reachable, renders content, no overflow |
| `08-pages` | Contact form | Form present, has email input + submit |
| `08-pages` | Policy links | All policy links in footer respond 200 |
| `09-media` | Broken images | No broken images on homepage, collections, zerno-z1, zerno-z2 (with lazy-scroll) |
| `09-media` | Alt text | Images have alt text on homepage & product pages |
| `09-media` | Failed assets | No CSS/JS 4xx errors on key pages |
| `09-media` | Responsive images | Product images use `srcset` |
| `09-media` | Font loading | @font-face declarations present |
| `09-media` | Videos | No failed video assets |

---

## Setup (first time)

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Install Chromium (only needed once)
npm run install:browsers
```

---

## Running the tests

```bash
# Headless (recommended for weekly checks)
npm test

# Watch the browser while testing
npm run test:headed

# Debug mode (step through tests)
npm run test:debug
```

### Output after each run

```
reports/
├── history.html                  ← cumulative dashboard (all runs)
└── 2024-01-15_10-30/
    ├── index.html                ← HTML report with all screenshots
    ├── results.json              ← machine-readable results
    └── screenshots/              ← one screenshot per test
```

Open the detailed report:
```bash
npx playwright show-report reports/2024-01-15_10-30
```

Open the history dashboard:
```bash
npm run history
# or: open reports/history.html
```

---

## Weekly cron schedule (Mac)

```bash
crontab -e
```

Add (adjust path):
```
0 9 * * 1 cd /path/to/e-commerce-tester && npm test >> reports/cron.log 2>&1
```

---

## Project structure

```
e-commerce-tester/
├── tests/
│   ├── helpers.ts              shared selectors & utilities
│   ├── 01-homepage.spec.ts
│   ├── 02-navigation.spec.ts   desktop + mobile nav
│   ├── 03-collections.spec.ts
│   ├── 04-product.spec.ts      zerno-z1, zerno-z2, generic
│   ├── 05-cart.spec.ts
│   ├── 06-search.spec.ts
│   ├── 07-mobile.spec.ts       overflow, z-index, touch targets
│   ├── 08-pages.spec.ts
│   └── 09-media.spec.ts
├── scripts/
│   └── update-history.js       generates reports/history.html
├── reports/                    auto-generated, gitignored
├── playwright.config.ts
├── run.sh
└── package.json
```
