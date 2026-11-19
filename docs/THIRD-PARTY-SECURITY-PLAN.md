# Third-party script compromise: monitoring recommendation

Research date: 2026-11-18. This is a proposed implementation plan, not new executable coverage or a malware-clean certification. No live stores were tested for this review.

## Incident and platform boundaries

[Report URI's November 16 investigation](https://blog.report-uri.com/worlds-largest-brands-infected-with-malware-via-optimizely/) found 188 infected snippets associated with 178 organizations among 1,611 checked snippets. Malicious Project JavaScript was served through a trusted Optimizely delivery path, including observed customer-domain variants. The finding does not establish 178 compromises of customer servers. [Optimizely's November 17 preliminary report](https://pages.optimizely.com/rs/947-RKE-048/images/Security%20Incident%20Report%20-%20Optimizely%20Web%20Experimentation%20-%20Nov%2017%202026.pdf) is the vendor's account; incident scope and conclusions may develop. These sources do not establish comparative Shopify/WooCommerce attack-frequency trends.

Shopify's checkout isolation is a useful boundary, not a description of every script on every page:

- [Checkout UI extensions](https://shopify.dev/docs/api/checkout-ui-extensions/2025-10) restrict access to the checkout DOM and sensitive payment data.
- [App/custom pixels](https://shopify.dev/docs/apps/build/marketing/pixels) execute in worker/iframe sandboxes, but still receive permitted events and can send data. Sandboxing is not a guarantee that an allowed integration is trustworthy.
- [Storefront app embeds](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration) can still run JavaScript in storefront pages. Product/cart/account pages and fake overlays remain separate attack surfaces.
- Migration was staged: the [checkout.liquid information/shipping/payment cutoff](https://changelog.shopify.com/posts/the-checkout-liquid-theme-file-is-being-deprecated) was August 13, 2024; [thank-you/order-status migration and ScriptTag deadlines](https://shopify.dev/docs/apps/build/checkout) came later. Do not describe all Shopify applications as sandboxed since 2024.

WooCommerce monitoring also needs an installation-side track. [Official security guidance](https://developer.woocommerce.com/docs/best-practices/security/security-best-practices/) includes updates, integrity checks and malware scanning; public browser tests cannot establish backend/plugin integrity.

## What the repository currently establishes

- [38-third-party-scripts.spec.ts](../tests/38-third-party-scripts.spec.ts) records external script origin/path at initial load when `monitorScripts` is enabled. It has no approved baseline, content hash or unexpected-script verdict, excludes same-origin scripts, and drops query parameters from its inventory key.
- [20-security.spec.ts](../tests/20-security.spec.ts) includes key-pattern/header checks, not a supply-chain malware detector. Its fetched bundle checks do not replace analysis of the actual bytes received by the browser. Legacy platform routing must remain explicit.
- [42-tracking-consent.spec.ts](../tests/42-tracking-consent.spec.ts) and [commerce-expectations.ts](../tests/commerce-expectations.ts) observe configured trackers; a previously unknown endpoint is not automatically a tracker verdict.
- [modern-web-policy.ts](../tests/modern-web-policy.ts) records authored response/meta policies. Presence of a CSP, integrity attribute or sandbox does not demonstrate effective enforcement or safe vendor behavior.

## First implementation — implemented 2026-11-18

The three additions below now run in [`44-security-monitoring.spec.ts`](../tests/44-security-monitoring.spec.ts), with explicit offline baseline approval. See [configuration, rule registry, evidence and limits](SECURITY-MONITORING.md). Legacy checks described above keep their original scope. No live stores were contacted and no merchant baseline was approved.

1. **Observed script-content drift.** Capture bounded SHA-256 evidence from actual browser script responses and executable inline scripts on configured homepage/product/cart/authorized checkout scenarios. Include same-origin assets and distinguish frame/worker context, redirects, opaque/unavailable responses and truncation. Avoid repeat fetches: a later response can differ from the code the browser executed. Preserve exact-content hashes; use redacted URL grouping separately, since query parameters can select different code. Network bytes and authored inline code do not cover every eval/blob/conditional execution path.
2. **Outbound destination drift.** Inventory fetch/XHR, beacon, images, iframes, WebSockets and navigation destinations, including configured pre-consent/reject/accept phases. Compare with approved page/role/consent expectations, not only a known-tracker list. Report a new CDN as reviewable change; prioritize unexpected checkout data destinations. An allowed hostname can still receive inappropriate data, so destination matching alone cannot prove absence of exfiltration.
3. **Payment-interface contracts.** Observe expected checkout origin, form actions and payment-frame origins; flag unexpected payment fields/frames/overlays for review. First-party card fields can be a legitimate architecture and are not automatic skimmer evidence. Canary-value/data-flow checks require an explicitly authorized sandbox: no real cards, personal data, successful orders or synthetic secrets sent to live third parties.

Start as advisory `needs-review` evidence. New or changed code is not synonymous with malicious code. Keep approved expectations separate from run output; a failing/new run must never automatically promote its own baseline. Baseline review needs known-good provenance, since the first captured snapshot may already be compromised. Account for documented A/B variants, consent, region and browser differences without silently accepting unlimited variation.

Local acceptance should include legitimate mutable-vendor updates, same-origin infected-asset simulations, delayed injected loaders, new beacon/POST destinations, consent-phase differences, approved payment frames and unexpected form/iframe destinations. Verify missing/opaque/oversized evidence cannot become a clean verdict. Public reports should contain hashes, bounded structural metadata and redacted destinations, not raw cookies, request bodies, customer data, credentials or complete sensitive bundles.

## Follow-up controls and limits

- Passive native CSP violation telemetry is implemented (2026-11-19), including enforced/report-only disposition and bounded redaction; see [coverage and limits](SECURITY-MONITORING.md#csp-violation-telemetry--2026-11-19). Continue extending effective policy diagnostics across enforced/report-only `script-src`, `connect-src`, `form-action`, `frame-src` and `worker-src`, with observed CSP violations where available. A compromised already-authorized vendor can pass an origin allowlist. Integrity pinning is useful for stable versioned resources; automatically pinning mutable A/B snippets creates breakage and noise.
- With authorized administrator access, audit who can publish code in tag managers/experimentation tools, Shopify app embeds/custom pixels, theme access and API tokens. For WooCommerce, separately audit admins, plugins/themes/core and server-side file changes. A public Playwright run cannot enumerate these permissions.
- Scheduled replay and cross-region/device sampling improve observation, but delayed, targeted or automation-aware attacks may remain invisible. Mobile emulation does not certify real-iPhone behavior. A passing run means no issue was observed in the exercised scenario; it does not certify a store as uncompromised.
