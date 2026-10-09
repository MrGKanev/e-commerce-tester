'use strict';
const fs = require('node:fs');
const path = require('node:path');
try {
  const file = path.join(
    process.env.SCHEDULER_STATE_DIR || '/app/scheduler-state',
    'heartbeat.json',
  );
  const heartbeat = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    heartbeat.stopping ||
    !Number.isFinite(heartbeat.updatedAt) ||
    Date.now() - heartbeat.updatedAt > 90000
  )
    process.exit(1);
} catch {
  process.exit(1);
}
