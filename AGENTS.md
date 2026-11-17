# Project instructions

## Modern Web Guidance

- At the start of every task that changes HTML, Tailwind classes, report templates or client-side JavaScript, run `pnpm guidance:sync`. This installs or refreshes the complete official GoogleChrome/modern-web-guidance skill from upstream; do not pin, vendor or hand-edit its generated files.
- Read `.agents/skills/modern-web-guidance/SKILL.md` after syncing and follow its current search/retrieve workflow before implementation. Use `pnpm guidance search "<focused capability>"` and `pnpm guidance retrieve "<returned IDs>"` for the latest published CLI and guidance. Apply every relevant recommendation, rather than adding unrelated features from the catalog.
- For broad modernization tasks, also run `pnpm guidance:scan`, verify findings in context and follow the upstream modernization workflow. A clean scan is not a complete audit; the scanner covers only a subset of the guides.
- Browser support for our panel and HTML reports: Baseline Widely available across Chromium, Firefox and WebKit. Use newer features only as progressive enhancements with working fallbacks. Keep all styling in Tailwind as described below.
- Evaluate storefront checks by observable behavior and accessibility, not by whether a store adopted a particular modern API. Keep synthetic interaction timings distinct from field INP.
- Guidance is a development tool. Do not fetch or execute it in the control server, scheduler, store runs, CSS build or required offline checks. If syncing fails, disclose it and use the previously installed guidance when available; do not claim it is current.

## UI and design

- Use Tailwind CSS for all new or changed interface styling, including the control panel and report templates. Express layout, spacing, typography, colors, responsive behavior and interaction states with Tailwind utilities rather than writing custom CSS selectors.
- Reuse a consistent spacing scale, color palette and accessible components. Build mobile-first layouts and verify keyboard focus, contrast, wrapping, overflow and persistent Activity visibility.
- Keep utility class names complete and literal in JavaScript templates so the Tailwind compiler can detect them. Reuse shared template helpers for repeated components.
- Add custom CSS only when Tailwind cannot reasonably express the behavior, and document the reason beside the rule. Do not expand the legacy handcrafted stylesheet for new features.
- Migrate existing styling as the relevant UI is changed; do not rewrite unrelated screens just to complete a migration.
- Use the local Tailwind CLI build; do not depend on a runtime CDN. Run `pnpm build:css` after changing templates/classes. `pnpm watch:css` is available during UI development. Treat `web/tailwind.css` as generated output.

## Verification

- Run checks appropriate to the change. For control-panel behavior, use `pnpm test:control:local`; for backend changes, run the relevant Node tests and `pnpm check`.
- Inspect desktop and mobile screenshots for UI changes. Use local fixtures for verification rather than contacting live stores without task authorization.
- Do not interrupt an active user run to restart the development server. Wait for it to finish before applying server changes.
