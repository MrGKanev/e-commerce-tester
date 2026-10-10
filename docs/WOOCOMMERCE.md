# WooCommerce storefront checks

[Back to README](../README.md) · [Configuration](CONFIGURATION.md) · [Commerce evidence](COMMERCE.md)

Shopify and WooCommerce use separate configuration, suites, API/cart adapters and monetary rules. Browsers, scheduling, pacing, reports and approved visual versions remain common. Configurations without `platform` retain Shopify behavior; WooCommerce must explicitly set `platform: "woocommerce"`.

## Configure

Use `examples/woocommerce-sites.example.json`, or select **WooCommerce** in the control panel. Enter public product URLs and actual catalogue/cart/checkout paths. A Woo base URL may include a WordPress installation directory.

```json
{
  "name": "My Woo store",
  "slug": "my-woo-store",
  "platform": "woocommerce",
  "url": "https://example.com/wordpress",
  "commerce": {
    "productUrls": ["/wordpress/goods/shirt/"],
    "routes": {
      "catalog": "/wordpress/catalog/",
      "cart": "/wordpress/basket/",
      "checkout": "/wordpress/pay/"
    },
    "taxDisplay": "including"
  }
}
```

References must stay on the storefront origin without credentials, fragments or admin routes. Relative paths resolve from the installation; leading-slash paths resolve from the origin. Alternatively, use `commerce.productIds: [123, 456]`, whose public permalinks are prepared during setup, or explicitly enable bounded `inventory.discoverProducts`. Scheduled Woo stores require URLs, IDs or discovery, instead of Shopify handles. A sites file may mix platforms with unique store slugs.

Default routes are installation-relative `shop/`, `cart/`, `checkout/` and `?s={query}&post_type=product`. `commerce.apiRoot` defaults to that installation's `/wp-json/wc/store/v1`. Override routes and API root for custom permalinks/REST prefixes; the API root must still identify public `wc/store/v1`. Plain `?rest_route=` APIs and cross-origin headless backends need a separate adapter.

Environment-only use supports `STORE_PLATFORM=woocommerce`, `STORE_URL`, and JSON arrays in `WOO_PRODUCT_URLS` or `WOO_PRODUCT_IDS`. Use a sites file for mixed stores and custom routes/taxes.

## Run

```bash
pnpm test:smoke --site=my-woo-store
pnpm test:commerce --site=my-woo-store
pnpm test:pages --site=my-woo-store
pnpm test:visual --site=my-woo-store
pnpm test:full --site=my-woo-store --project="Mobile Chrome"
```

The scheduler and panel retain existing modes. Woo smoke checks home/catalogue rendering and actual item addition. Full mode adds configured search, prices, JSON-LD, sellability and checkout readiness. Woo execution selects `34-woocommerce` plus inventory-based content, visual, shared-page and performance suites. Shopify-specific suites are excluded before execution; a fixture guard also rejects the wrong platform. Unsupported Shopify features are not counted as verified Woo features.

## Products and visitor cart

Simple products use exposed form/button IDs or block context and public product data. Classic variable products use frontend variation metadata and real select actions. AJAX pickers can resolve a live variation ID through the page's own requests. Common simple block buttons and classic/block cart rows are supported; custom block option widgets without an exposed variation ID remain unverified.

Adds happen through the UI. Cart reads use the same context cookies or the token observed in that frontend's requests. Cleanup credentials come from that session's cart responses. The adapter does not create Admin tokens or disable nonce checks. Clearing uses `DELETE /cart/items`, checks the returned empty list and re-reads the same cart. Mutation scenarios clean their page session in `finally`, except when rate-limited; Woo global teardown never calls Shopify cart endpoints.

Sources: [Products](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/), [Cart](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart/), [Cart Items](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart-items/), [Cart Tokens](https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/), [Nonces](https://developer.woocommerce.com/docs/apis/store-api/nonce-tokens/).

## Prices, tax and evidence

Woo money strings use `currency_minor_unit`; they never inherit Shopify hundredths. Shared parsing takes precision from the adapter. `raw_prices.precision` is not confused with totals' precision. Product price must match pre-coupon subtotal excluding tax or subtotal plus tax. Subtotal, total, their taxes and discounts are recorded separately; a grand total is not equated to a unit price.

Supported cart unit/subtotal layouts display pre-coupon prices for quantity one. Per-line final-price layouts and dynamic-pricing extensions need separate rules. `commerce.taxDisplay` is `including`, `excluding` or `auto`. Auto reads the frontend's `displayCartPricesIncludingTax` when available; zero-tax amounts are unambiguous. A taxed cart without an identifiable display basis remains unverified and requests explicit configuration.

JSON-LD matches selected SKU/offer identity or an explicitly labelled product range with Woo precision/permalinks. Permitted backorders are distinct from blocked stock. Ambiguous identity, hidden prices, unsupported widgets/plugins, unavailable API data and changing price/sellability remain coverage gaps. Exact inventory quantities and all variation combinations are not inferred. Commerce JSON excludes customer addresses, coupon codes, cookies, nonces and Cart-Token values.

Use selector overrides (`commerceRoot`, `addToCart`, `price`, `soldOut`, `cartItems`, `cartUnitPrice`, `cartLinePrice`) for different themes. Grouped/external/subscription/bundle products and cross-origin headless stores need dedicated adapters.

Checkout loads the configured page and checks a visible checkout contact form. It never submits the form or calls checkout POST. Visiting a real checkout can trigger its normal frontend/server behavior, including draft checkout state; disable `capabilities.checkout` if this page should not be exercised.

Visual approval remains per store. Its compatibility fingerprint includes commerce platform, so a platform change requires new review rather than silently reusing a Shopify reference.

## Local checks

```bash
pnpm test:woocommerce:local
pnpm test:acceptance:local
pnpm check
```

Fixtures cover lifecycle hooks, custom installation/routes, classic/block/token/nonce carts, variation/AJAX selection, taxes, discounts, zero/three-decimal precision, backorders, unavailable variants, API denial and wrong cart/UI values. They assert no Shopify endpoints or order submissions. Suite selection and mixed-store child environments have dedicated checks. These validate public contracts locally, not every real WordPress installation.
