# Configuration

[Back to README](../README.md) · [Running tests](RUNNING.md)

## Store configuration

Copy `examples/sites.example.json` to `sites.json`. The runner processes each store sequentially. This file is gitignored.

```json
[
  {
    "name": "My Store",
    "slug": "my-store",
    "url": "https://my-store.myshopify.com",
    "productHandle": "first-product",
    "productHandle2": "second-product",
    "searchTerm": "product",
    "locale": "en-US",
    "timezoneId": "America/New_York",
    "capabilities": { "reviews": false, "newsletter": false },
    "selectors": { "addToCart": "button[name='add']", "productTitle": "h1" },
    "inventory": {
      "discoverProducts": false,
      "productLimit": 5,
      "pages": [{ "path": "/policies/privacy-policy", "type": "static", "language": "en" }]
    },
    "spelling": { "mode": "report", "languages": ["bg", "en"], "allowWords": ["MyBrand"] }
  }
]
```

| Field                             | Meaning                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `name`                            | Display name; falls back to the slug                                                                            |
| `slug`                            | Unique report namespace; lowercase letters/digits separated by single hyphens; defaults to a sanitized hostname |
| `url`                             | HTTP(S) origin, without credentials, path, query or fragment                                                    |
| `productHandle`, `productHandle2` | Two known product handles; choose products suitable for cart checks                                             |
| `searchTerm`                      | Search query that returns products; defaults to the slug                                                        |
| `discountCode`                    | Optional valid code for the discount scenario                                                                   |
| `locale`, `timezoneId`            | Browser locale and timezone; defaults are `bg-BG` and `Europe/Sofia`                                            |

Supply both product handles explicitly. The runner otherwise falls back to environment values and legacy `zerno-z1`/`zerno-z2` handles.

## Single-store environment fallback

When `sites.json` is absent, the runner uses environment variables. Copy `examples/.env.example` to `.env` and replace the placeholders. Explicit environment variables take precedence over `.env` values.

| Variable                                | Purpose                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `STORE_URL`                             | Store origin; legacy fallback is `https://zerno.co`                              |
| `PRODUCT_HANDLE`, `PRODUCT_HANDLE_2`    | Known product handles                                                            |
| `SEARCH_TERM`                           | Search query                                                                     |
| `DISCOUNT_CODE`                         | Optional valid discount code                                                     |
| `STORE_LOCALE`, `STORE_TIMEZONE`        | Default locale/timezone, also used for sites without explicit values             |
| `TEST_DELAY_MS`, `TEST_JITTER_MS`       | Base delay and random additional delay before tests; defaults 5000/3000          |
| `REQUEST_DELAY_MS`, `REQUEST_JITTER_MS` | Base delay and random additional delay before paced requests; defaults 2000/2000 |

`RATE_LIMIT_DIR` optionally relocates rate-limit markers; the scheduler supplies it under its persistent state directory. `SCHEDULER_STATE_DIR` sets the scheduler state location outside Compose (or use `--state-dir`).

Per-site values override the corresponding environment defaults. `SITE_SLUG`, `TEST_RUN_DATE`, `RUN_MODE`, `PAGE_INVENTORY_FILE` and `SITE_SETTINGS_JSON` are normally supplied by the runner; direct Playwright invocations bypass that orchestration.

## Capabilities and selectors

Set a capability to `false` to skip its scenarios before store requests and mark them `not-applicable`. `true` or omission retains the checks. Undiscovered optional features can still produce ordinary skips, which remain visible as incomplete coverage.

Supported capabilities: `checkout`, `discounts`, `currency`, `language`, `recommendations`, `recentlyViewed`, `newsletter`, `reviews`, `filters`, `variants`, `mobileMenu`.

Supported CSS selector overrides: `addToCart`, `productTitle`, `price`, `cartCount`, `cartItems`, `mobileMenuToggle`, `consentAccept`, `main`. Invalid CSS is checked during setup before the first store navigation.

## Thresholds

Partial objects inherit the remaining defaults. Timing values are milliseconds, Lighthouse values are scores out of 100, and visual difference is a ratio.

```json
{
  "thresholds": {
    "webVitals": { "lcp": 2500, "cls": 0.1, "interactionLatency": 200 },
    "performance": {
      "ttfb": 2000,
      "domInteractive": 5000,
      "domContentLoaded": 6000,
      "loadComplete": 12000
    },
    "lighthouse": { "performance": 50, "accessibility": 80, "best-practices": 80, "seo": 85 },
    "accessibility": { "maxBlocking": 0, "maxViolations": 10, "maxContrastNodes": 5 },
    "visual": { "maxDiffPixelRatio": 0.03 }
  }
}
```

Threshold use depends on the scenario; defining a budget does not create additional measurements. See [Performance](PERFORMANCE.md) for observation settings and strict behavior, and [Content checks](CONTENT.md) for inventory/spelling options.

The complete settings schema is in [`config/site-settings.d.ts`](../config/site-settings.d.ts), with validation and defaults in [`config/site-settings.js`](../config/site-settings.js).

## Unattended runs

Scheduling is configured separately in `scheduler.json`, referencing the slugs in `sites.json`. See [Docker scheduler](SCHEDULER.md) for per-store job lists, interval ranges, start windows and cooldowns.
