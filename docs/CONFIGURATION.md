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

Price/availability checks additionally support `commerceRoot`, `productForm`, `soldOut`, `cartUnitPrice` and `cartLinePrice`. Set capability `commerceConsistency` to `false` to explicitly disable that suite. See [Commerce checks](COMMERCE.md) for selector scope, currencies and sample limits.

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
    "visual": { "maxDiffPixelRatio": 0.03, "components": { "header": 0.005, "product-hero": 0.01 } }
  }
}
```

Threshold use depends on the scenario; defining a budget does not create additional measurements. See [Performance](PERFORMANCE.md) for observation settings and strict behavior, and [Content checks](CONTENT.md) for inventory/spelling options.

The complete settings schema is in [`config/site-settings.d.ts`](../config/site-settings.d.ts), with validation and defaults in [`config/site-settings.js`](../config/site-settings.js).

## Unattended runs

Scheduling is configured separately in `scheduler.json`, referencing the slugs in `sites.json`. See [Docker scheduler](SCHEDULER.md) for per-store job lists, interval ranges, start windows and cooldowns.

Visual component keys are screenshot names without `.png`. Unspecified names inherit `maxDiffPixelRatio`. Thresholds do not update approved images; see [Visual baselines](RUNNING.md#visual-baselines).

## Commerce platforms

`platform` defaults to `shopify` for backward compatibility. Set `woocommerce` explicitly for Woo stores. Shopify retains origin URLs and product handles; Woo supports installation paths and `commerce.productUrls`, `productIds`, `apiRoot`, `routes` and `taxDisplay`. The panel exposes platform, product URLs and cart/catalogue/checkout paths. Advanced settings survive import/edit. See [WooCommerce](WOOCOMMERCE.md).

### JSON Schema and Ajv

Store configuration is validated locally with Ajv, as a Node dependency. It needs no registration, API key, Python or external service.

- `config/schemas/site-settings.schema.json`: settings, capabilities, selectors, thresholds, inventory, spelling and performance monitoring.
- `config/schemas/sites.schema.json`: a non-empty list of stores and their main fields; it reuses the settings schema through a locally registered `$ref`.
- `config/schemas/commerce.schema.json`: the Woo commerce structure after existing defaults are applied, before URLs are normalized. Shopify ignores Woo-specific settings as before.

`loadSites`, `validateSites` and `resolveSiteSettings` use the shared `config/config-validation.js`. The control panel and the import/save API go through the same validation. The panel still accepts an empty list for a new installation; non-empty lists go through the sites schema.

Ajv checks types, allowed nested fields, enum values, numeric bounds and arrays. It collects errors with the path to the offending field, for example `/0/inventory/productLimit`. It does not coerce `"false"` to a boolean, add defaults or remove fields. It does not include the supplied values in schema error messages. Schemas are compiled once per process; there is no remote schema loading.

Defaults and merging of partial settings stay in the resolver. `Intl` locale/timezone checks, the relationships between time windows, unique slugs, safe storefront URLs and the requirements for scheduled stores remain separate semantic checks. Scheduler jobs/windows continue to be validated by the current scheduler model.

For compatibility, extra top-level store fields are preserved; unknown keys inside the controlled nested settings are rejected. This lets existing metadata and orchestration settings stay in the store file.

### Checkout expectations

The policy is shared by Shopify and WooCommerce and can be chosen in the panel under **Checkout expectations**. It separates navigation to checkout from proving specific fields.

```json
{
  "checkout": {
    "mode": "auto",
    "contact": "required",
    "shippingAddress": "required",
    "requiredAddressFields": ["addressLine1", "city", "postalCode", "country"],
    "reason": ""
  },
  "selectors": {
    "checkoutRoot": "[data-checkout-root]",
    "checkoutEmail": "input[type=email]",
    "cartEmpty": ".cart-empty"
  }
}
```

`mode: auto` checks recognized interfaces. An unrecognized or ambiguous checkout is reported as unverified, not as a pass. `supported` requires exactly one visible checkout root; its absence is a failure. `unsupported` and `blocked` give an explicit unverified result with a `reason`, so field checks never pass on the URL alone.

The contact and shipping policies are `required`, `not-applicable` or `unverified`. Required fields must be visible, unambiguous and editable. For a digital store use `shippingAddress: not-applicable`; for an address on a later step that we do not automate yet, use `unverified` with a reason. A not-applicable field is reported as such, not as checked successfully. A missing required field in a recognized interface is a failure.

The `requiredAddressFields` list is explicit and non-empty. For example, a country without postal codes can use `addressLine1`, `city`, `country`. Additional custom selectors: `checkoutAddressLine1`, `checkoutCity`, `checkoutPostalCode`, `checkoutCountry`. Personal data is never filled in automatically and no order is submitted.

An empty cart is proven by all of these together: an empty public cart in the same session, zero visible cart rows and a visible non-empty empty-state indicator. A cart form alone, hidden empty text or a non-empty API cart is not enough. For a custom UI, configure `cartItems` and `cartEmpty`.
