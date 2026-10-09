# Browser control panel

[Back to README](../README.md) · [Scheduler](SCHEDULER.md)

Manage stores and schedules through forms, without editing JSON. The control service includes a small local HTTP server and the scheduler. It starts with no stores and makes no store requests until you save an enabled schedule.

## Start with Docker

```bash
docker compose --profile managed up -d --build control
```

Open **http://localhost:8080**. Add a store, enter its address and two product handles, choose checks and intervals, enable it, then save. New stores are paused until enabled explicitly. The UI uses hours for intervals and seconds for request pauses; the underlying scheduler continues using minutes/milliseconds.

The page includes:

- Store details, language and timezone.
- Per-store enable/pause and multiple checks.
- Check mode, browsers and random interval bounds.
- Optional local start windows and weekdays.
- Shared startup spreading, watchdog and cooldown settings.
- Shared/per-store request pacing and basic spelling settings.
- Current run, next eligible checks and last outcomes.
- Links to reports, and a settings link from the served report dashboard.

Use **Save changes** to apply edits. The scheduler reloads validated settings within roughly five seconds while idle, or after the active run finishes. Pausing/removing a store prevents subsequent runs; it does not abort a run already in progress. Removing a store retains its existing reports.

## Local hosting and a domain

There is no login or password in this version. Compose publishes the UI on `127.0.0.1` by default. On a remote machine, forward its port to your computer:

```bash
ssh -L 8080:127.0.0.1:8080 user@host
```

Then open localhost:8080 on your computer. For a domain, configure your reverse proxy to forward to the machine's localhost:8080, preserving the request Host header. Browser writes check the page origin and a same-origin request token.

To bind the host port to a different network address or port:

```bash
CONTROL_BIND_ADDRESS=0.0.0.0 CONTROL_PORT=8081 \
  docker compose --profile managed up -d control
```

This makes the editor available to clients that can reach that address; access control, if needed, belongs to your network or reverse proxy. The service itself remains password-free.

## Existing configurations

Stop the file-based scheduler before starting the control service; both use the same scheduler state and reports:

```bash
docker compose --profile scheduled stop scheduler
docker compose --profile managed up -d --build control
```

In the sidebar, open **Import existing configuration**, choose the existing store and scheduler files, review the forms and save. Importing into the editor does not apply the schedule until you save. Existing advanced options, such as selectors, accepted spelling findings and inventory settings, remain intact when editing common fields.

The editor writes one atomic configuration bundle in `managed-config/configuration.json` rather than independently replacing two files. This keeps stores and their schedules consistent. The original `sites.json`/`scheduler.json` files are not overwritten. The file-based scheduler and one-shot commands remain supported; the browser service uses its own managed configuration.

## Persistence and operations

Compose mounts `managed-config/`, `scheduler-state/` and `reports/`. Keep them when updating the container. They are gitignored and excluded from Docker build context.

```bash
docker compose --profile managed logs -f control
docker compose --profile managed stop control
```

Configuration saves are validated before writing. Invalid edits leave the previous configuration intact. If another tab saved first, the editor asks you to reload rather than overwrite its changes. Browser edits preserve cooldowns and future due times for existing job IDs. Restarting the service retains its saved configuration and timing state.

The healthcheck verifies the HTTP service and scheduler heartbeat. The service restarts an exited scheduler after five seconds. Run one control service per state directory; do not run the file-based scheduler concurrently.

## Run locally

```bash
pnpm control
```

Defaults: host `127.0.0.1`, port `8080`, configuration `managed-config/configuration.json`, state `scheduler-state/`. Override with `CONTROL_HOST`, `CONTROL_PORT`, `CONTROL_CONFIG_FILE` and `SCHEDULER_STATE_DIR`. Docker's `CONTROL_BIND_ADDRESS` is the host publish address; `CONTROL_HOST` is the address listened on inside the process.

```bash
pnpm test:control:local
pnpm check
```

Loopback tests cover setup, editing, save/reload, pause, advanced setting preservation, mobile layout and axe checks. API tests cover validation, revision conflicts, cross-origin writes and report path confinement. Scheduler tests verify live reload without store traffic.
