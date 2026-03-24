#!/usr/bin/env bash
set -e

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

# Pass any extra args (--headed, --debug, etc.) to Playwright
npx playwright test "$@"
EXIT_CODE=$?

echo ""
echo "──────────────────────────────────────────"
echo "  Updating history..."
node scripts/update-history.js

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
echo "    npx playwright show-report ${REPORT_DIR}"
echo "══════════════════════════════════════════"
echo ""

exit $EXIT_CODE
