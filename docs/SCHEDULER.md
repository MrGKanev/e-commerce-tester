# Long-running Docker scheduler

[Back to README](../README.md) · [Configuration](CONFIGURATION.md) · [Running tests](RUNNING.md)

Run this service on a separate machine to check multiple stores over time. You choose the modes, browser projects, interval ranges and optional local start windows. It requires explicit store and scheduler files; there is no implicit live schedule.

The scheduler runs **one job at a time across all stores**. It uses the existing runner, request pacing and reports. Random intervals distribute useful checks; the service does not generate extra traffic to disguise automation. Randomization cannot guarantee a store will not rate-limit or block requests.

## Set up

```bash
cp examples/sites.example.json sites.json
cp examples/scheduler.example.json scheduler.json
```

Edit both files. Supply explicit product handles for every scheduled store and match schedule overrides to store slugs. The example disables `second-store`; enable it or replace it with your own store configuration.

Validate before starting, without contacting stores:

```bash
pnpm scheduler:check
```

Or validate and run entirely through Docker:

```bash
docker compose --profile scheduled build scheduler
docker compose --profile scheduled run --rm scheduler \
  node scripts/scheduler.js --check --state-dir /app/scheduler-state
docker compose --profile scheduled up -d scheduler
```

The service uses `init: true`, a 1 GB shared-memory allocation, `restart: unless-stopped` and a 45-second shutdown grace period. The one-shot `e2e` service remains available independently.

## Choose the schedule

All scheduling durations are in **minutes**; request/test pacing is in **milliseconds**. This example gives all stores one smoke job, replaces the first store's job list with smoke plus a weekly full run, and disables a second store:

```json
{
  "startupSpreadMinutes": 120,
  "minGapMinutes": 5,
  "maxRunMinutes": 180,
  "cooldown": {
    "rateLimitMinutes": 360,
    "maxRateLimitMinutes": 10080,
    "failureMinutes": 30,
    "maxFailureMinutes": 1440
  },
  "pacing": {
    "testDelayMs": 5000,
    "testJitterMs": 3000,
    "requestDelayMs": 2000,
    "requestJitterMs": 2000
  },
  "defaults": {
    "jobs": [
      {
        "id": "smoke",
        "mode": "smoke",
        "intervalMinutes": [360, 720],
        "projects": ["Desktop Chrome"]
      }
    ]
  },
  "sites": {
    "my-store": {
      "jobs": [
        {
          "id": "smoke",
          "mode": "smoke",
          "intervalMinutes": [120, 240],
          "projects": ["Desktop Chrome"]
        },
        {
          "id": "weekly-full",
          "mode": "full",
          "intervalMinutes": [10080, 11520],
          "projects": ["Desktop Chrome"],
          "maxRunMinutes": 240,
          "window": {
            "timezone": "Europe/Sofia",
            "weekdays": [6, 7],
            "start": "08:00",
            "end": "20:00"
          }
        }
      ]
    },
    "second-store": { "enabled": false }
  }
}
```

| Setting                | Behavior                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `startupSpreadMinutes` | New and overdue jobs get an initial random delay between zero and this value; default 60                                |
| `minGapMinutes`        | Minimum quiet time after a job finishes before any store starts; default 5                                              |
| `maxRunMinutes`        | Watchdog limit for a job, overridable per job; default 120                                                              |
| `defaults.jobs`        | Explicit job list inherited by stores without their own list                                                            |
| `sites.<slug>.jobs`    | Replaces the entire inherited list, rather than appending to it                                                         |
| `sites.<slug>.enabled` | `false` disables scheduling for that store                                                                              |
| `pacing`               | Existing base/jitter delays; also supported under `defaults` and per store, with more specific values taking precedence |
| Job `id`               | Unique stable ID within a store; changing it creates a new schedule                                                     |
| Job `mode`             | `smoke`, `full`, `pages`, `content`, `visual` or `audit`                                                                |
| Job `intervalMinutes`  | Uniform random delay `[minimum, maximum]` after completion; equal values give a fixed interval                          |
| Job `projects`         | Explicit project names; defaults to `Desktop Chrome`                                                                    |
| Job `window`           | Optional timezone, ISO weekdays (1 = Monday, 7 = Sunday) and local `start`/`end` times                                  |

An enabled store must have at least one job. There is no built-in smoke/full frequency. You can omit `defaults` and configure each store separately. Unknown store slugs, modes, project names and settings are rejected before store requests.

Windows control **start time**, not completion. `start` is inclusive, `end` exclusive; use same-day `HH:MM` bounds with `start < end`. Overnight windows are not supported. Omitted weekdays allow every day. Timezone conversion accounts for daylight saving transitions. This is an interval scheduler, not cron: a weekly interval constrained to weekends starts at the next eligible weekend window.

The first execution of every job, including a weekly job, is initially spread within `startupSpreadMinutes` and its window. Later executions use its interval range. Busy workers, windows and cooldowns can delay starts further. Missed runs do not accumulate into a catch-up queue. Choose frequencies that fit the duration of your jobs across all stores.

## Cooldowns and recovery

After HTTP 429, all jobs for the same store origin pause. The next start must respect both the configured cooldown and `Retry-After` (seconds or HTTP date). Repeated rate limits double the cooldown up to `maxRateLimitMinutes`; a longer server-requested delay is still honored. A successful, non-rate-limited run resets the streak.

Failed, timed-out and interrupted runs use separate exponential failure cooldowns. Test failures do not immediately replay the same job. Stores sharing an origin share cooldowns even if they use different slugs. Other stores can continue.

A job exceeding its watchdog limit receives SIGTERM; after 15 seconds it is forcibly stopped. Container shutdown also interrupts the active process group and saves the outcome and next due time. After an unclean restart, an in-flight record is treated as interrupted and deferred. Future scheduled times and origin cooldowns survive restarts; overdue jobs are spread again.

## Persistent files and operations

Compose mounts:

| Host path                      | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `sites.json`, `scheduler.json` | Read-only configuration                                                 |
| `reports/`                     | Normal per-store reports and dashboard                                  |
| `scheduler-state/`             | Atomic schedule state, rate-limit markers, heartbeat and exclusive lock |

These local configuration/state files are gitignored and excluded from the Docker build context. Keep `scheduler-state/` when updating or recreating the container. Removing it loses cooldowns and due times. Browser sessions are recreated by the existing setup for each run; scheduler persistence concerns timing and cooldowns.

```bash
docker compose --profile scheduled logs -f scheduler
docker compose --profile scheduled exec scheduler \
  node scripts/scheduler.js --status --state-dir /app/scheduler-state
docker compose --profile scheduled stop scheduler
```

`--status` and `--check` do not launch browsers or make store requests. Healthchecks observe a heartbeat while idle or running. Docker marks a stale heartbeat unhealthy; Docker Compose does not automatically restart a merely unhealthy process, although exited processes use the restart policy.

Configuration is read on startup. After editing either file, validate it and recreate the service so read-only file mounts pick up replacements:

```bash
docker compose --profile scheduled run --rm scheduler \
  node scripts/scheduler.js --check --state-dir /app/scheduler-state
docker compose --profile scheduled up -d --force-recreate scheduler
```

One scheduler owns a state directory. A live owner prevents a second scheduler from starting; dead local owners can be recovered, and a replaced container's lease can take up to 90 seconds to expire. This is a single-machine service, not a distributed worker system. Do not run separate schedulers or manual checks concurrently against the same stores: they do not share the scheduler's global queue.

Reports still retain the latest 30 runs per store across modes. Frequent smoke checks can therefore remove older full-run reports; archive reports externally if longer history is needed. Visual jobs require reviewed baselines in the image/build context before unattended comparisons.

## Local execution and verification

```bash
pnpm scheduler --config scheduler.json --sites-file sites.json --state-dir scheduler-state
pnpm scheduler:status
pnpm test:unit
pnpm test:pacing
```

Offline fixtures verify schedule distribution, restart persistence, exclusive ownership, 429 handling, backoff, timezone windows, sequential dispatch and shutdown. They do not contact live stores.
