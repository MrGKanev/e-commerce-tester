# Project instructions

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
