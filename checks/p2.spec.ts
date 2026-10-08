import { test, expect } from '../tests/fixtures';
import { auditSpelling } from '../tests/spelling';
import { configuredPages, prepareInventory, pageInventory } from '../tests/inventory';
import type { APIRequestContext } from '@playwright/test';

async function content(page: import('@playwright/test').Page) {
  await page.setContent(`<html lang="en"><body><header>Heloow</header><main>
    <p lang="bg">Магаазииин</p><p>Zerno</p><label>Adresss</label>
    <input value="customersecrettypo" placeholder="Emailll" title="Informatonn" aria-label="Serchhh">
    <textarea>textareasecrettypo</textarea><span hidden>hiddensecrettypo</span><script>const secret = 'scriptsecrettypo';</script>
    <img width="20" height="20" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'/>" alt="Imaggge">
  </main></body></html>`);
}

test('report: extracts visible DOM and attributes, excludes user values, respects brand allowlist', async ({
  page,
}, testInfo) => {
  await content(page);
  const report = await auditSpelling(page, testInfo);
  expect(report.findings.some(f => f.word === 'Heloow')).toBe(true);
  expect(report.findings.some(f => f.language === 'bg')).toBe(true);
  expect(report.findings.some(f => f.source === 'placeholder')).toBe(true);
  expect(report.findings.some(f => f.source === 'alt')).toBe(true);
  expect(report.findings.some(f => f.source === 'aria-label')).toBe(true);
  expect(report.findings.some(f => f.source === 'title')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('secrettypo');
  expect(report.findings.some(f => f.word === 'Zerno')).toBe(false);
});

test('inventory: configured and discovered pages share one cached list', async () => {
  const requested: string[] = [];
  const request = {
    get: async (url: string) => {
      requested.push(url);
      return {
        ok: () => true,
        status: () => 200,
        headers: () => ({}),
        url: () => url,
        json: async () => ({ products: [{ handle: 'extra-product' }] }),
      };
    },
  } as unknown as APIRequestContext;
  await prepareInventory(request);
  expect(requested).toHaveLength(1);
  expect(pageInventory().some(p => p.handle === 'extra-product')).toBe(true);
  expect(configuredPages().some(p => p.type === 'static')).toBe(true);
});

test('touch: mobile device context exposes touch interaction', async ({ page }) => {
  await page.setContent('<button onclick="this.textContent=\'Tapped\'">Tap</button>');
  expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Tap', exact: true }).tap();
  await expect(page.getByRole('button')).toHaveText('Tapped');
});

test('strict: unaccepted findings fail with contextual attachments', async ({ page }, testInfo) => {
  await content(page);
  if (process.env.P2_ACCEPTED) {
    const report = await auditSpelling(page, testInfo);
    expect(report.findings.every(finding => finding.accepted)).toBe(true);
  } else {
    await expect(auditSpelling(page, testInfo)).rejects.toThrow('Unaccepted spelling findings');
  }
  expect(testInfo.attachments.some(a => a.name === 'spelling.json')).toBe(true);
  expect(testInfo.attachments.some(a => a.name === 'spelling-context')).toBe(true);
});
