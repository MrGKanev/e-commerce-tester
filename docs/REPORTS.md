# Reports and dashboard

[Back to README](../README.md) · [Running tests](RUNNING.md)

## Artifacts

Each store run gets a UTC timestamp directory with millisecond precision:

```text
reports/
├── dashboard.html
└── my-store/
    └── <run-timestamp>/
        ├── html/index.html
        ├── results.json
        ├── run-metadata.json
        ├── page-inventory.json
        ├── spelling.json
        ├── web-vitals.json
        └── screenshots/
```

Artifacts depend on the selected checks. `screenshots/` is Playwright's output directory: it also holds traces and test-specific files, not just screenshots. Failure screenshots and retained failure traces help diagnose errors; content/shared-page checks may attach evidence on passing runs too. Video recording is disabled.

```bash
pnpm dashboard
pnpm exec playwright show-report reports/my-store/<run-timestamp>/html
pnpm dashboard:preview
```

Replace `<run-timestamp>` with an actual directory. The preview is an offline demo and keeps sample results separate from real reports. The runner prunes to the latest 30 runs per store and rebuilds the dashboard after execution.

Reports, screenshots, traces and storage state can include storefront/session data. Review artifacts before sharing them publicly.

## Pass rate and coverage

The selected projects, tags and filters define the scope of a run.

- **Executed pass rate:** `(passed + flaky) / completed tests`. Flaky final successes retain warning status and failed-attempt details.
- **Applicable coverage:** `completed / applicable selected tests`. Only skipped scenarios explicitly annotated `not-applicable` are excluded. Unknown skips and `fixme` remain in the denominator; interrupted or unstarted tests are unfinished.
- Missing denominators display `—`.

Statuses distinguish Passed, Failed, Flaky, No tests, No applicable tests, Interrupted, Incomplete and Global errors. Missing/corrupt final reports remain visible, using checkpointed results when available. Details include scenario title, file/line, project, skip reason and retry errors.

## Comparisons and findings

The dashboard compares scenarios with the previous run for the same store: new, recurring, resolved and unverified failures. A skipped or unstarted scenario does not prove resolution. A missing previous scenario means newly observed, not necessarily newly introduced. Without a usable scenario baseline, comparison is unavailable.

Visited URLs describe coverage, not defects on every URL. Screenshot and Trace ZIP links provide supporting evidence. Spelling findings are merged across URLs/projects and preserve locations and sources. Performance details distinguish measured budgets from missing observations.

## Run metadata

`run-metadata.json` is created before execution and checkpointed by the reporter. It records Node/Playwright/project versions, observed browser versions, locale/timezone, selected projects/tags/filters, pacing, Git revision and working-tree state, execution status and exit code. Legacy runs explicitly show unavailable metadata.

For annotation conventions and offline reporting validation, see [Contributing](CONTRIBUTING.md).
