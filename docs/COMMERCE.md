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

## Един покупателен път — Shopify и WooCommerce

`pnpm test:journey --site=<slug>` изпълнява общия `36-buyer-journey` (`@full`, `@journey`). Работи в отделна празна browser сесия, без наследяване на глобалната количка. Не изисква намеса по време на изпълнение или административни credentials.

Планирането разглежда до шест продукта от подготвеното inventory, предпочита продукт с наличен вариант и избира комбинация за количество 1 → 2. Неподдържаните/изчерпани кандидати се записват; ако няма подходящ продукт, сценарият остава непроверен. Прост продукт може да мине сценария, като изборът на вариант се отбелязва като неприложим.

Пътят използва реалните UI контроли: търсене по име, клик върху точния продукт, избор на вариант, добавяне, промяна на количеството в количката и клик към checkout. Shopify проверява публичния локализиран Cart API със същите cookies. WooCommerce проверява Store API в същата cookie/token/nonce сесия, с отделна валутна точност и tax display политика. Не добавя или променя количество чрез API вместо потребителя.

Проверява точния product/variant ID и количество в публичната количка, активната продуктова цена и UI сумите на реда. Checkout трябва да има четим преглед с правилните име/опции, количество и сума на реда. Цената на реда не е крайна сума за плащане с доставка и адресно зависими данъци. WooCommerce използва subtotal според configured/наблюдаваното данъчно показване; Shopify използва final line amounts и наличните discount allocations. Други промоционални модели могат да изискват отделен адаптер.

Никога не натиска Place order/Pay и не попълва клиентски данни. Известните Woo checkout mutation и order/payment endpoints се блокират от browser route guard. Ако самият checkout изисква такава заявка, сценарият остава непроверен. След добавяне количката се чисти в `finally`, освен при общия rate-limit stop; грешките при cleanup също се отчитат. Отварянето на checkout може да създаде стандартна checkout session/draft според платформата.

JSON attachment `buyer-journey.json` съдържа статуса и очакваното/наблюдаваното за всяка стъпка: plan, search, product, variant, add, quantity, checkout, cleanup. Reporter-ът събира отделен `buyer-journeys.json`. Панелът/историята показват отделен раздел „Buyer journey — Покупателен път“, със статус, проблемната стъпка и сравненията. Tokens и raw cart payload не се записват в evidence.

Допълнителни selectors за custom теми: `searchInput`, `searchResults`, `cartUpdate`, `checkoutButton`, `checkoutSummary`, `checkoutQuantity`, `checkoutLinePrice`, заедно със съществуващите product/cart selectors. Нееднозначни контроли, еднобройни ограничения, unsupported products, CAPTCHA и недостъпен checkout summary остават непроверени; не се приема успех само от checkout URL.

Локална проверка за двете платформи: `pnpm test:journey:local`. Включена е и в общия acceptance набор за CI.
