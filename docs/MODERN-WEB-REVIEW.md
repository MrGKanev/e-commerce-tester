# Modern Web implementation and test review — 2026-11-20

[Coverage matrix](MODERN-WEB.md#complete-catalog-mapping) · [Validation record](TESTS.md)

209 guide topics remain **1 Covered / 62 Partial / 48 Pending / 98 outside scope**. These are topics, not test counts. The existing suite already covers forms, disclosures, tabs, sliders, composite/menu/tooltip/carousel keyboard samples, responsive/text/preference stress, table/progress semantics, resource hints, policies and opt-in script/destination/payment monitoring. Do not add a second generic inspector or count axe/fixtures alone as completion.

## Chosen work and why

| Decision | Result / reason |
| --- | --- |
| Check bounded table-span occupancy | A complete bounded native row-group model detects occupied-slot intersections; valid spans and rowspan zero are accepted. CSS/implicit/oversized models remain unknown, and no inferred-header or rendered-overlap claim is made. |
| Preserve checkbox ownership | Binary Space reversal retains exact nodes/context and never refocuses after theft. Mixed states are excluded; native conditional DOM cleanup is distinguished from keyboard success; custom ARIA state is preserved on incomplete reversal. |
| Preserve required-select ownership | Exact retained options/selection and private bounded signatures stop probes/cleanup from overwriting authored choices or reordered/replaced option lists. DOM restoration is explicit; application reset/AT/OS behavior remains unknown. |
| Sample horizontal textarea editing | Empty explicit wrap=off LTR fields share retained safety/cleanup with vertical samples; native hidden-scrollbar behavior and scripted equivalents are accepted. RTL/bidi, input/select and glyph/ancestor visibility remain unknown. |
| Validate explicit header graphs | Bounded same-table unique-target cycle recognition and duplicate ASCII token syntax, preserving hidden referenced intermediates and unknown edges. Passive Full/Pages evidence; no AT or automatic span association claim. |
| Implement bounded textarea editing | Empty-only, retained 12-line/14-arrow sample accepts fixed scrolling, growth and scripted equivalents; authored cancellation alone can warn. The guide advances to Partial with sizing/clipping/device gaps. |
| Implement table keyboard scroll now | Observable user behavior, no purchase/form action, and existing frozen Full probe infrastructure. `coverage.tableScroll` reuses widgets evidence. Retain one table/region, skip unsafe/ambiguous scopes, restore scroll/focus and suppress dependency-contaminated findings. Native uncalibrated keyboard policy is unknown; only observed key cancellation without movement warns. |
| Inspect selected reporting URL now | Existing owned negative fixtures established that a matched endpoint name can point to a rejected URL. Add token-free URL parse/scheme evidence and `policy-csp-reporting-url`; no endpoint fetch, TLS/CORS/delivery claim or raw URL export. |
| Apply seven verified legacy JS findings | Dense validated arrays can use copying methods; clearing an ordinary container needs no HTML parser; Error options preserve a non-enumerable cause. Node 22+ and Baseline Widely browser policy support these APIs. All seven findings were reviewed; the rescan has zero findings across its limited 38 guides/52 rules. |
| Preserve source rationale in code | Module/rule comments link precise guides/spec sections and explain first-directive precedence, no form-action fallback, redaction, retained-node checks, native event limitations, local TLS/debug flags, CORS credentials and explicit offline baseline approval. Repository approval policy is identified as such, not attributed to CSP/SRI. |

## Work to do next

| Priority / boundary | Next useful contract |
| --- | --- |
| Safe automatic work | Native text fields, selects and binary checkboxes now have retained ownership/cleanup regressions; extend ownership to remaining widgets/business contracts, automatic table header relationships and broader table-model/gap coverage beyond explicit graph/span checks, ancestor field clipping, RTL/bidi horizontal editing and input/select sizing beyond the two bounded textarea samples. Extend shared modules and add positive/negative/browser fixtures before changing guide status. |
| Needs an explicit feature/sandbox contract | Successful/async form submission, sign-in/autofill/password managers, custom form reset/restore, theme-toggle persistence, drag/reorder commands, progress completion, SPA/back restoration and meaningful canvas alternatives. Do not guess selectors or mutate live commerce. |
| Needs real device / assistive technology | Native IME composition, OS text scale/keyboards, real touch/gesture behavior, screen-reader speech, closed-shadow/private ElementInternals and exhaustive global focus order. Synthetic dispatch/emulation cannot certify these. |
| Needs authorized private access | Merchant reporting receiver ingestion/alerting, tag-manager/app publishing rights, WooCommerce filesystem/plugin integrity and sandbox canary data flow. Public browser monitoring cannot establish these. |
| Keep observational | Field INP, exact network priority, CSP enforcement completeness, malware absence and reporting best-effort delivery. No modern API adoption requirement or automatic baseline promotion. |

## Test inventory: what each layer establishes

| Area | Files / command | Evidence and limit |
| --- | --- | --- |
| Static rule/catalog integrity | `pnpm check` | TypeScript, ESLint, Node unit tests, pinned toolchain and exact local 209-ID metadata. Not browser behavior. |
| Passive Modern Web | `checks/modern-web*.spec.ts`, `pnpm test:modern-web:local` | Positive/negative owned DOM/resource/policy fixtures; desktop/mobile Chromium by default, installed Firefox/WebKit projects available. Advisory heuristics retain explicit unknowns. |
| New table scroll | `checks/modern-web-table-scroll.spec.ts` | Native LTR/RTL, authored equivalent, cancelled keys, hidden/inert/nonoverflow/grid/editable/modal exclusions, requests, rerenders/focus theft, restoration and candidate limit. Five-project run; no commands or submissions. |
| Policy URL/source parsing | `checks/modern-web-policy.spec.ts` | CSP fallback/duplicate/empty precedence, meta/report-only separation, dictionary limits/escapes, endpoint matching and URL parse/scheme checks with redaction/no fetch. Not full Structured Fields/CSP matching or delivery certification. |
| Full actual production entry | `pnpm test:modern-web:entry:local` | Actual `43-modern-web.spec.ts` on Shopify/WooCommerce desktop/mobile; seven attachment families, table-scroll evidence, one document visit, quarantine/no probe traffic. Prevents unit-only coverage claims. |
| Pages shared audit | `pnpm test:pages:local` | Shared metadata/media/axe/spelling/policy evidence, optional headers and real redirect final-response attribution without refetch. Configured/discovered callers reuse their goto response. |
| Script/payment/CSP monitor | `pnpm test:security:local`, `checks/security-monitoring.spec.ts` | Actual bytes/redirects/destinations/consent isolation/payment contracts/native CSP events, incomplete limits/worker gaps and teardown. Available five-engine/project fixtures. No adversarial malware proof. |
| Security actual production entry | `pnpm test:security:entry:local` | Candidate/approved/drift/CSP/worker scenarios, exact intentional strict failures and unchanged baseline/history across both platforms and desktop/mobile. |
| Modern reporting upload | `pnpm test:security:reporting:local` | Full Chromium/new headless, temporary pinned HTTPS, actual local receipt and failing receiver, document-scoped positive/negative controls and CORS/cookie contracts. Normal shell/other engines/production ingestion remain unknown. |
| Baseline review/history/privacy | `scripts/security-model.test.js`, privacy/backup Node tests under `pnpm check` | Review hashes, variants, approval reasons, history links, path confinement, locking and artifact filtering. Local tamper evidence is not an authenticated signature or known-good provenance. |
| Control/report regressions | `pnpm test:control:local`, `pnpm test:reporting` | Actual local panel/report behavior, desktop/mobile/axe and retained business statuses after internal JS modernization. |
| Whole configured local chain | `pnpm test:acceptance:local` | Runs the maintained acceptance commands above plus commerce, platform, journey, operations and monitoring checks against owned fixtures. Never contacts merchants or downloads guidance. Broader five-project fixture calibration is separate. |

## Source ledger and comment convention

Use a nearby `Source:` comment with the exact URL, followed by **what is observed, why this implementation choice is necessary, and what is not established**. Prefer normative sections for parsing/behavior and upstream guides for design recommendations; never assert that a guide requires an operational policy we invented.

- [Responsive table markup/keyboard region](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md): `tests/modern-web-table-scroll.ts`.
- [Keyboard/focus accessibility](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md): retained focus cleanup, no injected tabindex or command activation.
- [CSP3 fallback list](https://www.w3.org/TR/CSP3/#directive-fallback-list): `tests/modern-web-policy.ts` and its fixtures.
- [Reporting endpoint processing](https://www.w3.org/TR/reporting-1/#process-header): bounded dictionary/URL recognition; syntax does not prove TLS or delivery.
- [Reporting delivery and credentials](https://www.w3.org/TR/reporting-1/#try-delivery): native upload/CORS/cookie fixtures; same-origin credentials differ from cross-origin.
- [CSP violation reporting](https://www.w3.org/TR/CSP3/#report-violation): `tests/security-csp.ts`; native DOM events remain page-context telemetry, not server acknowledgement.
- [Chrome Reporting API debug delay](https://developer.chrome.com/docs/capabilities/web-apis/reporting-api) and [full Chromium/new headless](https://playwright.dev/docs/browsers#chromium-new-headless-mode): isolated owned fixture browser, no production flag changes.
- [JS immutable copies, Error cause and DOM replacement](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/js/js.md): dense validated collections and parser-free ordinary-container clearing; public error filtering remains intact.
- [Repository baseline approval policy](SECURITY-MONITORING.md#evidence-and-approval): explicit offline review/provenance, never auto-approval by a run.

Validation completed: full local acceptance and `pnpm check` (128 unit tests) passed; targeted five-project runs passed 90 table cases, 100 policy cases, the 25 final response-vs-base assertions and 10 combined serialization/redaction cases. Exact current catalog equality passed (209 IDs); verified legacy rescan is clean within its limited 38-guide scope. CSS build and desktop/mobile screenshots were checked. [Detailed record](TESTS.md#prioritized-review-table-scrolling-and-reporting-urls--2026-11-19). No live store, merchant baseline or administrator access was used.

Follow-up: [required-field ownership/cleanup](MODERN-WEB.md#required-field-ownership-and-cleanup--2026-11-19) now stops on authored value/identity/editability changes and records cleanup outcomes. That prerequisite batch left long-content reachability Pending; the subsequent bounded textarea sample below advances the topic to Partial. Fixed-size scrolling is an accepted fallback.

Follow-up: [long textarea content](MODERN-WEB.md#long-textarea-content--2026-11-19) adds a guarded vertical editing sample, native/growing fallbacks, authored-cancellation advisory and explicit cleanup. The guide is now Partial; horizontal/input/select/ancestor-clip/device obligations remain open.

Textarea batch validation: 185 final five-project browser cases, six repeated Firefox padding cases, all 24 actual Full entry scenarios and final `pnpm check` (128 unit tests) passed. CSS rebuilt; desktop/mobile screenshots checked. Full local acceptance was not repeated.

Follow-up: [explicit header graphs](MODERN-WEB.md#explicit-table-header-graph--2026-11-19) now detect confirmed direct/transitive self-targeting and duplicate tokens with bounded unknowns, structural finding selectors and passive Full/Pages integration. `responsive-table` stays Partial.

Header-graph batch validation: 155 final five-project browser cases (85 new), 12 three-engine Pages cases, 24 actual Full entry scenarios and `pnpm check` (128 unit tests) passed. CSS/screenshots/metadata/diff checks passed; full acceptance was not repeated.

Follow-up: [horizontal textarea content](MODERN-WEB.md#horizontal-non-wrapping-textarea-content--2026-11-19) adds a guarded explicit wrap=off LTR sample using the same retained-node routine. The guide remains Partial; unsupported direction/wrapping, application reset and glyph/ancestor visibility remain unknown.

Horizontal textarea batch validation: 290 final five-project browser cases (105 new), all 24 actual Full entry scenarios and `pnpm check` (128 unit tests) passed. CSS rebuilt; desktop/mobile screenshots and final metadata/diff checks passed. Full acceptance was not repeated.

Follow-up 2026-11-20: [required-select ownership/cleanup](MODERN-WEB.md#required-select-ownership-and-cleanup--2026-11-20) now preserves authored choices and option mutations with explicit DOM restoration status. No guide promotion or successful-submission/application-reset claim.

Select-ownership batch validation: 265 five-project browser cases (125 new), all 24 actual Full entry scenarios and final `pnpm check` (128 unit tests) passed. CSS rebuilt; desktop/mobile screenshots and metadata/diff checks passed. Full acceptance was not repeated.

Follow-up 2026-11-20: [checkbox ownership/conditional reversal](MODERN-WEB.md#checkbox-ownership-and-conditional-reversal--2026-11-20) adds exact-node/state/focus safety, mixed exclusions and explicit keyboard/native/custom cleanup limits. The guide remains Partial.

Checkbox batch validation: 280 five-project browser cases (110 new), five final ancestor/candidate repetitions, 24 actual Full entry scenarios and `pnpm check` (128 unit tests) passed. CSS/screenshots/metadata/diff checks passed; full acceptance was not repeated.

Follow-up 2026-11-20: [bounded span occupancy](MODERN-WEB.md#bounded-table-span-occupancy--2026-11-20) now checks fully rendered declared native row groups for confirmed slot overlap, with null unknowns, buffered findings and work bounds. `responsive-table` stays Partial.

Span-occupancy batch validation: 280 five-project browser cases (125 new), 12 three-engine Pages cases, 24 actual Full entry scenarios and final `pnpm check` (128 unit tests) passed. CSS/screenshots/metadata/diff checks passed; full acceptance was not repeated.
