# Public storefront price and availability checks

[Back to README](../README.md) · [Configuration](CONFIGURATION.md) · [Reports](REPORTS.md)

These Shopify checks use the public storefront, JSON-LD and public Ajax endpoints in the visitor's browser session. They require no Admin API, access token or exact inventory quantities. They exercise real UI add-to-cart actions and stop before checkout or order creation.

## Running

```bash
pnpm test:commerce --site=my-store
pnpm test:commerce --site=my-store --project="Mobile Chrome"
pnpm test:commerce:local
```

`test:commerce` selects `@commerce` checks within the existing full mode; they also run in `test:full`. Desktop and the two mobile projects include this suite. Selectors and capabilities remain store-specific. Set `capabilities.commerceConsistency` to `false` to explicitly mark this suite not applicable.

## What is compared

For each configured product, separate scenarios check:

1. **Product and cart prices:** choose an available variant through the UI, wait for its selected ID and active price, compare with the public product response, add through the actual button, and check the cart API and displayed cart unit/line prices. At most two available variants are sampled: the selected/default available variant and one available variant with a different price.
2. **JSON-LD:** compare an offer identified by variant URL or unique SKU. A shared unqualified offer is usable only when the complete API product price range has one price. `AggregateOffer` checks the product range and is explicitly labelled as range coverage, not selected-variant coverage.
3. **Available variant:** the selected variant permits the UI action and the session cart contains exactly that variant, with quantity one.
4. **Unavailable variant:** sample one API-unavailable variant. A disabled picker option blocks selection; if selectable/selected, the purchase control must be disabled and expose a recognizable unavailable indication. No disabled purchase control is forced and no artificial live stock-exhaustion request is made.

The Product API identifies variants and presentment prices. The Cart API supplies the actual session currency and cart lines. Requests use the storefront's locale-aware route root and the same context cookies. This is a consistency check between public observations, not an independent verification of Shopify's internal pricing or physical stock.

## Prices and discounts

- Compare the active sale price, not a hidden regular price or crossed-out compare-at price.
- When a unique visible crossed-out price is present and the API has a higher `compare_at_price`, verify it separately.
- Cart `original_price` must match the selected variant price, and the original line price must match quantity one.
- A lower final line price must reconcile with explicit line-level discount allocations. A missing explanation remains unverified; it does not pass simply because the amount is lower.
- Order-level discount applications are recorded separately. The cart grand total is not equated to a unit or line price; shipping, taxes and order discounts are outside that comparison.
- Displayed cart unit/line prices are compared with the corresponding final API prices.
- Money is normalized without floating-point comparison or percentage tolerances. This Shopify adapter uses its money scaling convention, including the appended hundredths for zero-decimal currencies. Three-decimal currencies need a dedicated precision adapter and remain unverified here.

Sources: [Shopify Product API](https://shopify.dev/docs/api/ajax/reference/product), [Cart API](https://shopify.dev/docs/api/ajax/reference/cart), [variant price semantics](https://shopify.dev/docs/api/liquid/objects/variant), [AggregateOffer](https://schema.org/AggregateOffer).

## Theme-specific selectors

The defaults support common product forms, native variant-ID selects, option selects and radio pickers. There is no universal selector for every custom theme. Use precise overrides when the UI is ambiguous:

```json
{
  "selectors": {
    "commerceRoot": "main product-info",
    "productForm": "form[action*='/cart/add']",
    "price": ".price-item--sale",
    "cartItems": ".cart-item",
    "cartUnitPrice": "[data-cart-item-price]",
    "cartLinePrice": "[data-cart-item-total]",
    "soldOut": "[data-stock-status]"
  }
}
```

Product selectors are evaluated within `commerceRoot`; cart price selectors are evaluated within the unique cart line. `price` must include the active currency indicator and exclude hidden/crossed-out prices. Do not copy the example unchanged unless those selectors fit the theme.

## Evidence and incomplete coverage

Each scenario attaches `commerce-consistency.json`: product/variant IDs, options, expected and observed amounts, currency, discounts and assessment. Raw cookies, cart tokens, customer fields and full cart responses are not copied into it. The reporter checkpoints a combined run-level file; the dashboard displays the observations and reasons. Screenshots are attached for failed/unverified observations when capture is possible.

`CommerceUnverified` produces an ordinary skip with a clear reason and stays in applicable coverage. Reasons include ambiguous JSON-LD offers, unsupported pickers, a missing unavailable sample, products requiring selling plans, a selected selling plan, minimum quantity rules, unexplained discounts, missing currency evidence, unsupported precision and price/availability changes during the check. Explicitly disabling the capability is distinct from these unknown cases.

Price or sellability changes detected by a bounded public API re-read are reported as changing data, not as a successful comparison or a proven static mismatch. Unsupported bundles and complex pricing need separate scenarios. Unrepresented option combinations and exact stock quantities are not inferred. The public Product API can truncate its variant list; this suite does not claim catalogue-wide coverage.

Cart-changing scenarios clear the visitor cart before adding and again after the check, unless a rate-limit guard prevents further requests. This affects the test session cart and never places an order.

## Local validation

`pnpm test:commerce:local` uses a loopback server with a real cookie cart session. It checks locale paths, sale/compare-at prices, different-price variants, radio/option pickers, automatic line and order discounts, zero-decimal currency, stale UI prices, wrong currency/variant/quantity/cart rendering, JSON-LD ranges and mismatches, sellability, races and unsupported subscriptions. It is included in `test:acceptance:local` and CI.

WooCommerce now uses its own adapter and suite; see [WooCommerce checks](WOOCOMMERCE.md). Shared money/schema utilities require explicit Woo precision and permalink identity. Shopify cart invariants remain separate from Woo tax/discount rules.

## One buyer journey — Shopify and WooCommerce

`pnpm test:journey --site=<slug>` runs the shared `36-buyer-journey` spec (`@full`, `@journey`). It runs in a separate, empty browser session and does not inherit the global cart. It needs no intervention during the run and no administrator credentials.

Planning considers up to six products from the prepared inventory, prefers a product with an available variant, and chooses a combination for quantity 1 → 2. Unsupported or sold-out candidates are recorded; if no suitable product exists, the scenario stays unverified. A simple product can pass the scenario, with the variant selection marked as not applicable.

The journey uses the real UI controls: search by name, click the exact product, choose a variant, add to cart, change the quantity in the cart and click through to checkout. Shopify verifies the public localized Cart API with the same cookies. WooCommerce verifies the Store API in the same cookie/token/nonce session, with separate currency precision and tax display policy. It never adds or changes quantity through the API in place of the user.

It checks the exact product/variant ID and quantity in the public cart, the active product price and the UI line totals. Checkout must show a readable summary with the correct name/options, quantity and line amount. The line price is not the final payable total, which includes shipping and address-dependent taxes. WooCommerce uses the subtotal according to the configured or observed tax display; Shopify uses final line amounts and the available discount allocations. Other promotion models may need a separate adapter.

It never presses Place order/Pay and never fills in customer data. Known Woo checkout mutation and order/payment endpoints are blocked by a browser route guard. If checkout itself requires such a request, the scenario stays unverified. After adding, the cart is cleaned up in `finally`, except when the shared rate-limit stop applies; cleanup errors are also reported. Opening checkout may create a standard checkout session/draft, depending on the platform.

The JSON attachment `buyer-journey.json` holds the status and the expected/observed values for each step: plan, search, product, variant, add, quantity, checkout, cleanup. The reporter collects a separate `buyer-journeys.json`. The control panel and history show a separate "Buyer journey" section with the status, the problem step and the comparisons. Tokens and raw cart payloads are not written to the evidence.

Additional selectors for custom themes: `searchInput`, `searchResults`, `cartUpdate`, `checkoutButton`, `checkoutSummary`, `checkoutQuantity`, `checkoutLinePrice`, together with the existing product/cart selectors. Ambiguous controls, single-quantity limits, unsupported products, CAPTCHA and an inaccessible checkout summary stay unverified; success is never accepted from the checkout URL alone.

Local check for both platforms: `pnpm test:journey:local`. It is also part of the shared acceptance set in CI.
