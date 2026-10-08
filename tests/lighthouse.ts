import { chromium, type TestInfo } from '@playwright/test';
import { playAudit, type playwrightLighthouseConfig } from 'playwright-lighthouse';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LOCALE, TIMEZONE_ID } from './helpers';
import { assertNotLimited, paceContext, paceRequest } from './pacing';

async function readDebugPort(profile: string): Promise<number> {
  // Chromium binds port 0 itself, so there is no reserve/release port race.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const port = Number(
        (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      );
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await delay(100);
  }
  throw new Error('Chromium did not publish its Lighthouse debug port');
}

export async function runLighthouseAudit(
  url: string,
  name: string,
  testInfo: TestInfo,
  thresholds: playwrightLighthouseConfig['thresholds'],
): Promise<void> {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'store-lighthouse-'));
  const directory = testInfo.outputPath('lighthouse');
  try {
    await fs.mkdir(directory, { recursive: true });
    const context = await chromium.launchPersistentContext(profile, {
      args: ['--remote-debugging-port=0'],
      headless: true,
      locale: LOCALE,
      timezoneId: TIMEZONE_ID,
      serviceWorkers: 'block',
    });
    try {
      await paceContext(context);
      const port = await readDebugPort(profile);
      // Avoid a separate pre-audit navigation: Lighthouse loads the URL itself.
      await paceRequest();
      assertNotLimited();
      await playAudit({
        url,
        port,
        thresholds,
        reports: { formats: { html: true, json: true }, name, directory },
      });
    } finally {
      // playAudit writes reports before throwing for a failed threshold.
      // Keep those reports attached to failed tests as well.
      try {
        for (const [extension, contentType] of [
          ['html', 'text/html'],
          ['json', 'application/json'],
        ]) {
          const file = path.join(directory, `${name}.${extension}`);
          try {
            await fs.access(file);
          } catch {
            continue;
          }
          await testInfo.attach(`${name}.${extension}`, { path: file, contentType });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
}
