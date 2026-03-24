# Zerno.co — Automated Store Health Check

Automated weekly health-check system for [zerno.co](https://zerno.co), built with [Playwright](https://playwright.dev).

## What it tests

| # | Suite | What's checked |
|---|-------|----------------|
| 1 | **Homepage** | Loads (200), title, header, footer, main content, no JS errors |
| 2 | **Header navigation** | Links visible, all respond without 404/500 |
| 3 | **Footer navigation** | Links visible, all respond without 404/500 |
| 4 | **Collections** | Collection pages load, products are displayed |
| 5 | **Product page** | Title, price, and add-to-cart button visible |
| 6 | **Cart** | Add-to-cart works, cart page shows item, cart link in header |
| 7 | **Search** | Search input accessible, search results page loads |
| 8 | **Static pages** | Contact, About, FAQ, Privacy Policy, Terms of Service |
| 9 | **Images** | No broken images on homepage |
| 10 | **Mobile** | No horizontal overflow, hamburger menu accessible |

Each test run also produces **screenshots** for every test (pass or fail).

---

## Setup (first time)

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Install Chromium browser (only needed once)
npm run install:browsers
```

---

## Running the tests

```bash
# Standard headless run (recommended for weekly checks)
npm test

# Watch the browser while testing
npm run test:headed
```

### Output

Every run creates a dated folder:

```
reports/
├── history.html              ← cumulative history of all runs
└── 2024-01-15_10-30/
    ├── index.html            ← detailed HTML report with screenshots
    ├── results.json          ← machine-readable results
    └── screenshots/          ← all captured screenshots
```

Open the detailed report after a run:
```bash
npx playwright show-report reports/2024-01-15_10-30
```

Open the history dashboard:
```bash
npm run history
# or just open reports/history.html in your browser
```

---

## Scheduling (weekly, macOS)

Use `cron` to run automatically every Monday at 9:00 AM:

```bash
crontab -e
```

Add this line (adjust the path):
```
0 9 * * 1 cd /path/to/e-commerce-tester && npm test >> reports/cron.log 2>&1
```

---

## Project structure

```
e-commerce-tester/
├── tests/
│   └── shopify.spec.ts      ← all test cases
├── scripts/
│   └── update-history.js    ← generates reports/history.html
├── reports/                 ← auto-generated, gitignored
├── playwright.config.ts     ← Playwright configuration
├── run.sh                   ← main entry point
└── package.json
```
