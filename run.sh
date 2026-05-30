#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  Zerno.co — Shopify health-check runner
#  Usage:
#    ./run.sh              (headless, standard)
#    ./run.sh --headed     (open browser window)
#    ./run.sh --debug      (step-through debugger)
# ─────────────────────────────────────────────

export TEST_RUN_DATE=$(date +%Y-%m-%d_%H-%M)
REPORT_DIR="reports/${TEST_RUN_DATE}"

echo ""
echo "══════════════════════════════════════════"
echo "  Zerno.co Health Check"
echo "  Run: ${TEST_RUN_DATE}"
echo "══════════════════════════════════════════"
echo ""

# Disable -e around the test run so that history/summary always executes,
# even when some tests fail (which is the most important time to update them).
set +e
pnpm exec playwright test "$@"
EXIT_CODE=$?
set -e

echo ""
echo "──────────────────────────────────────────"
echo "  Updating history..."
node scripts/update-history.js || echo "  ⚠  Could not update history (non-fatal)"

# Prune: keep only the 30 most recent dated report directories
PRUNE_LIST=$(find reports -maxdepth 1 -type d -name "????-??-??_??-??" 2>/dev/null | sort -r | tail -n +31)
if [ -n "${PRUNE_LIST}" ]; then
  PRUNE_COUNT=$(echo "${PRUNE_LIST}" | wc -l | tr -d ' ')
  echo "${PRUNE_LIST}" | xargs rm -rf
  echo "  Pruned ${PRUNE_COUNT} old report(s)"
fi

echo ""
echo "══════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
  echo "  ✓ All tests passed!"
else
  echo "  ✗ Some tests failed — check the report"
fi
echo ""
echo "  Detailed report : ${REPORT_DIR}/index.html"
echo "  History         : reports/history.html"
echo ""
echo "  Open report:"
echo "    pnpm exec playwright show-report ${REPORT_DIR}"
echo "══════════════════════════════════════════"
echo ""

exit $EXIT_CODE
