# Next-session prompt

Copy the prompt below into the next coding session. The dated snapshot is a starting point; verify current repository and remote state before acting.

---

Continue implementing the remaining Modern Web storefront checks in `/Volumes/ROG/git/e-commerce-tester`. Work autonomously in substantial, tested batches and implement as much defensible coverage as possible. Do not stop after proposing a plan or completing one small feature. Communicate with me in Bulgarian; keep project code, comments and documentation in English.

## Start by recovering the actual state

1. Read `AGENTS.md`, `docs/MODERN-WEB.md` (especially Current handoff, the complete matrix and Suggested implementation order) and `docs/TESTS.md`.
2. Inspect Git status, branch, recent commits, PR #29 and its current CI. Preserve unrelated changes. Do not repeat completed actions or assume the PR is still open/unmerged.
3. If PR #29 remains open, continue its branch unless isolation is needed. If it has merged, start a new branch from current master. You may commit, push and create/update a PR; do not merge it automatically.
4. Follow the repository's `guidance:sync`, skill reading and focused search/retrieve workflow before relevant implementation. Compare the current catalog with the dated matrix; do not hand-edit or vendor generated guidance files.

## Dated starting snapshot: 2026-11-18

- PR #29: https://github.com/MrGKanev/e-commerce-tester/pull/29
- Branch: `feat/modern-web-coverage-expansion`.
- Last validated executable commit: `6bc5aa1`; full GitHub CI passed: https://github.com/MrGKanev/e-commerce-tester/actions/runs/44257229541.
- Documentation handoff commit: `2a9ec11`; later documentation commits may also exist.
- Catalog: 209 IDs — 1 Covered, 59 Partial, 51 Pending, 98 Not applicable. Partial is not complete; 110 topics still have remaining obligations.
- Validation: 375 Modern Web fixtures across five browser projects, 24 actual production-entry scenarios, 40 claims cases and 99 unit tests. The complete local acceptance chain passed; desktop/mobile fixture screenshots were inspected. No live stores were contacted.
- Dependency PRs #23, #25, #26 and #27 were superseded and closed. At handoff, #29 was the only open PR and ready for review.

## Reconcile existing code before adding coverage

Do not treat Pending/Partial labels as authoritative without reading the linked assertions. Some existing coverage was previously omitted from the matrix. Correct missing evidence and inaccurate gaps, and extend shared helpers instead of duplicating checks. Keep rule IDs, source guides, severity, evidence, limitations, platform/mode applicability and validation results synchronized in both Markdown files.

Existing implementation modules include:

- `tests/modern-web.ts`: passive orchestration and base rules; ends web-vitals sampling before inspector DOM/style work.
- `tests/modern-web-forms.ts` and `tests/modern-web-interactions.ts`: semantic autofill hints, guarded empty-field/native-select/checkbox probes and limited live-region observations.
- `tests/modern-web-widgets.ts`: bounded tabs/native details/switch/slider probes, including root-focus active-descendant and optional Home/End boundary observations.
- `tests/modern-web-dialog-scroll.ts`: already-open native modal wheel samples; stacked modals and unavailable wheel behavior are unverified.
- `tests/modern-web-tooltips.ts`: explicit tooltip focus/hover/Escape/position and hit-tested pointer-gap persistence samples with bounded delay, transition and cleanup handling.
- `tests/modern-web-carousel.ts`: explicit English named non-submit next/previous controls and single-rendered-slide roundtrip; exact nodes/control ownership retained, optional scope only.
- `tests/modern-web-resilience.ts`: media timing/hints, canvas alternatives, scroll affordances, single-line and generated-content observations.
- `tests/modern-web-components.ts`: bounded open-shadow naming/references and observable disabled form participants, without private ElementInternals access.
- `tests/modern-web-data-widgets.ts`: table relationships/clipping and semantic progress-ring samples.
- `tests/modern-web-policy.ts`: authored security-policy evidence; no production sink writes or disallowed-request probes.
- `tests/modern-web-presentation.ts`: viewport/text/preference stress.
- `tests/43-modern-web.spec.ts`: actual Full entry; Pages reuses passive checks only.

## Current interaction extension

The same branch now adds root-focus tab operation and enabled boundaries (130 cases across five projects), one tooltip hoverability path (50 cases) and explicit carousel next/previous restoration (40 cases). Catalog counts are 1 Covered / 59 Partial / 51 Pending / 98 Not applicable. Full adds seven evidence families. Executable batch `810562a` passed the full local acceptance chain, 500 Modern Web fixtures across five browser projects, 24 actual production-entry scenarios with seven evidence families, 99 unit tests and desktop/mobile screenshot inspection. Read the newest handoff in MODERN-WEB.md and PR checks for the final remote CI result; do not infer current state from the earlier 375-case snapshot.

## Next priorities

Use the exact per-guide matrix to select independent, safely executable work. High-value candidates include:

1. Extend bounded carousel samples for autoplay/pause, localized/alternative control contracts and scroll tracks; tab overflow/nesting/typeahead and tooltip arbitrary gap paths remain open. Root-focus tabs, enabled boundaries, one tooltip hoverability path and explicit next/previous carousel restoration now have targeted coverage. Safe modal dismissal restoration remains open.
2. Controlled font delay/failure/swap and hidden-slide loading, with actual layout/readability evidence and explicit unavailable timing.
3. Async validation and failed-submit focus/summary behavior in owned fixtures; sandbox autofill/password-manager workflows only with a configured contract. Synthetic composition events must not be credited as trusted OS IME coverage.
4. Owned policy-enforcement/consent lifecycle fixtures, worker scope and platform parity. Existing authored header observations do not establish enforcement, retention/deletion or legal compliance.
5. Custom-component reset/disable/restore, configured theme persistence and optional SPA/scroll/gesture workflows. Do not simulate unsupported real OS/device capabilities and call them covered.

Choose productive alternatives when a topic requires unavailable human/device/business contracts. Keep its gap explicit rather than fabricating coverage or stopping all independent work.

## Autonomy, parallel work and safety

- Parallel agents are authorized for independent modules and reviews. Give them non-overlapping files; integrate shared entry/config/docs centrally. Use fresh independent reviews after substantial pushes to find false positives and safety regressions.
- Keep all additional heuristics advisory unless a definite blocking contract is separately justified. Missing optional features or modern APIs must not fail a store.
- Use local/owned fixtures. No live-store traffic, successful registrations/subscriptions/orders or invasive security probing without explicit task authorization.
- Freeze the existing HTTP/WebSocket quarantine before interaction probes. It is not a JavaScript sandbox. Preserve prefilled values, retain exact original nodes, restore bounded state and mark rerenders/network-dependent outcomes unverified.
- Keep evidence free of field values, credentials, sensitive URL tokens and unnecessary text. Keep synthetic performance measurements distinct from field INP.
- Follow Tailwind/local CLI styling rules and inspect desktop/mobile screenshots for UI changes. Do not restart an active user development server or interrupt an active store run.

## Verification and maintenance

- Run checks appropriate to the change: `pnpm check`, `pnpm test:modern-web:local`, `pnpm test:modern-web:entry:local`, relevant Pages/a11y/vitals checks, and installed Firefox/WebKit projects when applicable. Run full local acceptance for broad changes or dependency upgrades.
- Run `pnpm build:css` after changing template/fixture classes; keep `web/tailwind.input.css` source declarations current. Generated `web/tailwind.css` is build output.
- Run `pnpm check:modern-web:coverage`. Optional `--catalog <already-downloaded-CLI-list.json>` verifies exact catalog equality offline. The validator also checks exact Partial membership in the TESTS index.
- Claims acceptance now uses parent-owned dynamic loopback servers before workers import settings. Preserve this isolation; a regression reserves legacy port 45994 and verifies independent fixtures. Do not reintroduce fixed-port ownership in claims workers.
- After each validated batch, update the handoff, matrix, remaining-work index and PR description; commit/push and inspect remote CI. Fix actual CI failures rather than merely rerunning them. Report precise limitations and leave a clean, reviewable state.

## Dependency constraints to recheck

The handoff used Playwright 1.65.1 with matching noble Docker image/browsers, pnpm 12.21.0, Tailwind/CLI 4.3.5, axe Playwright 4.14.0 and refreshed CI actions. Npm updates are grouped into one weekly Dependabot PR.

TypeScript stayed at 6.0.3 because typescript-eslint 8.73.0 supports `>=4.8.4 <6.1.0`; recheck current peer support before upgrading the major. The audit reported dev-only picomatch 4.0.7 under GHSA-fc5q-39xc-vjpf: patched `>=4.0.8` was named but not published, and registry latest was 4.0.7. Recheck publication and update if available; never introduce a nonexistent override or an unreviewed Git dependency to make the audit look clean.

Continue with implementation and verification, not only a status report. Keep Bulgarian progress updates concise and record all durable technical context in English in the repository.
