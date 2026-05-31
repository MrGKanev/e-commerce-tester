# Contributing

Thank you for your interest in contributing! This project is a Playwright-based health-check suite for Shopify stores. Contributions that improve test coverage, portability, or reliability are very welcome.

## Getting started

```bash
git clone https://github.com/MrGKanev/e-commerce-tester.git
cd e-commerce-tester
pnpm install
pnpm run install:browsers
cp .env.example .env   # then edit .env with your store URL
```

## Running the tests

```bash
pnpm test              # headless
pnpm run test:headed   # watch the browser
pnpm run test:debug    # step-through debugger
pnpm run type-check    # TypeScript check without running tests
```

## Adding a test

1. Pick the spec file that best matches the area (or create `tests/17-yourfeature.spec.ts`).
2. Import shared selectors and helpers from `tests/helpers.ts` — avoid hardcoding URLs or selectors that already exist there.
3. Use condition-based waits (`waitFor`, `waitForLoadState`, `waitForResponse`) instead of fixed `waitForTimeout` delays.
4. Keep tests independent — each `test()` should set up its own state and not rely on execution order.
5. Add a corresponding entry to `TESTS.md`.

## Commit style

Use conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`. One logical change per commit.

## Pull requests

- Target the `master` branch.
- Include a short description of what changed and why.
- Run `pnpm run type-check` before pushing to catch TypeScript errors early.
- CI runs the full test suite on every PR via GitHub Actions.

## Reporting issues

Open an issue on GitHub. Include the store URL (if public), the failing test name, and the Playwright report output.
