# Project instructions

## Docker-only execution (required)

- Run every project test, validation command and manual runtime reproduction inside Docker, using the pinned Playwright environment declared in this repository's `Dockerfile` and the locked project dependencies. This includes unit tests, TypeScript/lint checks, browser fixtures, the control panel and scheduler. Never run them directly with host Node.js, pnpm or host browsers, including for an isolated retry or debugging an intermittent failure.
- Use `docker compose run --build --rm -T checks pnpm check` for quick verification. For focused suites, replace `check` with the relevant package command and arguments; for a direct Node test, use `docker compose run --build --rm -T checks node --test scripts/<name>.test.js`. The isolated `checks` service has no merchant settings, credentials or baseline mounts.
- Use `pnpm check:local` or `pnpm check:pr [number]` on the host only as report controllers: they launch every validation stage through Docker Compose. Host execution is allowed for editing, Git/GitHub operations, Docker management and guidance tooling, not for running project checks or reproducing runtime behavior.
- For raw Docker commands, use `docker build --platform linux/amd64` and `docker run --platform linux/amd64 --init --shm-size=1g`. Prefer the configured Compose services.
- Keep runtime and validation services on `linux/amd64`, and keep the CI container image identical to the base image in `Dockerfile`. Do not install a different Node/browser runtime in CI. Rebuild after source changes; never validate a stale image.
- If Docker is unavailable, start it if possible or report validation as blocked. Do not fall back to host execution and do not present earlier macOS results as Docker validation.
- Full browser suites stay in local Docker; GitHub runs only the quick quality/CSS job in the matching container and publishes text results. Never move the full suite back to hosted workers without user authorization.
- Do not stop/rebuild an active user service to validate a change. Disposable `checks` containers are separate from `control` and `scheduler`.

## Modern Web Guidance

- At the start of every task that changes HTML, Tailwind classes, report templates or client-side JavaScript, run `pnpm guidance:sync`. This installs or refreshes the complete official GoogleChrome/modern-web-guidance skill from upstream; do not pin, vendor or hand-edit its generated files.
- Read `.agents/skills/modern-web-guidance/SKILL.md` after syncing and follow its current search/retrieve workflow before implementation. Use `pnpm guidance search "<focused capability>"` and `pnpm guidance retrieve "<returned IDs>"` for the latest published CLI and guidance. Apply every relevant recommendation, rather than adding unrelated features from the catalog.
- For broad modernization tasks, also run `pnpm guidance:scan`, verify findings in context and follow the upstream modernization workflow. A clean scan is not a complete audit; the scanner covers only a subset of the guides.
- Browser support for our panel and HTML reports: Baseline Widely available across Chromium, Firefox and WebKit. Use newer features only as progressive enhancements with working fallbacks. Keep all styling in Tailwind as described below.
- Evaluate storefront checks by observable behavior and accessibility, not by whether a store adopted a particular modern API. Keep synthetic interaction timings distinct from field INP.
- Maintain `docs/MODERN-WEB.md` and the remaining-work index in `docs/TESTS.md` whenever executable guidance checks change: record rule IDs, source guides, severity, evidence, limitations and local validation. Upstream skill updates alone do not change store verdicts.
- Guidance is a development tool. Do not fetch or execute it in the control server, scheduler, store runs, CSS build or required offline checks. If syncing fails, disclose it and use the previously installed guidance when available; do not claim it is current.

## UI and design

- Use Tailwind CSS for all new or changed interface styling, including the control panel and report templates. Express layout, spacing, typography, colors, responsive behavior and interaction states with Tailwind utilities rather than writing custom CSS selectors.
- Reuse a consistent spacing scale, color palette and accessible components. Build mobile-first layouts and verify keyboard focus, contrast, wrapping, overflow and persistent Activity visibility.
- Keep utility class names complete and literal in JavaScript templates so the Tailwind compiler can detect them. Reuse shared template helpers for repeated components.
- Add custom CSS only when Tailwind cannot reasonably express the behavior, and document the reason beside the rule. Do not expand the legacy handcrafted stylesheet for new features.
- Migrate existing styling as the relevant UI is changed; do not rewrite unrelated screens just to complete a migration.
- Use the local Tailwind CLI build; do not depend on a runtime CDN. Run `pnpm build:css` after changing templates/classes. `pnpm watch:css` is available during UI development. Treat `web/tailwind.css` as generated output.

## Verification

- Run checks appropriate to the change through the Docker `checks` service. Package commands below are container commands: for control-panel behavior use `pnpm test:control:local`; for backend changes run the relevant Node tests and `pnpm check`.
- Inspect desktop and mobile screenshots for UI changes. Use local fixtures for verification rather than contacting live stores without task authorization.
- Do not interrupt an active user run to restart the development server. Wait for it to finish before applying server changes.
