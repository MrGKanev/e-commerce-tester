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

### JSON Schema и Ajv

Конфигурацията на магазините се проверява локално с Ajv, като Node зависимост. Не изисква регистрация, API key, Python или външна услуга.

- `config/schemas/site-settings.schema.json`: настройки, capabilities, selectors, thresholds, inventory, spelling и performance наблюдение.
- `config/schemas/sites.schema.json`: непразен списък с магазини и основните им полета; преизползва settings schema чрез локално регистриран `$ref`.
- `config/schemas/commerce.schema.json`: Woo commerce структура след прилагане на съществуващите defaults, преди нормализиране на URL-ите. Shopify игнорира Woo-specific настройките както преди.

`loadSites`, `validateSites` и `resolveSiteSettings` използват общия `config/config-validation.js`. Панелът и import/save API минават през същата валидация. Панелът продължава да допуска празен списък за нова инсталация; непразните списъци минават през sites schema.

Ajv проверява типовете, позволените вложени полета, enum стойностите, числовите граници и масивите. Събира грешките с път до проблемното поле, например `/0/inventory/productLimit`. Не преобразува `"false"` в boolean, не добавя defaults и не премахва полета. Не включва подадените стойности в съобщенията за schema грешки. Схемите се компилират еднократно за процеса; няма remote schema loading.

Defaults и сливането на частични настройки остават в resolver-а. `Intl` locale/timezone проверки, връзките между времевите прозорци, уникалните slug-ове, безопасните storefront URL-и и изискванията за scheduled магазини остават отделни семантични проверки. Scheduler jobs/windows продължават да се валидират от текущия scheduler model.

За съвместимост допълнителните полета на най-горното ниво на магазина се запазват; непознатите ключове във вложените контролирани настройки се отхвърлят. Това позволява съществуващите metadata и настройки на оркестрацията да останат в store файла.

### Checkout очаквания

Политиката е обща за Shopify/WooCommerce и може да се избере в панела под **Checkout expectations**. Тя отделя навигацията до checkout от доказването на конкретни полета.

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

`mode: auto` проверява разпознатите интерфейси. При неразпознат/нееднозначен checkout резултатът е непроверен, а не успешен. `supported` изисква точно един видим checkout root; липсата му е грешка. `unsupported`/`blocked` дават изрична непровереност с `reason`, без проверките на полетата да минават само по URL.

Contact/shipping политиките са `required`, `not-applicable` или `unverified`. Задължителните полета трябва да са видими, еднозначни и editable. За дигитален магазин използвайте `shippingAddress: not-applicable`; за адрес на по-късна стъпка, която още не автоматизираме — `unverified` с причина. Неприложимото поле се отчита като такова, не като проверено успешно. Липсващото задължително поле в разпознат интерфейс е грешка.

Списъкът `requiredAddressFields` е изричен и непразен. Например държава без пощенски код може да използва `addressLine1`, `city`, `country`. Допълнителни custom selectors: `checkoutAddressLine1`, `checkoutCity`, `checkoutPostalCode`, `checkoutCountry`. Няма автоматично попълване на лични данни или подаване на поръчка.

Празната количка се доказва едновременно с празен public cart в същата сесия, нула видими cart rows и видим непразен empty-state indicator. Сам cart form, скрит empty текст или непразна API количка не са достатъчни. За custom UI настройте `cartItems` и `cartEmpty`.
