# Performance measurements

[Back to README](../README.md) · [Configuration](CONFIGURATION.md)

## Passive collection

The collector is installed through `BrowserContext.addInitScript` before application JavaScript. It observes documents opened by normal scenarios without making HTTP requests or opening additional pages. Data is attached to tests and merged into `reports/<site>/<run>/web-vitals.json`.

```bash
pnpm test:pages
pnpm test:full
```

Shared-page mode opens each inventory URL once within its scenario and reuses the document for title/canonical, viewport overflow, visible media, axe WCAG 2.2 AA, spelling and screenshot evidence. The browser still loads normal CSS/JS/images/API resources, and setup/teardown remain separate. Evidence screenshots are not pixel comparisons; visual mode handles baselines.

## Recorded observations

| Observation          | Meaning                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CLS                  | Maximum session window, up to five seconds with gaps of at most one second; excludes shifts with recent input                                |
| LCP                  | Last candidate within the bounded observation window                                                                                         |
| Navigation timing    | TTFB, DOMContentLoaded and load from the existing document                                                                                   |
| Named interactions   | Menu, variant selection and cart actions already exercised by tests; Event Timing entries grouped by `interactionId`, using maximum duration |
| Operation readiness  | Separate elapsed time that includes automation, network activity and request pacing                                                          |
| Resource diagnostics | Transfer bytes are a lower bound when cross-origin timing is unavailable; render-blocking status is recorded only when exposed by the API    |

All measurements are **synthetic**. A few scripted interactions do not constitute field INP or a real-user Core Web Vitals assessment. Reports preserve periods, URLs, browsers, scenarios, raw entries, operations and reasons for missing measurements. Pacing effects are not silently subtracted.

## Observation windows and missing data

These are the defaults:

```json
{
  "performanceMetrics": {
    "enabled": true,
    "mode": "report",
    "afterDomMs": 5000,
    "maxPaintMs": 15000,
    "minPaintMs": 500,
    "maxEventMs": 120000
  },
  "thresholds": { "webVitals": { "lcp": 2500, "cls": 0.1, "interactionLatency": 200 } }
}
```

Paint observers finish up to five seconds after DOMContentLoaded, within a total 15-second window, or at the natural end of the document/scenario. The collector does not add a five-second wait to every test. Short observations can be insufficient for CLS. Event observers run until document completion or their configured maximum.

On completion, pending records are processed and observers/timers released. A bounded flush of up to 100 ms preserves final Event Timing entries.

Missing APIs, insufficient observation or absent qualifying events produce **unmeasured** values with a reason and `null`, not a successful zero. Supported CLS observation with sufficient duration and no shifts can legitimately produce zero. Event Timing may filter events below 16 ms. First-input data is diagnostic and does not replace a complete interaction; a failed operation remains failed regardless of event latency.

`report` is the default and records within-budget, over-budget and unmeasured results without failing otherwise successful functional tests. `strict` fails an otherwise successful scenario for unmeasured or over-budget metrics. Use strict mode for a controlled profile: short tests and unsupported browser APIs can remain unmeasured. Set `enabled` to `false` to disable passive collection.

## Lighthouse and network throttling

```bash
pnpm test:audit
```

These checks require separate navigations or a modified network profile and are opt-in `@audit` scenarios. They are not part of the default full run.

Four Lighthouse URLs (homepage, product, collections and search) run only in the first selected Chromium project, without retries. Firefox and WebKit skip Lighthouse. Each audit uses an isolated temporary profile and a dynamic debugging port.

HTML/JSON results live under the test output directory in `screenshots/<test>/lighthouse/` and are attached even when a score threshold fails. Request pacing remains enabled; Lighthouse may perform multiple internal page loads. Separate Chromium CDP scenarios exercise fast-4G and slow-3G profiles.

## Offline verification

```bash
pnpm test:vitals:local
pnpm test:pages:local
pnpm test:lighthouse:local
```

Loopback fixtures cover nonzero/zero CLS, unsupported APIs, short windows, final LCP candidates, slow clicks, failed operations and observer cleanup. Request-count checks verify that passive collection and shared checks add no separate measurement navigation.
