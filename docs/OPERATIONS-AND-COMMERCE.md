# Checkout, analytics, markets and operations

All new storefront checks are opt-in. Configure them per store in Settings. Existing stores keep their current behavior. Use synthetic contact/address values: browser evidence and saved configuration may contain entered values. Tests never intentionally submit an order. Checkout must expose its address, shipping choice and totals without a payment submission; staged or hosted flows need matching selectors and may remain unverified.

## Checkout totals

Open **Checkout totals → Configure checkout totals**. Add address fields in the required order, with a selector and a text/select/checkbox action. Select a shipping radio control and specify selectors and expected amounts for subtotal, shipping, tax, discount and grand total. The buyer journey adds one selected product and changes its quantity to two before checking these values.

Amounts are integers in the currency's minor units (EUR 12.50 is 1250, JPY 1250 is 1250). Subtotal means the amount before the separately displayed discount. Discounts are compared as positive magnitudes, including when the UI displays a minus sign. Tax can be included or added separately. The configuration and observed amounts must satisfy:

`total = subtotal + shipping + (taxIncluded ? 0 : tax) - discount`

The optional free-shipping threshold applies to subtotal minus discount. Above or at the threshold, shipping must be zero. Currency must be identifiable in each displayed amount. Zero tax/discount values must be exposed by the configured selector; absent values are not assumed to be zero. The checks wait for totals to settle after entering the address and choosing delivery.

Run with `pnpm test:journey --site=<slug>` or the Full mode in the panel. Detailed observations are attached to the buyer journey report under `checkout-totals`.

## Analytics and consent

Configure **Analytics and tracking consent**, then enable it. The existing buyer journey observes a configured data layer (`dataLayer` by default), with event names for product view, add-to-cart and beginning checkout. Expected payload shape:

```json
{
  "event": "add_to_cart",
  "ecommerce": {
    "value": 29.9,
    "currency": "EUR",
    "items": [{ "item_id": "10", "price": 29.9, "quantity": 1 }]
  }
}
```

Set the analytics product ID to the representative product used by the journey. Each expected event must occur exactly once in the observation window, with the expected item ID, unit price, quantity, currency and line value. Product IDs may differ from storefront variant IDs. Amounts in analytics payloads are major units. The test checks the exposed data layer; it does not establish that an analytics provider received or attributed the event. Direct `gtag` calls, custom network-only payloads, multi-item carts and other event schemas need a dedicated adapter.

The separate consent checks use fresh sessions. Configure accept/reject selectors and tracker hostnames (one per line; subdomains are included). No configured tracker may make a request before consent. All listed trackers must be observed after acceptance; none may appear after rejection or after reloading the rejected session. Observation defaults to one second after each action and is configurable from 100 ms to 10 seconds. This bounds the evidence; scripts firing later are outside the check. This is a configured behavior test, not a legal compliance finding.

Run with `pnpm test:analytics --site=<slug>` or Full. The buyer journey attaches filtered event evidence, and consent checks attach `tracking-consent.json`.

## Markets

Add entries under **Market scenarios**. Each has a landing path, browser locale, expected document language, currency and unit price, optional fields to choose a country, and its own checkout totals/address. Each scenario uses a new browser session and follows the full buyer journey. The market selection must survive navigation to the configured product/search/cart URLs; a lost language or currency selection fails the check. Configure suitable product inventory for these expectations. A market is not inferred solely from the browser locale; use a market path or country selector where the store requires one.

Run with `pnpm test:markets --site=<slug>` or Full. Shopify/WooCommerce and desktop/mobile projects include the new suites. When markets are absent, the market check explicitly skips.

## Open problems

**Problems** lists all currently open check incidents across stores and comparable scopes, including runner interruptions. Each row includes first/last observation and evidence links. Filter by store, check or owner. Set severity, owner, note and optional UTC mute expiry. Concurrent edits are revision checked.

A comparable passed check closes an incident. Skipped or absent checks do not. Configuration changes create a separate scope, so old incidents can remain open until that original scope is checked successfully. Labels and notes do not modify test outcomes. Muted notifications remain pending and are delivered on a subsequent comparable run after unmuting/expiry, including recovery if it occurred meanwhile.

## Retention and pinning

Each store can set maximum runs (default 30), maximum age in days and maximum bytes, displayed as MB in the panel. Zero disables the age/size limit. Cleanup runs after the store execution. It always retains the newest run, unfinished runs, pinned runs and first/latest evidence for every open incident. Protected evidence can exceed the configured limits. Reports for stores outside the current invocation are not pruned.

Use **Reports → Keep this report** to pin a report, and **Unpin report** to release it. Explicit manual deletion remains available separately; automatic retention does not move files to trash.

## Backup and restore

Wait for active runs to finish, then stop the control service and any standalone runner. On the host, create a backup outside the installation directory:

```bash
node scripts/backup.js create /path/to/installation /path/to/backups/2026-10-14
node scripts/backup.js restore /path/to/backups/2026-10-14 /path/to/new-data
```

The new destination contains data directories to mount into a fresh installation: `managed-config`, `scheduler-state`, `reports`, `visual-baselines`, plus `sites.json`/`scheduler.json` when present. It is not an application checkout. Restore never overwrites an existing directory. The backup refuses a live scheduler lock, symlinks and files that change during copying. Restore verifies file paths, a complete manifest and SHA-256 checksums before making the new destination available. Runtime locks/heartbeats, temporary files and report trash are excluded. Environment secrets in `.env` are not included; configure them separately. Custom data locations must be mapped into these standard directories before using this command. The first version is an offline directory backup, without compression or remote storage.

## Setup assistant

Enter a store URL, then choose **Discover products and check setup**. This explicitly visits that storefront. It recognizes Shopify/WooCommerce signals, samples up to six public products, suggests purchasable candidates and checks visible title/price/add/search selectors on the first product. Cross-origin requests and browser writes are blocked. Discovery will not start while the control panel records an active run. It never clicks add-to-cart or submits a form.

Review the result and choose **Use suggested products**, then Save. Suggestions populate products, search text and uniquely matched selectors; they do not enable scheduling. Unknown platforms, ambiguous controls, inaccessible catalogues and unsupported custom installations retain the manual setup path. Discovery is a setup sample, not proof that the complete buyer journey will pass.

## Local validation

- `pnpm check`: schema validation, issue lifecycle/muting, retention and backup/restore unit checks, TypeScript, lint and toolchain.
- `pnpm test:journey:local`: both platforms, valid totals/markets/analytics and deliberate mismatches.
- `pnpm test:operations:local`: local discovery, incident editing, retention forms, desktop/mobile screenshots, axe, and consent request behavior.
- `pnpm test:control:local`: existing control-panel regression checks.

These checks use fixtures, not real stores or external analytics receivers.
