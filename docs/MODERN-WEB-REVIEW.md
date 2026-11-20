# Modern Web implementation and test review — 2026-11-20

[Coverage matrix](MODERN-WEB.md#complete-catalog-mapping) · [Validation record](TESTS.md)

209 guide topics remain **1 Covered / 62 Partial / 48 Pending / 98 outside scope**. These are topics, not test counts. The existing suite already covers forms, disclosures, tabs, sliders, composite/menu/tooltip/carousel keyboard samples, responsive/text/preference stress, table/progress semantics, resource hints, policies and opt-in script/destination/payment monitoring. Do not add a second generic inspector or count axe/fixtures alone as completion.

## Current scope and remaining counts

The current Modern Web fixture inventory is **567 test definitions in 34 files**, configured in five browser profiles (**2835 executions** when the whole matrix is run). These are configured counts, not a claim that the entire matrix passed in the latest focused batch. The maintained `pnpm test:modern-web:local` acceptance calibration selects the two Chromium profiles; `pnpm test:modern-web:browsers:local` selects all five.

Latest completed verification (2026-11-20): 480 targeted five-profile table cases, 705 distinct configured field cases (675 regressions, 15 mutation-budget cases and final sizing coverage), 12 three-engine Pages cases and 24 actual Shopify/WooCommerce Full scenarios passed. The new batch adds 64 definitions / 320 configured five-profile executions. Earlier high-load timeouts remain in the historical record. The whole acceptance chain last passed before the recent table/field batches; focused verification does not represent a fresh entire-matrix run.

Of 209 guide topics, **111 are in scope**: 1 Covered, 62 Partial and 48 Pending; 98 are outside project scope. Therefore **110 topics have remaining obligations** (62 to extend and 48 pending), not 110 known missing test cases. Every Partial topic can already have substantial code and positive/negative regression coverage. Required manual/sandbox/private-access obligations prevent promoting those topics from tests alone.

Completed executable areas include retained form/select/checkbox ownership and cleanup, bounded vertical/horizontal text editing, table scrolling/explicit header graphs/spans/gaps/anchors/columns/implied rows/group scopes/directional scans, presentation/preference stress, policy diagnostics, and opt-in script/destination/payment/CSP monitoring with offline baseline review and owned reporting calibration. The decision table and append-only validation records below distinguish implementation from complete coverage.

Security remaining work has no fixed test-case count in the current plan. Open tracks include broader effective-policy/worker-internal observability, reporting ingestion/alerting, authorized publishing/admin/token/file-integrity audits, and real-device/regional/scenario calibration. See [the security plan](THIRD-PARTY-SECURITY-PLAN.md#follow-up-controls-and-limits); browser evidence does not certify a malware-clean installation or backend integrity.

## Chosen work and why

| Decision | Result / reason |
| --- | --- |
| Check bounded table-span occupancy | A bounded native model now covers slot intersections, gaps/anchors, leading colgroup/col declarations and implied row-group tails, including rowspan zero. Hidden/alternate/oversized models remain unknown; complete associations, CSS appearance and AT behavior stay unverified. |
| Check scoped and scanned headers | Explicit headers graphs, group candidates and native west/north/Auto scans have separate bounded evidence. Scope colgroup requires a real anchor group; opaque blocks/emptiness/precedence prevent nearest-header guesses. The final bounded union now applies explicit precedence and empty/self/dedup cleanup; broader models and AT remain open. |
| Check whole-control ancestor clipping | Bounded full and partial border-box clipping are advisory; glyph/complex clips remain open. Five browser profiles include actual trusted touch-pointer delivery with explicit emulation limits. |
| Preserve checkbox ownership | Binary Space reversal retains exact nodes/context and never refocuses after theft. Mixed states are excluded; native conditional DOM cleanup is distinguished from keyboard success; custom ARIA state is preserved on incomplete reversal. |
| Preserve required-select ownership | Exact retained options/selection and private bounded signatures stop probes/cleanup from overwriting authored choices or reordered/replaced option lists. DOM restoration is explicit; application reset/AT/OS behavior remains unknown. |
| Sample horizontal textarea editing | Empty explicit wrap=off LTR fields share retained safety/cleanup with vertical samples; native hidden-scrollbar behavior and scripted equivalents are accepted. RTL/mixed-bidi and text-input logical-end probes plus input/select geometry now have bounded evidence; visual/grapheme/IME, picker and glyph/complex visibility remain unknown. |
| Validate explicit header graphs | Bounded same-table unique-target cycle recognition and duplicate ASCII token syntax, preserving hidden referenced intermediates and unknown edges. Passive Full/Pages evidence; no AT or automatic span association claim. |
| Implement bounded textarea editing | Empty-only, retained 12-line/14-arrow sample accepts fixed scrolling, growth and scripted equivalents; authored cancellation alone can warn. The guide advances to Partial with sizing/clipping/device gaps. |
| Implement table keyboard scroll now | Observable user behavior, no purchase/form action, and existing frozen Full probe infrastructure. `coverage.tableScroll` reuses widgets evidence. Retain one table/region, skip unsafe/ambiguous scopes, restore scroll/focus and suppress dependency-contaminated findings. Native uncalibrated keyboard policy is unknown; only observed key cancellation without movement warns. |
| Inspect selected reporting URL now | Existing owned negative fixtures established that a matched endpoint name can point to a rejected URL. Add token-free URL parse/scheme evidence and `policy-csp-reporting-url`; no endpoint fetch, TLS/CORS/delivery claim or raw URL export. |
| Apply seven verified legacy JS findings | Dense validated arrays can use copying methods; clearing an ordinary container needs no HTML parser; Error options preserve a non-enumerable cause. Node 22+ and Baseline Widely browser policy support these APIs. All seven findings were reviewed; the rescan has zero findings across its limited 38 guides/52 rules. |
| Preserve source rationale in code | Module/rule comments link precise guides/spec sections and explain first-directive precedence, no form-action fallback, redaction, retained-node checks, native event limitations, local TLS/debug flags, CORS credentials and explicit offline baseline approval. Repository approval policy is identified as such, not attributed to CSP/SRI. |

## Work to do next

| Priority / boundary | Next useful contract |
| --- | --- |
| Safe automatic work | Extend retained ownership to remaining widgets/business contracts; cover anonymous/hidden/alternate table models beyond the bounded final header union; investigate complex/glyph clipping and field resizing beyond simple border-box geometry, and bidi visual/grapheme behavior beyond logical-end samples. Native select text/picker, IME, real devices and AT need separate calibration. Extend shared modules with positive/negative/browser fixtures before changing guide status. |
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


Follow-up 2026-11-20: [whole-control ancestor clipping and emulation](MODERN-WEB.md#whole-control-ancestor-clipping-and-emulation--2026-11-20) adds bounded advisory clipping geometry, device/input-method regressions and an explicit five-project local command. The form-factor guide stays Partial; OS/AT and complex clipping obligations remain open.

Validation of the final clipping/emulation batch: 130 five-project browser cases passed (85 new and 45 existing probe/combined regressions), including trusted touch delivery in both mobile profiles and the recorded WebKit maxTouchPoints limitation. `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata); CSS rebuilt and desktop/mobile screenshots inspected.


Device execution options (current local audit, 2026-11-20):

| Environment | What it adds | Current local state / limits |
| --- | --- | --- |
| Playwright descriptors | Browser viewport/device scale, mobile/touch and media preferences; actual browser keyboard/tap delivery | Configured in all five Modern Web projects. Mobile WebKit's zero maxTouchPoints is recorded separately from successful trusted touch-pointer delivery. |
| [Android Emulator / AVD](https://developer.android.com/studio/run/emulator) | Android OS/browser environment for platform-specific cases | `adb` is available; the `emulator` executable was not found in PATH. No AVD was started or certified by this batch. |
| [Xcode Simulator](https://developer.apple.com/xcode) | Simulated iOS/Safari environment and OS-specific integration | `xcrun simctl` is unavailable in the selected developer toolchain. No simulator was started or certified by this batch. |
| Real device / assistive technology | Physical input, actual platform accessibility speech, browser chrome and hardware constraints | Separate authorized fixture execution is still required; [Apple notes simulator/hardware differences](https://developer.apple.com/documentation/xcode/testing-a-beta-os). Emulation does not establish real-device performance or field INP. |

The refreshed acceptance run passed 732 desktop/mobile Modern Web fixture cases and all 24 actual Full entry scenarios across Shopify/WooCommerce. Full entry requires `presentation-control-ancestor-clip` in the serialized presentation evidence while retaining seven evidence families, a single visit and no probe requests reaching the fixture server. The final 130-case five-project run additionally covers the last emulation/bounds fixtures added after the broad Modern Web run started.

Full `pnpm test:acceptance:local` completed successfully after the accumulated field/select/checkbox/table batches: reporting/control/pages/vitals/visual/commerce/platform/SEO/journey/claims/accessibility, 732 Modern Web desktop/mobile cases, 24 Full Modern Web entry scenarios, 68 security collector cases, the security entry harness with expected negative cases, 24 real HTTPS reporting-upload cases, monitoring and operations/tracking. All traffic used owned local fixtures. Expected failing/flaky negative fixtures were validated by their harnesses; the outer acceptance command exited zero.


Follow-up 2026-11-20: [bounded table-grid coverage/anchors](MODERN-WEB.md#bounded-table-grid-coverage-and-anchors--2026-11-20) adds separate passive advisories for uncovered slots and rows/columns with no anchored cell, preserving null unknowns and the existing shared span-model bounds. Empty cells count as coverage; a prior rowspan covering a row is not a new anchor. The guide stays Partial.

Table-grid validation: 385 five-project browser cases passed (105 new); 12 Pages cases across Chromium/Firefox/WebKit passed with observed/unknown grid serialization and a single document visit. CSS rebuilt and desktop/mobile valid-grid screenshots inspected.

Final table-grid validation: all 24 actual Full entry scenarios passed across Shopify/WooCommerce desktop/mobile with both grid advisories and the expected numeric counters, all seven evidence families, one document visit and no probe requests reaching the server. Final `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata). The complete local acceptance chain passed earlier in this task before this final grid addition; it was not repeated after the grid addition. The final addition was validated by the 385-case five-project suite, 12 three-engine Pages cases and the 24 actual Full scenarios. No live stores or active user servers were used.


Follow-up 2026-11-20: [declared table columns](MODERN-WEB.md#declared-table-columns--2026-11-20) expands the passive grid model to normal leading colgroup/col declarations, child-vs-parent span precedence and bounded initial widths. Existing advisory IDs are retained; hidden/collapsed/late/malformed structures stay unknown and guide status remains Partial.

Declared-column validation: all 530 five-project browser cases passed (145 new column cases plus 385 grid/span/header/data-widget/combined regressions); the final collapsed-column assertions were also repeated successfully in all five projects (10 cases). All 12 three-engine Pages serialization cases passed, including observed leading-column grids with a single document visit. Final `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata). CSS rebuilt; desktop/mobile declared-column screenshots inspected.

Declared-column Full validation: all 24 production-entry scenarios passed across Shopify/WooCommerce desktop/mobile, requiring three declared columns, three uncovered slots and two missing column anchors in serialized evidence. All seven evidence families, one visit and zero probe traffic reaching the fixture server were retained. The complete local acceptance chain was not repeated for this focused batch; final coverage is the 530-case five-project regression, 12 three-engine Pages cases, 24 actual Full scenarios and `pnpm check` (128 unit tests). No live stores or active user servers were used.


Follow-up 2026-11-20: [implied table rows/zero spans](MODERN-WEB.md#implied-table-rows-and-zero-spans--2026-11-20) replaces the blanket implied-row exclusion with bounded row-group closure. Real DOM rows and all logical rows are recorded separately; the 100-row cap includes implied rows across groups, and zero spans consume the expanded assignment budget. Existing advisory IDs/status totals remain unchanged.

Implied-row validation: all 650 five-project browser cases passed (120 new implied-row cases plus 530 existing column/grid/span/header/data-widget/combined regressions). All 12 Pages cases passed across Chromium/Firefox/WebKit, with serialized logical-row evidence and one document visit. `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata). CSS rebuilt and desktop/mobile bounded-row fixture screenshots inspected.

Implied-row Full validation: all 24 actual entry scenarios passed across Shopify/WooCommerce desktop/mobile, requiring two DOM rows, three modeled rows, one implied row and the expected five-gap/one-row/two-column anchor counters. All seven evidence families, one document visit and no probe requests reaching the fixture server were retained. The full local acceptance chain was not repeated for this focused batch; the final checks were 650 five-project browser cases, 12 three-engine Pages cases, 24 Full scenarios and `pnpm check` (128 unit tests). No live stores, merchant baselines or active user servers were used.


Follow-up 2026-11-20: [group-scoped table headers](MODERN-WEB.md#group-scoped-table-headers--2026-11-20) adds bounded group-candidate counters and a confirmed colgroup-anchor advisory, explicit-headers precedence and logical footer ordering. This is a subset of header assignment; full automatic relationships and speech remain unverified.

Group-scope validation: all 800 five-project browser cases passed (150 new group-scope cases and 650 column/grid/implied/span/header/data-widget/combined regressions). All 12 Pages serialization cases passed across Chromium/Firefox/WebKit, including explicit-headers precedence and the rowgroup candidate subset, with one document visit. Final `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata). CSS rebuilt and desktop/mobile valid-group screenshots inspected.

Group-scope Full validation: all 24 actual entry scenarios passed across Shopify/WooCommerce desktop/mobile, requiring the new missing-colgroup anchor advisory, one valid group candidate pair, separate unanchored-header counters and the false complete-association flag. All seven evidence families, one document visit and no probe requests reaching the fixture server were retained. The complete local acceptance chain was not repeated for this focused batch; final verification was 800 five-project browser cases, 12 three-engine Pages cases, 24 Full scenarios and `pnpm check` (128 unit tests). No live stores, merchant baselines or active user servers were used.


Follow-up 2026-11-20: [native table-header scanning](MODERN-WEB.md#native-table-header-scanning--2026-11-20) adds bounded west/north scans, opaque blocks, Auto orientation, empty/self removal and deduplicated directional counts. Explicit/group results remain separate; complete associations and speech are not certified.

Header-scan validation: the final sequential run passed all 360 targeted five-project browser cases (140 new scan cases plus 220 existing group-scope/data-widget/combined regressions) and all 12 three-engine Pages cases. `pnpm check` passed (128 unit tests, types/lint/toolchain and 209-guide metadata). CSS rebuilt and desktop/mobile header-scan screenshots inspected. The complete configured Modern Web inventory was separately listed: 503 definitions in 31 files, 503 executions per profile and 2515 across all five; this is inventory, not a latest whole-matrix run.

An earlier concurrent attempt coincided with system load around 28 on 12 logical CPUs and had timeouts in existing page setup/axe/viewport/menubar work (359/360 targeted cases passed; 8/12 Pages cases passed; Full did not complete). The new scan cases passed in that attempt. After load subsided, fresh sequential runs passed the targeted and Pages suites with unchanged timeouts and retries disabled. Record the initial timeouts rather than treating them as passing results or raising limits.

Header-scan Full validation: the final isolated run passed all 24 actual entry scenarios across Shopify/WooCommerce desktop/mobile with the expected one west pair, two north pairs, three directional pairs and one data cell with scanned headers. All seven evidence families, one visit and no probe traffic reaching the fixture server were retained. Full did not repeat its earlier timeouts with unchanged limits and retries disabled. Final batch checks: 360 targeted five-project cases (140 new), 12 three-engine Pages cases, 24 Full scenarios and `pnpm check` (128 unit tests). The complete local acceptance chain and entire 2515-case configured matrix were not repeated for this batch. No live stores, merchant baselines or active user servers were used.

## Header unions and bounded field follow-ups — 2026-11-20

Sources: [responsive-table](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md), [HTML assigning-header-cells](https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells), [form-fields-automatically-fit-contents](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md), [forms](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md), [form-factor-adaptation](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md), and [CSSOM scrolling areas](https://drafts.csswg.org/cssom-view/#scrolling-area). Source comments explain the normative algorithm, local bounds and behavioral rationale. No particular modern CSS API is required of stores.

`spanOccupancy.headerAssignments` now merges retained group-scope and west/north/Auto assignments. A present `headers` attribute overrides automatic assignments, including an empty/invalid list. Its direct ASCII-whitespace tokens resolve through the first document ID match; only same-table cell targets survive. HTML processing can retain a TD target while the separate authoring checker warns about it. References are not expanded transitively. Empty/self/duplicate targets are removed, with private cached emptiness checks. Limits are 64 tokens, 8192 attribute/text code units and the existing bounded occupancy/scan models; uncertain models produce null unknown evidence. Exported results contain only numeric positions/counts, not IDs or text. `structuralAssignmentSubsetVerified:true` describes this supported subset; accessibility-tree, speech and overall complete-association flags remain false. No new table finding or severity.

Guarded `rtlFieldContent`, `bidiFieldContent` and `inputFieldContent` probes each mutate at most one eligible empty native field among the retained first five candidates. RTL nowrap textarea samples use negative horizontal scroll coordinates and trailing left padding; mixed LTR bidi samples contain Hebrew, Arabic, emoji and combining text. Input samples allow native text/search/tel/url fields. They test logical-end keyboard reachability and scrolling, not visual/grapheme order or IME. Exact node, parent, form, name, type, default value, maxlength and autocomplete ownership is retained before compare-clear cleanup. Authored value/reset/focus changes are preserved. The dependency guard blocks writes; no form is submitted. `field-content-rtl-navigation`, `field-content-bidi-navigation` and `field-content-input-navigation` are advisory only when authored trusted-arrow cancellation prevents reaching the end; unexplained native nonresponse is unknown. Application reset, grapheme/visual order and IME flags remain false.

Passive `fieldSizing` records bounded geometry and pixel min/max limits for text-like native inputs, textarea and select. `field-sizing-zero-box` and `field-sizing-page-overflow` are advisory observations for eligible exposed controls; local horizontal scrollers and hidden proxy checkboxes are excluded. Fixed-size fallback/internal scrolling is accepted; `field-sizing:content` support is recorded as optional enhancement. Native select label/glyph fit and OS picker behavior remain unverified, and values/options are not changed.

Ancestor clipping now intersects visible border boxes through up to 32 simple clipping ancestors for at most 100 controls. Existing whole-control warnings remain; `presentation-control-partial-ancestor-clip` adds advisory partial border-box evidence. Hidden/inert scopes, content-visibility auto/hidden, transforms, zoom, perspective, clip paths, nonzero overflow clip margins and absolute/fixed paths remain excluded/unknown. This does not verify individual glyphs, raster appearance or arbitrary complex clipping; the glyph/completeness flags remain false.

Remaining-work index: the four requested areas now have bounded executable support. Broader anonymous/hidden/alternate table models, accessibility-tree/speech checks, bidi visual/grapheme/IME behavior, arbitrary field sizing/resizing and complex/glyph clipping remain open, as do native picker and real-device obligations. Guide totals stay **1 Covered / 62 Partial / 48 Pending / 98 outside scope**; 110 applicable topics retain obligations, not 110 missing test cases.

Validation: 480 targeted five-profile table cases passed, including 120 new union cases. Field verification passed 675 five-profile regression cases, 15 separate mutation-budget cases and the final 50-case sizing suite; accounting for repeated sizing cases, this covers 705 distinct configured field scenarios. New fixtures add 64 definitions / 320 five-profile executions. All 12 three-engine Pages cases and 24 actual Shopify/WooCommerce Full scenarios passed with one visit, seven evidence families and no probe traffic reaching the server. CSS rebuilt; desktop/mobile table, field and clipping screenshots inspected. Final checks and inventory are recorded below. The entire acceptance chain and whole configured matrix were not rerun for this batch. No live stores, merchant baselines or active user servers were used.

Final batch checks: `pnpm check` passed with 128 unit tests, TypeScript, lint, toolchain and exact 209-guide metadata validation. `playwright --list` confirms 567 definitions in 34 files / 2835 configured five-profile executions. These inventory counts do not imply a full-matrix run.
