import fs from 'node:fs';
export function controlEvent(event: Record<string, unknown>) {
  const file = process.env.CONTROL_EVENTS_FILE;
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify({ ...event, time: Date.now() }) + '\n');
  } catch {
    // Monitoring must not change test outcomes.
  }
}
