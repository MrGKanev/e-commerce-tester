# Third-party script and payment monitoring

`44-security-monitoring.spec.ts` (`@full`, `@security`) runs on Shopify and WooCommerce, including desktop/mobile. It observes real browser script responses, destination changes and payment-interface structure. These are change-detection checks, not malware attribution or certification that a store is uncompromised. Legacy `38-third-party-scripts.spec.ts` stays an independent external-script inventory.

## Configuration

Add this to the store's settings, replacing the example origins and selectors with reviewed values:

```json
{
  "securityMonitoring": {
    "enabled": true,
    "mode": "report",
    "profile": "anonymous-bg",
    "observeMs": 1000,
    "phases": ["initial", "reject", "accept"],
    "pages": [
      { "name": "home", "path": "/", "role": "storefront" },
      { "name": "cart", "path": "/cart", "role": "storefront" },
      { "name": "checkout", "path": "/checkout", "role": "checkout" }
    ],
    "consent": {
      "acceptSelector": "#consent-accept",
      "rejectSelector": "#consent-reject"
    },
    "payment": {
      "checkoutOrigins": ["https://store.example"],
      "formOrigins": ["https://store.example"],
      "frameOrigins": ["https://payments.example"],
      "allowTopDocumentCardFields": false
    }
  }
}
```

Monitoring defaults to disabled, except legacy `monitorScripts: true` enables it unless explicitly overridden. Without `pages`, the configured inventory URLs run as storefronts; checkout must be explicitly designated. Checkout URLs on a different origin require an explicit `checkoutOrigins` entry. Public page validation rejects administrator routes, URL credentials and fragments. Configure only authorized reachable pages; the monitor never fills cards, adds products or submits checkout forms to make a checkout reachable.

Each page/choice gets a fresh browser context with empty storage. Automatic consent handling is disabled for this suite. Reject/accept choices observe an initial stage, click their explicitly configured unique visible enabled native button, and observe the chosen stage. A form submitter is refused. Configuration is an authorization contract: verify selectors target consent actions. A site button's JavaScript still runs and can make requests. Navigation or consent-control failures fail even report mode.

`profile`, browser project, page name, role, consent choice/stage, locale and timezone isolate baseline scopes. A profile is a label, not a geographic proxy; configure the actual execution environment separately. Native mobile devices and additional regions need separate coverage.

```bash
# Visits the configured store; use only for authorized stores.
pnpm test:security --site=my-store

# Offline verification against owned fixtures only.
pnpm test:security:local
pnpm test:security:entry:local
```

## Evidence and approval

Every scenario attaches `security-monitoring.json` and a concise text summary. Status is `needs-review` when no baseline exists or a comparison/contract finding appears; `unverified` when known evidence is incomplete; otherwise `matches-baseline` for that exercised scope. `report` mode preserves findings without failing a successful page/consent scenario. `strict` mode fails changes, missing approval and incomplete observations. Neither mode automatically changes a baseline or merchant configuration.

Review candidate evidence with known-good release/vendor provenance before approval. The first observation may already contain compromised code. Collect every required browser/page/consent/profile scope in report mode, then review and approve each JSON attachment offline, one at a time:

```bash
pnpm security:baseline review --candidate /path/to/security-monitoring.json \
  --baseline security-baselines/my-store.json

# Copy reviewHash from the JSON above after inspecting the old/new differences.
pnpm security:baseline approve --candidate /path/to/security-monitoring.json \
  --baseline security-baselines/my-store.json --reviewed \
  --reason "Reviewed vendor release SEC-123 against the deployment record" \
  --review-hash "COPY_64_CHARACTER_REVIEW_HASH"

pnpm security:baseline history --baseline security-baselines/my-store.json --limit 20
# For the next older page, pass --before with nextBefore from the previous page.
```

`review` never writes a baseline or contacts a store. Its bounded JSON diff shows new/changed/unchanged scopes, old/new exact script digests, added/removed destination fingerprints/origins and payment-field differences. Arbitrary script/destination/form-action strings are rendered as fingerprints rather than raw paths or code. Scope metadata remains operator-supplied: configuration-generated labels are constrained, while handcrafted legacy scope labels may contain private ordinary text or path-like labels. URL/credential/known-secret-looking labels are fingerprinted/redacted, but the review output is not proof that arbitrary metadata contains no personal information. Protect these artifacts accordingly. Incomplete candidates and invalid replacement/variant requests remain unapprovable; a diff is not a malware verdict.

For a release that replaces existing scopes, pass `--replace` to both `review` and `approve`. `--add-variant` only adds reviewed script digests for unchanged script keys, destinations and payment structure; it cannot approve a new destination or a different checkout contract. The review hash binds the complete parsed candidate, current baseline including its history, chosen mode and machine diff. A changed candidate/baseline or a different mode requires a fresh review. In particular, review the next attachment only after approving the preceding attachment. Hashes use canonical object-key ordering, not raw JSON whitespace.

Every new approval requires `--reviewed`, a nonempty single-line reason (at most 500 characters), and the current `--review-hash`. The programmatic helper also requires a reason; its optional `reviewHash` guard is available for interactive integrations. Reasons pass through the shared text privacy filter before persistence and audit hashing. Use a release/ticket reference and provenance summary, never credentials or customer data; pattern-based redaction cannot recognize every possible sensitive value and cannot erase shell history. The reason is an operator assertion, not an authenticated reviewer identity.

Then set `securityMonitoring.baselineFile` to `security-baselines/my-store.json` and optionally `mode` to `strict`. An explicitly configured missing/invalid baseline is an error. Files must stay under the repository's `security-baselines/` directory, without symlinks. Approval refuses incomplete candidates and existing scopes unless the selected replacement/variant mode allows them. Ordinary store runs read this file and never append approval history.

### Audit history and persistence

Schema-version-1 baselines without `history` remain readable and comparable; no retrospective reason is invented. The first subsequent explicit approval starts an audit chain anchored to the previous approvals. New records retain the redacted reason, timestamp, mode, candidate/review hashes, before/after approvals hashes and complete before/after snapshots for affected scopes. `history` presents a bounded redacted diff, newest first: 20 records by default, up to 100 per page, with `nextBefore` pagination. The baseline retains every record; pagination never deletes history.

Validation checks each record hash/link, scope snapshots and reversible before/after approval hashes against the current reference. This detects accidental or partial edits; it is local tamper evidence, not an authenticated signature. Anyone who can rewrite the file and recompute the chain can forge it. Protect baseline write permissions and independent version-control/review records. A baseline is capped at 5 MiB and 1000 history entries; growth beyond either limit is refused rather than silently dropping records. Retain the old file and create a separately reviewed baseline version when archival is needed.

Approvals serialize through a sibling `.lock` file, recheck the baseline after computing the update and atomically replace it only after all validation passes. A stale review, invalid reason, malformed file, occupied lock or failed validation leaves the existing baseline bytes unchanged. After an interrupted approval, inspect the lock and confirm no approval process remains before manually removing it; locks are never automatically declared stale. Backup/restore includes baseline/history files and verifies archive checksums, while transient locks and temporary writes are excluded. Docker Compose mounts this directory read-only into runners/control/scheduler; run approval on the host. Baselines are excluded from image build context. Owned acceptance fixtures use temporary baselines and remove them afterward; no merchant reference is supplied or auto-approved.

Hashes are observations of potentially untrusted bytes. They are never injected as SRI or treated as trust without review. Query strings are excluded from stable script grouping; different returned bytes at the same origin/path/context still trigger content drift. Approved variants allow only their exact hashes, not arbitrary future vendor updates.

## CSP violation telemetry — 2026-11-19

Monitoring now installs a passive `securitypolicyviolation` listener before scenario navigation, in main and child documents. Random ephemeral document markers avoid dependence on privacy-rounded clocks; a bounded startup queue handles binding initialization order. `policy.events` records only normalized effective directive, `enforce`/`report` disposition, blocked/document origin, main/frame context, blocked kind (URL/inline/eval/etc.) and grouped count. It never exports `originalPolicy`, `sample`, nonce/hash source tokens, source-file URLs, report endpoint values, paths or queries. Synthetic DOM violation events (`isTrusted: false`) are ignored. No prohibited probe, policy, script, form submission or reporting endpoint is injected into a live storefront. Owned local fixtures alone exercise deliberate CSP denials.

`security-csp-violation` and `security-csp-report-only-violation` are warning findings. Enforced events record browser-reported denial; report-only events do not mean a resource was blocked. Strict mode requires review of either type, even when script/destination/payment baselines match. Approving a baseline cannot suppress these warnings. A listener being installed, a CSP header being present, or zero events never proves that a policy is effective or comprehensive. Browser console messages, site callbacks, workers, reporting-server delivery and violations occurring outside the scenario window are not fully covered.

There is a 200-event budget per document and per stage; equivalent normalized events are grouped. Saturation is explicit and makes coverage unverified, including later stages after document-budget exhaustion. Missing listener/feature/document evidence also remains unverified. The document readiness check is bounded; inaccessible frame content is skipped with an explicit coverage gap. Attribution uses binding receipt time (`phaseAttribution: binding-receipt`); a queued event can cross a consent boundary. Same-page telemetry is not tamper-resistant against hostile JavaScript (`tamperResistant: false`), and the ephemeral Playwright binding is not an authenticated browser security-reporting channel. Stopping the collector disposes its binding and future init script and discards subsequent callbacks. Existing page listeners live only until their isolated context closes; the suite closes that context afterward.

### Worker CSP boundary — 2026-11-19

A document can report denial of worker creation (`worker-src`), including fallback through child/script/default source directives. That is distinct from CSP violations inside an allowed worker, governed by its execution environment and response policy. The document listener does not observe WorkerGlobalScope events. `policy.workerCreationTelemetry` is `document-events-only`; `policy.workerExecutionTelemetry` is `unavailable` after any dedicated worker is observed, otherwise `not-observed`. Neither value certifies worker absence or complete CSP coverage.

An observed worker now adds `csp-worker-execution-unobserved` to incomplete coverage and keeps current/later consent stages unverified, including after termination or inventory saturation. Existing workers are registered when monitoring an already-open page. Script hashing does not clear this gap. Strict mode fails and candidate approval refuses incomplete evidence; existing baselines are unchanged. This is a coverage limitation, not a new warning or an accusation of malicious code. Shared/nested/service workers, worker-internal events from startup and report delivery remain open. The monitor does not inject worker listeners or replace worker scripts. [Owned validation and remaining work](TESTS.md#worker-csp-boundaries--2026-11-19).

### Reporting configuration and receipt — 2026-11-19

`policy.reportDeliveryVerified: false` makes the delivery boundary explicit in every new security stage. A native violation event, attempted request or authored endpoint never establishes server acceptance, durable ingestion or alerting. No live endpoint probes or raw CSP report capture were added to the security collector. The Modern Web inspector separately records redacted reporting configuration and the advisory `policy-csp-reporting-endpoint` name mismatch; that warning belongs to Modern Web and is not a security-baseline rule. Full receives response headers; current Pages auditing has meta-only policy evidence.

Owned loopback acceptance fixtures test actual native legacy `report-uri` receipt under enforced/report-only policy (HTTP 204), plus a receiver returning HTTP 503. Only transient bounded synthetic reports are parsed and directive/status counters retained. Modern Reporting API uploads, production receiver ingestion and worker reporting are not certified. See [rules, evidence, parser bounds and validation](TESTS.md#csp-reporting-configuration-and-owned-receipt--2026-11-19).

### Modern upload calibration and Pages header evidence — 2026-11-19

`pnpm test:security:reporting:local` exercises native modern `report-to` uploads without legacy fallback against an owned HTTPS loopback receiver, using full Chromium/new headless desktop/mobile emulation. Installed full Chromium and OpenSSL (`req -addext`) are required; the test generates and removes temporary TLS material, trusts only its SPKI, and shortens reporting delay in the isolated fixture launch. No store runner flags or system certificate trust change. Enforced/report-only HTTP 204 receipt and a failing HTTP 503 receiver are calibrated. Bounded redacted `reporting-api-calibration.json` attachments contain no raw report bodies or URLs. This lab receipt never upgrades live `reportDeliveryVerified: false`; production ingestion, worker reporting, normal headless-shell and cross-engine parity remain unverified.

Pages now supplies its existing navigation response headers to the shared passive Modern Web audit for configured and extra discovered pages, enabling the already-documented policy/reporting diagnostics without extra visits or endpoint probes. Missing header input remains unknown. The earlier meta-only Pages limitation is superseded by this batch. [Setup, rule applicability, validation and remaining limits](TESTS.md#modern-reporting-api-upload-and-pages-headers--2026-11-19).

The [additional regression batch](TESTS.md#reporting-negative-controls-and-redirected-pages--2026-11-19) adds missing/default/case-mismatched/non-string/opaque endpoint cases, each bracketed by actual successful uploads from separate same-context documents. No received negative report is claimed only inside that bounded positive-control window. Real loopback redirects additionally verify Pages uses final response headers, with no audit refetch. These are test expansions; live delivery flags and storefront rules are unchanged.

The [cross-origin regression batch](TESTS.md#cross-origin-reporting-preflight-and-cookies--2026-11-19) verifies real native OPTIONS/POST behavior on two owned HTTPS origins: allow, missing/wrong allowed origin and missing allowed header. Same-origin reports carrying a seeded synthetic cookie bracket each attempt, while permitted cross-origin reports omit cookies. Only booleans/counters are attached; raw cookies/headers/bodies remain transient. These fixture results do not change live delivery flags or certify cross-browser/merchant infrastructure.

Modern Web additionally records selected endpoint URL parse/scheme status and advisory `policy-csp-reporting-url` for invalid/non-HTTP references, without fetching or exporting endpoint values. This is a passive authored-configuration rule, not a security-baseline rule or TLS/CORS/delivery check. See [the reviewed test inventory and remaining obligations](MODERN-WEB-REVIEW.md).

## Rules

| Rule | Severity | Evidence / meaning |
| --- | --- | --- |
| `security-baseline-missing` | warning | No approval for the exact scope |
| `security-script-added`, `security-script-removed` | warning | Executable response/inline key added or absent |
| `security-script-content-changed` | warning | SHA-256 differs from all reviewed variants for the key |
| `security-destination-added` | warning | New origin/resource type/method/source kind, including redirect/navigation hops |
| `security-payment-interface-changed` | warning | Document/form/frame origins, hashed form-action paths or card-field/overlay counts differ |
| `security-payment-contract-unconfigured` | warning | Checkout lacks explicit origin/field policy |
| `security-checkout-origin`, `security-storefront-origin` | high | Observed page origin violates the configured scenario |
| `security-payment-form-origin`, `security-payment-frame-origin` | high | A form/frame origin is outside the explicit checkout contract |
| `security-top-document-card-fields` | high | Visible autocomplete-marked card fields violate an explicit prohibition |
| `security-csp-violation` | warning | Browser CSP violation event; disposition and directive retained, enforcement only attributed when reported as enforced |
| `security-csp-report-only-violation` | warning | Browser report-only violation; resource may still execute/send |
| `security-consent-control-unavailable` | warning | Configured control cannot be exercised safely; coverage is incomplete |

High severity means a contract violation requiring review, not proof of a skimmer. Every checkout iframe is inventoried; payment purpose is unverified. Legitimate first-party card fields are supported through explicit `allowTopDocumentCardFields: true`. Empty origin lists mean unconfigured, not deny-all. Form-action queries are not compared; same-origin endpoint payloads are outside this monitor.

## Coverage limits and privacy

Actual JavaScript response bodies are hashed without additional fetches, including same-origin assets, module/JavaScript MIME responses and redirect final responses. Current executable inline scripts are sampled in main/child frames; snapshots do not prove execution and miss removed scripts. Responses can arrive after the configured observation window. Pending, failed, oversized, truncated or unavailable evidence stays unverified. Dedicated workers are recorded; unavailable worker code is explicit. Firefox can report an unresolved worker URL; that observation remains unverified. Service workers are blocked in these isolated contexts, so production service-worker behavior is untested. Blob/eval/dynamic code, worker WebSockets, WebRTC, cached existing sessions, shadow DOM, covert traffic, automation-aware/geo-targeted or delayed attacks are not comprehensively covered.

Destination comparison groups origin, resource type, method and source kind; it does not inspect request bodies, cookies, headers, WebSocket frames or field values. Allowed origins can still receive leaked data. Reports retain origins and SHA-256 fingerprints of URL/path/code, never plaintext script bodies, URL paths/queries/credentials or request payloads. Hashes are pseudonymous fingerprints, not irreversible anonymization of guessable inputs. These guarantees apply to the security JSON/text attachments; other runner logs, Playwright failure contexts and existing report families have their own policies and may contain page text/URLs. Protect artifacts accordingly. The [shared artifact privacy filter](ARTIFACT-PRIVACY.md) additionally protects selected newly persisted diagnostic outputs, with explicit raw browser/file-artifact exclusions.

Default limits: 100 script responses, 500 requests, 20 frames, five pages, 2 MiB per script and 8 MiB total script bytes. Configurable ceilings are validated in the settings schema. DOM forms/iframes are sampled up to 100 per frame. The body reader uses Playwright's buffered `response.body()`; declared content length is checked first, but undeclared/compressed bodies can allocate more memory before rejection. These are observation/retention budgets, not a hard streaming memory cap. The window defaults to 1000 ms plus a bounded two-second response drain; reported elapsed time includes navigation and inspection. It is unrelated to field INP.

No merchant CSP, vendor permissions, app/plugin configuration or server files are changed. Admin publishing rights, WooCommerce filesystem/plugin integrity, effective CSP enforcement and sandboxed canary data-flow probes remain separate authorized work. See [the research and remaining controls](THIRD-PARTY-SECURITY-PLAN.md).
