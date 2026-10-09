'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const request = http.get(
  `http://127.0.0.1:${process.env.CONTROL_PORT || 8080}/api/health`,
  response => {
    response.resume();
    try {
      const heartbeat = JSON.parse(
        fs.readFileSync(
          path.join(process.env.SCHEDULER_STATE_DIR || '/app/scheduler-state', 'heartbeat.json'),
          'utf8',
        ),
      );
      process.exit(
        response.statusCode === 200 &&
          !heartbeat.stopping &&
          Date.now() - heartbeat.updatedAt < 90000
          ? 0
          : 1,
      );
    } catch {
      process.exit(1);
    }
  },
);
request.setTimeout(3000, () => {
  request.destroy();
  process.exit(1);
});
request.on('error', () => process.exit(1));
