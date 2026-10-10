import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import {
  approved,
  baselineRoot,
  baselineImage,
  digest,
  atomic,
  type VisualEntry,
} from '../scripts/visual-baselines';
import { readSiteSettings } from '../config/site-settings';
const requireJson = createRequire(__filename);

type Options = NonNullable<Parameters<ReturnType<typeof expect<Page>>['toHaveScreenshot']>[0]>;
export function viewportClip(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Visual checks require a fixed viewport');
  return { x: 0, y: 0, ...viewport };
}

/** Compare with an immutable approved version, never with the most recent run. */
export async function approvedScreenshot(
  target: Page | Locator,
  name: string,
  testInfo: TestInfo,
  options: Options = {},
) {
  if (testInfo.config.updateSnapshots !== 'none' || testInfo.project.ignoreSnapshots)
    throw new Error(
      'Automatic snapshot updates are disabled. Review and approve candidates in Reports.',
    );
  const page = 'viewportSize' in target ? target : target.page();
  const site =
    process.env.SITE_SLUG ||
    new URL(process.env.STORE_URL || 'https://zerno.co').hostname.replace(/[^a-z0-9-]/gi, '-');
  const run = process.env.TEST_RUN_DATE || String(testInfo.config.metadata.visualRun);
  const root = baselineRoot();
  const pin = testInfo.config.metadata.visualBaseline as { revision: string | null } | undefined;
  const baseline = approved(root, site, pin?.revision);
  const file = path.relative(testInfo.config.rootDir, testInfo.file).replaceAll(path.sep, '/');
  const id = digest([file, testInfo.project.name, name].join('\0')).slice(0, 32);
  const environment = {
    commercePlatform: readSiteSettings().platform,
    platform: process.platform,
    arch: process.arch,
    image: process.env.VISUAL_ENVIRONMENT || 'native',
    playwright: requireJson('@playwright/test/package.json').version,
    browser: page.context().browser()?.version(),
    browserName: testInfo.project.use.browserName,
    locale: testInfo.project.use.locale,
    timezoneId: testInfo.project.use.timezoneId,
    viewport: page.viewportSize(),
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor || 1,
    isMobile: Boolean(testInfo.project.use.isMobile),
    hasTouch: Boolean(testInfo.project.use.hasTouch),
    policy: 1,
    fullPage: options.fullPage || false,
    clip: options.clip || null,
    masks: options.mask?.map(mask => mask.toString()) || [],
  };
  const directory = path.resolve('reports', site, run, 'visual');
  fs.mkdirSync(path.join(directory, 'entries'), { recursive: true });
  const expected = testInfo.snapshotPath(id + '.png', { kind: 'screenshot' });
  if (!expected.startsWith(path.resolve('reports', site, run) + path.sep))
    throw new Error('Visual reference paths must stay inside the current run directory');
  // Only a disposable per-run reference is handed to Playwright.
  fs.mkdirSync(path.dirname(expected), { recursive: true });
  fs.rmSync(expected, { force: true });
  const old = baseline.entries[id];
  const compatible = old && JSON.stringify(old.environment) === JSON.stringify(environment);
  const hasBaseline = Boolean(old);
  if (old) {
    const bytes = baselineImage(root, site, baseline, id);
    fs.writeFileSync(path.join(directory, id + '-baseline.png'), bytes);
    if (compatible) fs.writeFileSync(expected, bytes);
  }
  const thresholds = readSiteSettings().thresholds.visual;
  const ratio = thresholds.components[name.replace(/\.png$/, '')] ?? thresholds.maxDiffPixelRatio;
  const settings = {
    ...options,
    animations: 'disabled' as const,
    caret: 'hide' as const,
    scale: 'css' as const,
    maxDiffPixelRatio: ratio,
  };
  // In read-only mode Playwright does not capture a missing reference.
  // Seed only the disposable run reference so its normal stability check can run.
  if (!compatible) await target.screenshot({ ...settings, path: expected });
  const attachmentStart = testInfo.attachments.length;
  let failure: unknown;
  try {
    // Playwright waits for stable screenshots and produces its native image diff.
    if ('viewportSize' in target) await expect(target).toHaveScreenshot(id + '.png', settings);
    else await expect(target).toHaveScreenshot(id + '.png', settings);
  } catch (error) {
    failure = error;
  }
  const matcher = failure as
    { matcherResult?: { attachments?: TestInfo['attachments'] } } | undefined;
  const attachments = [
    ...testInfo.attachments.slice(attachmentStart),
    ...(matcher?.matcherResult?.attachments || []),
  ];
  const actual = attachments.find(
    attachment => /-actual(?:\.png)?$/.test(attachment.name) && attachment.path,
  );
  const diff = attachments.find(
    attachment => /-diff(?:\.png)?$/.test(attachment.name) && attachment.path,
  );
  const current = path.join(directory, id + '-current.png');
  if (actual?.path) fs.copyFileSync(actual.path, current);
  else if (!failure && !compatible) fs.copyFileSync(expected, current);
  else if (!failure) await target.screenshot({ ...settings, path: current });
  const entry: VisualEntry = {
    id,
    site,
    run,
    file,
    project: testInfo.project.name,
    name,
    environment,
    sha256: fs.existsSync(current) ? digest(fs.readFileSync(current)) : '',
    status:
      !fs.existsSync(current) || (!compatible && failure)
        ? 'error'
        : !old
          ? 'missing'
          : !compatible
            ? 'incompatible'
            : failure
              ? 'changed'
              : 'matched',
    baselineRevision: baseline.revision,
    hasBaseline,
    hasDiff: Boolean(diff),
    maxDiffPixelRatio: ratio,
  };
  if (diff?.path) fs.copyFileSync(diff.path, path.join(directory, id + '-diff.png'));
  atomic(path.join(directory, 'entries', id + '.json'), entry);
  await testInfo.attach('visual-review', {
    body: JSON.stringify(entry),
    contentType: 'application/json',
  });
  if (fs.existsSync(current))
    await testInfo.attach('visual-current', { path: current, contentType: 'image/png' });
  if (hasBaseline)
    await testInfo.attach('visual-baseline', {
      path: path.join(directory, id + '-baseline.png'),
      contentType: 'image/png',
    });
  if (diff)
    await testInfo.attach('visual-diff', {
      path: path.join(directory, id + '-diff.png'),
      contentType: 'image/png',
    });
  if (!old)
    throw new Error(
      `No approved baseline for ${name}. Review this run and explicitly approve the screenshot.`,
    );
  if (!compatible)
    throw new Error(
      `Visual environment changed for ${name}. Re-run in the approved environment or review and approve this environment.`,
    );
  if (failure) throw failure;
}
