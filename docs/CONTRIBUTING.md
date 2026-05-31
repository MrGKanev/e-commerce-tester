# Contributing

Thank you for your interest in contributing. This project is a Playwright-based health-check suite for Shopify stores. Contributions that improve test coverage, portability, or reliability are very welcome.

## Getting started

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
pnpm install
pnpm run install:browsers   # installs Chromium, Firefox, and WebKit
cp examples/sites.example.json sites.json
# Edit sites.json with your store URL and product handles
```

**Requirements:** Node.js 22.13+ and pnpm 11+.

## Running the tests

```bash
pnpm test              # headless, all browsers
pnpm run test:headed   # watch the browser
pnpm run test:debug    # step-through debugger
pnpm run type-check    # TypeScript check without running tests
```

## Code quality

Before pushing, run:

```bash
pnpm lint              # ESLint — Playwright + TypeScript rules
pnpm format:check      # Prettier formatting check
pnpm run type-check    # tsc --noEmit
```

Auto-fix lint and formatting issues:

```bash
pnpm lint:fix
pnpm format
```

The CI pipeline checks all three. PRs with lint or type errors will fail.

## Adding a test

1. Pick the spec file that best matches the area (navigation, cart, security, etc.) or create `tests/28-yourfeature.spec.ts` with the next available number.
2. Import shared selectors and helpers from `tests/helpers.ts` — avoid hardcoding URLs or selectors that already exist there.
3. Use condition-based waits (`waitFor`, `waitForLoadState`, `waitForResponse`) instead of fixed `waitForTimeout` delays.
4. Keep tests independent — each `test()` should set up its own state and not rely on execution order or shared mutable variables.
5. For optional features (widgets, apps, multi-currency), use `test.skip(true, reason)` when the element isn't found instead of failing.
6. If your test uses a Chrome-only API (e.g. `newCDPSession`), add `test.skip(browserName !== 'chromium', '...')` so Firefox and Safari skip it gracefully.
7. Add a corresponding entry to `docs/TESTS.md`.

## Commit style

Use conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`. One logical change per commit.

## Pull requests

- Target the `master` branch.
- Include a short description of what changed and why.
- Run `pnpm lint && pnpm format:check && pnpm run type-check` before pushing.
- CI runs the full test suite on every PR via GitHub Actions.

## Reporting issues

Open an issue on GitHub. Include the store URL (if public), the failing test name, and the Playwright report output.
