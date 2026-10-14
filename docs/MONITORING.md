# Monitoring and comparisons

`run.sh` / `scripts/run-sites.js` process every finished run, including scheduler runs. Direct `playwright test` invocations collect evidence but do not deliver notifications. All features are opt-in. The control panel exposes store expectations, third-party monitoring and notification enablement under **Store expectations and monitoring**.

## Change notifications

Set `MONITORING_WEBHOOK_URL` in the runner/scheduler environment and `REPORT_BASE_URL` to the public origin of the report server. Enable `notifications.enabled` on a store. A different environment variable can be selected with `notifications.webhookEnv`; secret URLs are never stored in reports or entered in the panel.

```json
{
  "notifications": {
    "enabled": true,
    "webhookEnv": "MONITORING_WEBHOOK_URL",
    "maintenance": [
      { "start": "2026-12-01T09:00:00Z", "end": "2026-12-01T11:00:00Z" }
    ]
  }
}
```

The receiver accepts a JSON POST containing `site`, `run`, `reportUrl` and `events`. Events include `state` (`new`, `confirmed`, `recovered`, or script `changed`), `category`, and check name or added/removed script URLs. This is a generic webhook contract, not a native Slack/Discord/Telegram payload; use a receiver/adapter for those channels. Email is not implemented.

A failed check creates a new incident; its next comparable failure confirms it. Further failures do not repeat notifications. Only a passed result recovers an incident: skipped, flaky, interrupted and absent checks cannot claim recovery. Configuration, browser and check-selection changes create separate histories. State is persisted in `reports/<store>/.monitoring/` and survives scheduler restarts.

Maintenance windows temporarily suppress delivery. Pending transitions are delivered together after the window on the next run of the same scope. Failed deliveries are also retried on that scope's next run. HTTP redirects are rejected and delivery has a 10-second timeout. `notifications.json` records delivery separately from storefront results and the panel shows its status. Delivery is at least once if the process stops after the receiver accepts a request but before state is written; receivers can deduplicate by site/run/events. An unavailable receiver does not change the storefront test outcome. Without `REPORT_BASE_URL`, report links are relative.

## Failure classification

Reports expose a possible cause for failed checks: `blocked`, `product-missing`, `selector`, `infrastructure`, `storefront`, or `unverified`. Classification uses recorded error evidence and is diagnostic, not proof of root cause. Unrecognized errors remain unverified. Blocking and selector errors must not be interpreted as confirmed store outages solely from this label.

## Store expectations

```json
{
  "expectations": {
    "minProducts": 5,
    "currency": "BGN",
    "paymentPath": "/checkout",
    "paymentSelector": "[data-payment-method='example']"
  },
  "monitorScripts": true
}
```

The smoke/full suites check the minimum public product count (1–100; 0 disables), exact currency, and one visible enabled payment control. Shopify uses public products/cart endpoints; WooCommerce uses its public Store API. Unconfigured expectations are explicitly not applicable. Payment checks visit the configured path in a fresh browser session; choose a path exposing the control without an existing cart/login. This checks the rendered control, not processing a payment or completing an order.

## Third-party scripts

The smoke/full/audit inventory records external script requests on the homepage through the load event after consent handling. It strips query strings and fragments to avoid tokens and cache-buster noise. A first successful inventory establishes the baseline; subsequent inventories in the same scope record additions/removals in `script-changes.json` and create grouped webhook events. Failed/skipped inventory collection preserves the previous baseline.

The result covers observed external script URLs, not every installed app: same-origin proxies, inline scripts, later timers and scripts loaded only on other pages are outside this observation window. A difference is a review signal, not a GDPR compliance finding.

## Trends and candidate comparison

Reports show up to 30 runs matching the selected run's scope, with pass rate, coverage and the median measured synthetic LCP. Missing metrics remain unmeasured. An accessible table accompanies the charts. Synthetic measurements depend on runner hardware and page data; they are not real-user field metrics.

To compare staging with production, configure staging as a separate store, run the same mode/browser selection on each, select the production report, then choose the saved candidate report. The panel compares matching checks and shows regressions, improvements, unchanged and unverified results plus pass-rate/LCP deltas. Different platforms, modes or browser selections are rejected. Missing or skipped checks never count as improvements. Review store configuration, content and products before attributing differences to a theme. Comparison reads saved evidence only; it does not launch runs or approve visual baselines.

## Local verification

`pnpm test:monitoring:local` exercises successful and deliberately failing expectations and external script capture against local Shopify/Woo fixtures. Node tests cover incident transitions, maintenance, webhook delivery failures/retries, script changes and comparisons. `pnpm test:control:local` covers settings persistence, candidate comparison, desktop/mobile layout and accessibility. No real-store or external notification delivery is needed.

Open problems now have a cross-store panel, first/latest evidence, ownership, severity, notes and expiring mutes. See [operations](OPERATIONS-AND-COMMERCE.md#open-problems).
