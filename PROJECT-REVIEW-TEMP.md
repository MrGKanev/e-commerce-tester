# Temporary analysis and proposals for e-commerce-tester

Date: October 9, 2026
Last updated: October 10, 2026

A working document for discussion and planning. The status of implemented proposals is noted in the relevant section; the rest is a plan. Comparisons with external products are based on public documentation, not on hands-on testing of those services.

## Main recommendation

Develop the project into a tool for continuous monitoring of Shopify stores: reliable buyer-journey checks, clear problems, evidence and notifications.

Functional coverage is already broad. The biggest gain now will come from more trustworthy results, easy setup and timely notification when something breaks.

The potential advantage is managing several stores in a dedicated panel, Shopify-specific checks and checks of Bulgarian-language content.

## What was reviewed and verified

Reviewed: the structure, the main tests and helper modules, the configuration, multi-store execution, the scheduler, the reports, the browser control panel, the documentation and the Docker setup.

Run successfully:

- `pnpm check`: TypeScript, ESLint, 42 unit tests and Docker/Playwright version consistency.
- `pnpm test:readiness`: 14 local browser tests.
- `pnpm test:reporting`: local acceptance checks of metadata, coverage, skipped and flaky scenarios. A failed first attempt is deliberately simulated here.
- `pnpm test:control:local`: setup, saving, reloading, schedules, pause, preservation of advanced settings, mobile layout and axe checks.

No tests were run against real stores. The results confirm the tool's local checks, but do not prove it works with every Shopify theme.

## What is already good

- Broad coverage: products, variants, cart, checkout, search, mobile, accessibility, SEO, content and performance.
- A scheduler with persistent state, cooldown on 429, `Retry-After`, a watchdog, locking against concurrent schedulers and time windows.
- Reports distinguish pass rate from coverage, and failure, skip, interruption and incomplete runs from one another.
- Local fixtures to verify the tool itself.
- Off-the-shelf components: Playwright, axe, Lighthouse, dictionaries and Tesseract.
- Metadata and evidence are kept, which helps diagnosis.

These parts should remain the foundation of further development.

## What to take from good similar solutions

| Solution | What it does well | How to apply it here |
| --- | --- | --- |
| [Checkly](https://www.checklyhq.com/product/playwright-check-suites/) | Playwright monitoring, multiple regions and diagnostics | A small set of critical user scenarios, operational notifications and clear evidence on failure |
| [Checkly alerting](https://www.checklyhq.com/product/alerting/) | Failure confirmation, escalation and recovery notifications | Problem state, grouping of repeats, notification thresholds and a separate confirming check |
| [StoreWatch QA](https://apps.shopify.com/storewatch-qa) | A focused Shopify buyer journey and easy setup | Setup from a URL and a product; a headline result "The path to checkout works" |
| [Argos](https://argos-ci.com/docs/playwright) | Visual checks with Playwright | Review of baseline, current screenshot and diff; approval of intentional changes |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | Lightweight availability checks, notifications and self-hosting | A separate uptime layer and monitoring of whether the tester itself is running |

### Principles worth borrowing

1. **Show first whether the buyer journey works.** The detailed technical report stays reachable from that result.
2. **Every problem has evidence.** The step, expected and actual behavior, URL, screenshot and trace, when available.
3. **Notify on state change.** New problem, confirmed problem, recovery; repeats are grouped.
4. **Compare comparable checks.** The same mode, browser and scope, or the last known result for that specific check.
5. **Setup verifies its own assumptions.** The chosen product, variants and selectors are validated before a schedule is activated.
6. **Light checks are frequent, heavy ones are rare.** Uptime, the buyer journey, the full audit and visual checks have different schedules.

We borrow the approaches and use public integrations. There is no need to recreate the whole infrastructure of the external products.

## Priority improvements

### 1. Checks that prove their claim

**Status: implemented and verified locally for Shopify/WooCommerce.** `17-checkout` now separates reaching a real checkout route with readable content/HTTP status from the checks of the contact and shipping interface. A query parameter containing the word checkout does not prove arrival. A missing, hidden, disabled or ambiguous required field does not pass.

The shared `storefront-assertions` check exactly one recognized/configured checkout root and visible editable fields. The `checkout` settings define a supported/auto/unsupported/blocked interface, a required/not-applicable/unverified contact/shipping policy, a reason and concrete requiredAddressFields. The panel has a separate Checkout expectations section. An unrecognized or blocked interface stays unverified; explicitly not-applicable fields are marked as such. Settings are validated by Ajv.

`05-cart` and the WooCommerce empty-cart scenario require a genuinely empty public cart in the same session, zero visible product rows and an explicit visible empty-state indicator. A cart form on its own, hidden empty text or a non-empty API cart cannot produce a pass. Shopify clear/read use the observed localized route root; WooCommerce uses its own cookie/token session.

JSON evidence: `checkout-interface.json`, `empty-cart.json`. The shared contact policy is also used by the Woo checkout and the buyer journey. Details: [Checkout expectations](docs/CONFIGURATION.md#checkout-expectations).

**Validation:** 40 local claims checks (20 per platform), regressions with 26 journey scenarios and 22 Woo commerce scenarios, panel save/reload/mobile/axe and the shared unit/type/lint checks. No personal data is filled in; production stores and orders were not used.

**Definition of done:** a missing expected field or wrong cart content cannot yield a passing result for the relevant check.

### 2. One end-to-end buyer scenario

**Status: implemented for Shopify and WooCommerce, verified locally.** `36-buyer-journey` runs:

`search → product → variant → add → quantity → checkout`

It automatically plans an available product from up to six inventory candidates, preferring a product with variants. The steps run through the UI in a separate, empty visitor session. Shopify confirms the cart through the localized public Cart API; WooCommerce uses a separate Store API adapter with the same cookies/token/nonce, currency minor units and tax policy. Identity, active price, quantity 1 → 2 and UI/API line totals are checked.

Checkout is counted as verified only with a readable summary showing the right product/options, quantity and line amount. Place order/Pay is never pressed. Known order/payment and Woo checkout mutation requests are blocked; checkout implementations that depend on them stay unverified. After adding, cleanup is performed, except under a shared rate-limit stop.

The panel has a separate "Buyer journey" section. `buyer-journeys.json` stores the expected and observed values, the status and the first problem step. The detailed commerce tests remain for diagnosis. Unsupported pickers, ambiguous controls, single-quantity limits or an inaccessible checkout summary do not yield an automatic pass.

Commands: `pnpm test:journey --site=<slug>` and `pnpm test:journey:local`; included in `@full` and CI acceptance. Scope/limitations: [docs/COMMERCE.md](docs/COMMERCE.md).

**Validation:** 26 local journey scenarios (13 per platform), 69 unit tests, TypeScript/lint, and the regression 26 Shopify and 22 WooCommerce commerce checks. Covered: a simple/variant product, a sold-out product, wrong price/quantity/variant, missing search, unverifiable checkout, a blocked automatic order request and cleanup. Real stores and orders were not used.

**Definition of done:** on a problem, the report names the exact step and the mismatch between the expected and the actual state.

### 3. Notifications and problem state

We add:

- A new critical problem.
- A recurring problem, without a notification on every run.
- Recovery after a successful check of the same scenario.
- Maintenance windows to temporarily suppress notifications.
- A link to the report and the evidence.
- A separate record of a failed notification delivery.

The first failure stays in the history. If needed, we plan a separate confirming check that respects pacing, `Retry-After` and cooldown. We do not use retries that hide the initial result.

Ready-made foundation: [Apprise](https://github.com/caronc/apprise), which supports many notification services. One channel and a small adapter over the results are enough to start; Apprise makes sense when more channels are needed.

**Definition of done:** one problem leads to one initial notification, repeats are grouped, and a verified recovery sends a separate notification.

### 4. Comparable comparisons and stable identifiers

In `scripts/update-history.js` every run is compared with the immediately preceding one, which may have a different mode and scope. In `scripts/report-model.js` identity depends on project, file and title.

Proposal:

- A stable `checkId`, independent of the title and of file moves.
- A baseline per mode, browser and scope.
- The last known result for a specific check.
- A distinction between a "newly observed problem" and a "regression after a passing check".
- A skipped or unexecuted check does not prove recovery.

**Definition of done:** the sequence `full → smoke → full` does not create a misleading regression merely because of the different scope.

### 5. Easy store setup and theme profiles

Proposed sequence:

`URL → product discovery → choose a product and an available variant → selector check → first smoke run → activate schedule`

We build on the existing discovery through `/products.json`. It is limited and does not automatically choose a suitable available variant. When discovery is unavailable, we keep manual setup with a clear reason.

We add a general Shopify profile, a Dawn profile and custom overrides. Capabilities become explicit metadata of the checks, instead of being derived from the file and test text in `tests/fixtures.ts`.

We remove the automatic fallback to `zerno.co` and the old product handles when configuration is missing. Examples stay separate from real settings.

**Definition of done:** a user can add a store without editing JSON and gets a concrete explanation if automatic setup is not possible.

### 6. Managing visual baselines

**Status: implemented and verified.** Each store has a persistent, explicitly approved version in `visual-baselines/`, independent of the latest reports. The panel shows baseline/candidate/diff and lets the user approve selected images with confirmation. Versions are kept, comparisons pin the revision at the start, and automatic updating is blocked. Checks for an identical environment, real viewport sizes and per-component thresholds were added. The old company images were deleted at the user's request; no images are automatically approved.

Validation: `pnpm check` passed with 47 unit tests, with no TypeScript or lint errors. The shared local acceptance checks passed, along with the visual cycle on all five browser projects, UI approve/reject/reload, the axe check of the visual panel and Docker Compose validation. The visual test deliberately expects a failure on missing approval, change, a different environment and automatic snapshot updating. No real stores were visited. For each store, the first version is left for the user's explicit review and approval.

Initial finding: `playwright.config.ts` expected baseline images in a per-store subfolder, while the six tracked images in `tests/10-visual.spec.ts-snapshots/` were at the old path without it.

Proposal:

- Clarify and migrate the baseline structure.
- An identical environment for creating and comparing, for example a pinned Docker image.
- Review of baseline, current image and diff.
- Explicit approval of intentional changes.
- Separate thresholds for important components.
- Check viewport and clip settings for all included browser projects.

Playwright describes how the environment affects visual results: [Visual comparisons](https://playwright.dev/docs/test-snapshots).

We start with the built-in Playwright comparisons. [Argos](https://argos-ci.com/docs/playwright) is an option if we want a ready-made visual review process and accept an external service.

### 7. CI for the tool itself

**Status: implemented and re-verified locally on October 10, 2026.** `.github/workflows/ci.yml` triggers on pull requests, pushes to `master` and manual runs. It uses Node from `.nvmrc`, pnpm from `package.json`, a frozen-lockfile install and Chromium with system dependencies. It runs `pnpm check` and `pnpm test:acceptance:local`.

The acceptance command now includes twelve groups: pacing, readiness, reporting, control panel, shared-page, vitals, visual approval lifecycle, Shopify commerce, WooCommerce, SEO inventory, buyer journey and checkout/empty-cart claims. All use local fixtures; production monitoring keeps its own schedule. The visual lifecycle includes expected internal failure scenarios, which the wrapper verifies as part of the successful acceptance group.

ESLint covers `scripts/`, `web/`, `checks/`, `tests/`, `config/` and the root TypeScript files, with separate Node/browser settings. On failure, CI uploads the available `reports/local-*/` artifacts with a 7-day retention. The workflow has read-only repository permissions, a 20-minute timeout and cancels stale runs on the same ref.

**Validation:** the latest `pnpm check` passed with **70 unit tests** and TypeScript, with no lint errors; lint warnings remain. In this re-check, `pnpm install --frozen-lockfile --offline`, the format of the workflow/config/package files and the shared command with **all ten acceptance groups** passed. The new buyer journey and checkout/empty-cart claims groups were verified separately with 26 and 40 local scenarios for both platforms; they were added to the shared command. The workflow has not yet run on a GitHub runner; the changes are local and the first GitHub run needs a push. Production stores were not visited.

**Definition of done:** the workflow verifies the configuration, scheduler, reports and core UI before merge. To make a passing check a merge requirement, a GitHub branch protection/ruleset must require `Quality and local browser checks`; that repository setting was not changed in this task.

## Additional ideas — next possibilities

Added on October 10, 2026. Items 8–19 are proposals, not implemented features. Priorities are relative; before implementation we clarify the specific stores and expectations.

### 8. Identifying the cause of a failed check

**Benefit:** we can immediately tell a store problem from an unsuitable test product, a changed selector or a problem in the tester's environment.

We add a classification: storefront failure, configuration failure, unavailable test data, rate limited, blocked/challenge, runner failure and unverified. We keep the original error, HTTP statuses and evidence. A sold-out test product must look neither like a broken checkout nor like a passing check.

The first version can use clear rules by step and error type. An AI explanation is an addition that must point to the evidence and mark assumptions.

**Definition of done:** the same cause category has the same representation in all reports and notifications, without changing the actual test outcome.

**Priority:** high; builds on items 1, 3 and 4.

### 9. Explicit expectations per store

**Benefit:** the shared Shopify tests verify the store's actual intent.

Instead of only capabilities, we add settings such as: whether physical products are shipped, whether there should be a newsletter, what kind of cart is expected, which currencies and languages are active, and what the expected consent behavior is.

For each setting we keep its origin: set by the user, discovered and confirmed, or unknown. Automatic discovery must not merely switch off a check when functionality disappears.

Example: if the store is configured with a newsletter, a missing form is a problem; if support is unknown, the result is unverified. For a store with digital products, address fields may be explicitly not applicable.

**Definition of done:** every `not-applicable` decision has a verifiable reason or an explicit setting, not just a missing element.

**Priority:** high; a natural continuation of item 5.

### 10. Representative selection of products and variants

**Benefit:** we do not check only two products, which can miss important problems.

We allow roles: an available product, a product with several variants, a discounted product, a sold-out product, a bundle or subscription for the relevant stores. The user can name important products that are always checked.

We separate a permanent critical set from a rotating set. Rotation is reproducible: we record the seed and the exact list in the report. If a critical test product becomes unsuitable, we propose a replacement with an explanation. Changing the test data does not automatically mean approving a new visual baseline.

**Definition of done:** from the report we can repeat the check with the same products and variants.

**Priority:** high for stores with a large catalogue; medium for small stores.

### 11. Budget for requests and runs

**Benefit:** we can plan useful monitoring with a predictable volume of traffic and time.

We add a maximum number of checked pages, an approximate number of requests, a duration limit and a daily budget per store/origin. When a schedule is created, we show an approximate volume based on measured previous runs, clearly labelled as an estimate.

When the budget is exhausted, the next work is postponed and reported as not executed. Critical checks take precedence over heavy inventory audits. Static resources and external services are counted separately; the budget is not a promise that there will be no rate limiting.

**Definition of done:** the scheduler does not exceed the configured measurable limit and the panel explains every postponement.

**Priority:** medium; useful before adding more stores and parallelism.

### 12. Checks after a change, not only on a schedule

**Benefit:** we detect a problem soon after a deployment or an important change, instead of waiting for the next interval.

We add a protected trigger endpoint for CI and later a Shopify integration for supported, relevant events. We choose a short smoke/visual set according to the cause. We group nearby events so that a bulk change does not start dozens of runs.

Ready-made foundation for the Shopify integration: the official [webhooks](https://shopify.dev/docs/api/webhooks/latest). The specific topics, access and API version are checked at implementation time; not every storefront change has a suitable webhook. We also support a plain CI trigger without a Shopify app.

**Definition of done:** the event is visible as the reason for the run, duplicate deliveries do not start duplicate jobs, and the cooldown stays valid.

**Priority:** medium; after "Run now" and robust problem management.

### 13. Recording store-specific user scenarios

**Benefit:** a store with personalization, a configurator or a non-standard cart can have its own critical scenario.

We use [Playwright codegen](https://playwright.dev/docs/codegen) for an initial recording of actions and locators. Then we add assertions, expected products/amounts and limits on the actions; recorded clicks alone do not prove correct behavior.

To start, we maintain reviewed `.spec.ts` scenarios in the repository. Later there may be an editor for a restricted list of steps in the panel. Uploading and running arbitrary JavaScript through the panel requires a separate isolation and access model, so it is not the first implementation.

**Definition of done:** the custom scenario uses the shared pacing, reports, capabilities and artifacts, and states which business goal it verifies.

**Priority:** medium; when the shared theme profiles are not enough.

### 14. Comparing a release candidate with production

**Benefit:** we check a future theme or a staging version before it becomes visible to customers.

We add a separate preview/staging target and verify the critical scenario against production expectations. A Shopify preview may require query parameters and cookies; the current origin-only model must be extended with explicit preview settings, without arbitrarily loosening URL validation.

Production and preview keep separate sessions. The visual candidate can be compared with the approved production baseline, but a preview run does not replace it. Publishing a theme remains a separate action; the tester's result is evidence for a decision, not an automatic approval of the deployment.

**Definition of done:** the report clearly shows which version was checked and how it differs from the approved production version.

**Priority:** medium to high, if the project is used while developing themes.

### 15. Monitoring external scripts and apps

**Benefit:** we see when a new widget, app or tracking script degrades the page.

From the observed network requests and performance records we build a list of external domains, scripts, their visible costs and errors. We show a new domain, a new script, increased resource size or changed blocking behavior compared with comparable runs.

We record which consent state was used. When CDN addresses change, we normalize only well-defined versions/parameters. Blocking a specific script can be used as a diagnostic experiment, but does not by itself prove that the app is the cause.

**Definition of done:** the change has a URL, a time of observation and a measurable effect; an unknown transfer size is not reported as zero.

**Priority:** medium; builds on the existing passive performance measurements.

### 16. Approved text expectations for key content

**Benefit:** we catch key texts that disappear or are changed unintentionally, even when the screenshot diff is small.

The user chooses specific texts/areas: the purchase button, shipping, returns, an availability warning, the headline. We keep approved expectations per store and language, with a diff and manual approval on an intentional change.

We normalize whitespace and explicitly chosen dynamic values. We do not freeze the whole DOM, the catalogue or all prices. This complements the dictionaries and the visual baselines: spelling, correct text and correct layout are different checks.

**Definition of done:** a missing key text gives a concrete problem; a new run does not automatically change the approved expectation.

**Priority:** medium; useful for campaigns and multilingual stores.

### 17. Visual baselines for states and an approval history

**Benefit:** we build on the implemented item 6 with important states that an ordinary page screenshot does not show.

We add named states: an open mobile menu, a cart with a product, a selected variant, a validation error and a sold-out product. Each state has its own stable identifier, browser and approved image.

In the panel we add a note on approval, a version history and an explicit rollback to a specific earlier version. For team use we also record which user approved. AI or heuristics may describe the difference, but do not approve a version automatically.

Approving a screenshot must not cancel a functional failure in the same run. For example, a visually approved button that does not add a product remains a functional problem.

**Definition of done:** a rollback is specifically chosen and confirmed; the history shows the version, images, reason and time of approval.

**Priority:** medium; after usage and feedback on the current approval flow.

### 18. Reproducible problems and more theme fixtures

**Benefit:** we fix the tester without repeatedly loading production, and verify that theme support is not accidental.

We add local representative pages for the cart drawer/cart page, variant picker, predictive search, consent and localization. A ready starting point for a specific theme is the official [Shopify Dawn repository](https://github.com/Shopify/dawn); the version is pinned and the license terms are checked when files are used.

For a hard-to-reproduce problem we can keep a minimal reviewed HTML/API fixture or a [Playwright HAR replay](https://playwright.dev/docs/mock#replaying-from-har). We strip session data from shared fixtures. HAR replay reproduces recorded responses; it does not prove the current behavior of the real Shopify backend.

**Definition of done:** a fix comes with a local scenario that reproduces the problem and would have failed before it.

**Priority:** high for reliability across more themes; added gradually as real problems appear.

### 19. Portable backup and monitoring of the tester itself

**Benefit:** we restore the configuration and approved versions after a problem, and know when the tool itself has stopped checking.

We add an export/import package with the configuration, approved pointers, version manifests and the selected images. The package has a schema version and checksums. On import we show which stores and approvals will be added or replaced, and require an explicit decision on conflict. We do not include browser storage and credentials by default.

Separately, we measure the queue, the age of the last valid run, the scheduler heartbeat, cooldowns, disk space and notification delivery. An HTTP server that responds is not sufficient proof of working monitoring.

If integration with observability infrastructure is needed, we can use [OpenTelemetry for Node.js](https://opentelemetry.io/docs/languages/js/) for traces and metrics. The first version can be a simple status/API and an external heartbeat monitor.

**Definition of done:** restoring into an empty installation keeps the same approved images, and a stopped scheduler is distinguishable from a healthy store.

**Priority:** high for continuous hosting; medium for local use.

### Which of the new ideas to start with

| Idea | Why now | Dependency |
| --- | --- | --- |
| 8. Failure classification | Reduces misleading results and future notification noise | Clear assertions and stable check IDs |
| 9. Per-store expectations | Shared tests gain meaning for a specific store | Configuration and setup in the panel |
| 10. Representative products | Improves coverage of the real buyer journey | Discovery and variant verification |
| 18. Theme fixtures | Makes new support verifiable and durable | Added together with concrete fixes |
| 19. Backup and tester health | Protects already approved versions and continuous monitoring | Persistence model and scheduler status |

Ideas 11–17 are next modules, depending on the stores' needs. The main buyer scenario and the notifications from items 2 and 3 come before expanding to more integrations.

## Ready-made components for additional features

| Need | Solution | How it is included | Condition or limitation |
| --- | --- | --- | --- |
| Notifications to many channels | [Apprise](https://github.com/caronc/apprise) | A separate service and an adapter over the results | Keep credentials out of reports; start with the needed channels |
| Availability and tester monitoring | [Uptime Kuma](https://github.com/louislam/uptime-kuma) | A separate service alongside the browser checks | Needs a meaningful health/heartbeat signal for the scheduler |
| Visual approval | [Argos](https://argos-ci.com/docs/playwright) | Playwright integration | The hosted service needs an account; the code is MIT, but self-hosting is complex |
| Lighthouse history and budgets | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | CI or a separate audit process | Do not duplicate the current Lighthouse checks without need |
| Shopify theme audit in CI | [Shopify Lighthouse CI Action](https://github.com/Shopify/lighthouse-ci-action) | In the theme repository's workflow | Assess suitability for the specific theme and environment |
| Liquid and theme JSON checks | [Shopify Theme Check](https://shopify.dev/docs/storefronts/themes/tools/theme-check) | An additional module or the theme's workflow | Needs the theme files; does not work from a URL alone |
| Real-visit performance | [CrUX API](https://developer.chrome.com/docs/crux/api) | Periodic retrieval of individual field metrics | 28-day window; data may be missing for a given URL or origin |
| Shared configuration schema — implemented | [Ajv](https://github.com/ajv-validator/ajv) | Local JSON Schemas for sites/settings/Woo commerce; shared validation for files and the panel | Defaults and platform URL/Intl checks are kept; no coercion and no external APIs |

**User's choice: we add only Ajv.** We keep the Node/TypeScript stack; we add no Python, Apprise or the other proposed services. Ajv is already integrated into the validation of store settings, store lists and the Woo commerce structure. Details: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

### Check for local integration without sign-ups — 2026-10-10

**7 of the 8 proposals have open-source code.** The CrUX API is an external Google service. Open source alone does not mean easy deployment or operation without credentials.

Here "without sign-ups" means without an external SaaS account. A self-hosted service may require a local administrator and an internal token. A local HTTP endpoint between our own containers does not mean a dependency on someone else's API. If we want everything in a single Node process, the suitable tools are mainly Ajv, the Lighthouse CI CLI and Theme Check when a theme is available.

| Tool | License | No external sign-up/API | Adding it to the project | Assessment for our project |
| --- | --- | --- | --- | --- |
| [Ajv](https://github.com/ajv-validator/ajv) | MIT | Yes | A Node dependency and local JSON schemas | Easiest to install; migrating the defaults/validations is separate work |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | MIT | Yes; its own local administrator | An optional Compose service and a persistent volume | Easy to deploy; needs a health endpoint that measures a fresh scheduler heartbeat |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | Apache-2.0 | Yes, local Chrome and filesystem output | `@lhci/cli`; `collect`/`assert`, `upload.target=filesystem` | The CLI is relatively easy; a history with a ready interface needs our own LHCI server |
| [Apprise](https://github.com/caronc/apprise) | BSD-2-Clause | Yes for the tool itself; depends on the channel | A Python CLI called by the runner; no need for the Apprise API service | Moderately easy, but adds Python. Desktop notifications need no account; Slack/Telegram and other external channels need their own credentials |
| [Theme Check](https://github.com/Shopify/theme-tools/tree/main/packages/theme-check-node) | MIT | Yes, for checking available local files | `@shopify/theme-check-node` and a separate Shopify source adapter | Suitable only with a theme folder/checkout; it cannot check Liquid from a storefront URL |
| [Argos](https://github.com/argos-ci/argos) | MIT | The hosted service no; the self-hosted variant needs assessment/adaptation | A whole platform, not just a Playwright package | Not an easy add-on: the dev Compose includes PostgreSQL, RabbitMQ, Redis and DynamoDB; the configuration contains external auth/storage integrations |
| [Shopify Lighthouse CI Action](https://github.com/Shopify/lighthouse-ci-action) | MIT | Not in its standard workflow | A GitHub Action in the theme repository | Requires Shopify app authentication and store access; does not meet the requirement for a local frontend-only tester |
| [CrUX API](https://developer.chrome.com/docs/crux/api) | External service; not a local library holding the CrUX data | No | A Google Cloud API key and requests | Excluded if there must be no external APIs; local Lighthouse cannot produce real CrUX field data |

**Proposed order, as an engineering estimate:** Ajv → Uptime Kuma when the scheduler runs continuously → Lighthouse CI only if its ready assertions/history add value over the current Lighthouse checks → Apprise when a concrete need for channels arises. Theme Check stays an optional source module. We defer Argos: we already have local explicit baseline approval per store, without uploading images.

For Uptime Kuma, it is not enough for the control server to return HTTP 200: a working UI with a stopped scheduler must produce a failing scheduler health. A deliberate pause or an empty schedule must be distinguishable from a hung process. On a single machine, Kuma cannot send a signal if the machine itself stops; an independent machine of our own solves this without an external SaaS.

For Apprise, local desktop notifications suit the workstation, not a headless Docker container without a desktop session. Email can use our own or an already available SMTP server, but remains dependent on it. We do not add notification service accounts automatically.

For LHCI we explicitly use the filesystem, not `temporary-public-storage`. For a ready historical chart there is [our own LHCI server](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/server.md), with a locally created project/token; this is not a sign-up with an external service. We do not start a second Lighthouse audit for the same purpose without a reason.

Sources for the clarifications: [LHCI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md), [Shopify Action authentication](https://github.com/Shopify/lighthouse-ci-action#authentication), [the current Theme Check Node package](https://github.com/Shopify/theme-tools/tree/main/packages/theme-check-node), [Argos development setup](https://github.com/argos-ci/argos/blob/main/CONTRIBUTING.md), [Argos Compose](https://github.com/argos-ci/argos/blob/main/docker-compose.yml), [Argos license](https://github.com/argos-ci/argos/blob/main/LICENSE).

This is research from the official repositories/docs and an assessment against our project. The tools were not installed or tried in this review.

CrUX metrics must be presented separately from local synthetic measurements. Missing field data does not mean a good or a bad result.

## New checks with practical value

**Price and availability: implemented for Shopify through the public storefront.** The new `33-commerce-consistency` checks the selected variant, the active/compare-at price, the JSON-LD offer or range, a real add through the UI, the API and UI of the cart, discounts and unavailable variants. Unclear sources, unsupported themes/plans and data changes stay `unverified`, with no automatic pass. Command: `pnpm test:commerce --site=<slug>`. Details: [Commerce checks](docs/COMMERCE.md). Validation passed with 54 unit tests, 26 local commerce scenarios and the shared acceptance checks; nothing was run against a real store.

WooCommerce was researched with a separate agent and has been added through separate platform adapters/tests. The plan and the official sources are in [WOOCOMMERCE-RESEARCH-TEMP.md](WOOCOMMERCE-RESEARCH-TEMP.md).

| Check | What it proves | Proposed priority |
| --- | --- | --- |
| Price across the UI, JSON-LD and cart | Customers and search engines see a consistent price for the relevant variant and currency | High |
| Availability between the UI and the product | An available variant can be added; a sold-out variant is displayed correctly | High |
| Analytics events | The expected product view and add-to-cart events are sent with correct data | Medium |
| Tracking before and after consent | Predefined trackers respect the expected behavior on accept/reject | Medium |
| Broader SEO inventory — implemented | Canonical, title/description, JSON-LD, visible H1, og:url, duplicates and canonical targets across the whole inventory; Shopify/WooCommerce | Medium |
| Markets scenarios | Expected language, currency and prices in selected markets | Medium |
| Test order in a test environment | A completed checkout and confirmation | Later, configured separately |

The analytics and consent checks require expectations for the specific integrations. To start, we check the observed network requests and payloads, without changing production settings. This does not prove full legal compliance.

**SEO inventory: implemented.** `35-seo-inventory` walks the configured and discovered pages, collects all problems in `seo-inventory.json` and distinguishes errors from warnings for review. Cart/search/noindex have a separate policy. Command: `pnpm test:seo --site=<slug>`. Scope and limitations: [docs/SEO.md](docs/SEO.md). Validation: 13 local SEO checks, with no real store.

## Panel and history improvements

- "Run now", through the same queue and limits as scheduled runs.
- Progress by step and access to the current logs.
- Problems by severity: blocked purchase, core functionality, quality and recommendations.
- Filters by store, check, browser, status and period.
- Explicit actions to accept a spelling finding and a visual change.
- A history of configuration changes.
- Retention by days and size instead of only the last 30 runs; keep the evidence for open problems.
- As the history grows: SQLite for runs, results, problems and notifications, with the large artifacts staying files.

SQLite makes sense when searching and the problem lifecycle become awkward over JSON files. The current scheduler does not immediately need Redis or a new distributed queue.

If the panel will be used over the internet by a team, we add authentication and roles, or a protected reverse proxy. The current same-origin token is not a user login. For local use we keep the simple startup.

## Proposed order of execution

### Stage 1: Trustworthy results

1. Fix the checkout and empty-cart assertions.
2. Fix the visual baseline paths.
3. CI with the local checks and a wider lint scope.
4. Comparable comparisons and stable `checkId`s.

### Stage 2: Useful daily monitoring

1. An end-to-end buyer scenario.
2. Problem state, notifications and recovery.
3. "Run now" through the existing scheduler.
4. Independent monitoring of the tester.

### Stage 3: Easier use with several stores

1. Automatic discovery and validation during setup.
2. Theme profiles and explicit capabilities.
3. Filters, evidence and approval of findings in the panel.
4. More suitable retention and, if needed, SQLite.

### Stage 4: Deeper audit features

1. Price and availability consistency.
2. Analytics and consent behavior.
3. CrUX field metrics.
4. Theme Check when access to the theme repository exists.
5. Additional markets and test checkout scenarios.

## What to keep simple for now

- Use the existing Playwright, axe, Lighthouse and Tesseract integrations.
- Build on the scheduler; add concurrency between stores only when proven necessary and with per-origin limits.
- Start with one notification channel, then expand.
- Do automatic discovery with a manual fallback, instead of promising universal support for every theme.
- AI summaries of problems may come later, but the source of the result stays the check and the evidence.

The first implementation with the greatest value is: precise critical checks, one buyer scenario, a notification on a problem and a clear link to the evidence.

Company images: on October 10, 2026, at an explicit request, 175 local image files of the real tested store were deleted, including the six old snapshots and the saved trace images/resources. Older Git commits were not rewritten.

## Implemented WooCommerce support

Added: an explicit platform choice, Woo URL/ID inventory, a public Store API/cart adapter, separate tax/discount/precision rules, simple/variable/AJAX and classic/block scenarios. Shopify keeps its old configurations and cart rules; Woo does not run Shopify suites or cart endpoints. The shared reports, scheduler and visual approvals stay shared, and the baseline fingerprint includes the platform. Setup: [WooCommerce](docs/WOOCOMMERCE.md). Validation is local; real stores were not visited.

WooCommerce validation: `pnpm check` passed with 61 unit tests and no TypeScript/lint errors. The shared local acceptance suite passed, including the Shopify regression, the panel and platform selection; the latest Woo changes were verified with 22 loopback scenarios. Checked: cookie/token/nonce carts, AJAX variations, tax/precision rules, the absence of Shopify requests and the refusal to modify another cart on a token race. Real Shopify/Woo stores were not visited.
