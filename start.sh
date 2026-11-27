#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --no-open ) ]]; then
  echo 'Usage: ./start.sh [--no-open]' >&2
  exit 1
fi
command -v docker >/dev/null || { echo 'Install Docker Desktop/Engine with Docker Compose first.' >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo 'Starting Docker Desktop…'
  docker desktop start || { echo 'Start Docker Desktop or Docker Engine, then run ./start.sh again.' >&2; exit 1; }
  for ((attempt=0; attempt<60; attempt++)); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || { echo 'Docker is not ready. Check Docker Desktop/Engine.' >&2; exit 1; }
fi
docker compose version >/dev/null
if [[ -n "$(docker compose --profile scheduled ps --status running -q scheduler)" ]]; then
  echo 'The file-based scheduler is running. Stop it before starting the managed panel; both share scheduler state.' >&2
  exit 1
fi
container=$(docker compose --profile managed ps --status running -q control)
if [[ -z "$container" ]]; then
  echo 'Building and starting the panel…'
  docker compose --profile managed up -d --build --no-recreate control
  container=$(docker compose --profile managed ps --status running -q control)
else
  echo 'Using the running panel without restarting it.'
fi
[[ -n "$container" ]] || { echo 'Panel did not start. Run: docker compose --profile managed logs control' >&2; exit 1; }
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  health=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [[ "$health" == healthy ]]; then ready=true; break; fi
  [[ "$health" == unhealthy ]] && break
  # Reuse the health probe so a new panel need not wait for Docker's 30-second interval.
  if docker exec "$container" node scripts/control-healthcheck.js >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || { echo 'Panel is not healthy. Run: docker compose --profile managed logs control' >&2; exit 1; }
address=$(docker compose --profile managed port control 8080)
case "$address" in
  0.0.0.0:*|\[::\]:*) address="127.0.0.1:${address##*:}" ;;
esac
url="http://$address"
echo "Panel ready: $url"
if [[ "${1:-}" != --no-open ]]; then
  if command -v open >/dev/null; then open "$url" || echo "Open $url in your browser."
  elif command -v xdg-open >/dev/null; then xdg-open "$url" || echo "Open $url in your browser."
  else echo "Open $url in your browser."; fi
fi
