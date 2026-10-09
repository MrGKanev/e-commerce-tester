'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createControlServer } = require('./control-server');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'control-browser-'));
  const configFile = path.join(directory, 'config/configuration.json');
  const server = createControlServer({
    configFile,
    stateDir: path.join(directory, 'state'),
    reportsDir: path.join(directory, 'reports'),
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(origin);
    await page.getByRole('button', { name: 'Add a store', exact: true }).click();
    await page.getByLabel('Store name', { exact: true }).fill('Example Shop');
    await page.getByLabel('Store address', { exact: true }).fill('https://example.test');
    await page
      .getByLabel('First product URL or handle', { exact: true })
      .fill('https://example.test/products/one?variant=123');
    await page.getByLabel('Second product URL or handle', { exact: true }).fill('two');
    await page.getByLabel('At least (hours between checks)').fill('3');
    await page.getByLabel('At most (hours between checks)').fill('6');
    await page.getByLabel('Only start within a time window').check();
    await page.getByLabel('Window timezone', { exact: true }).fill('Europe/Sofia');
    await page.getByLabel('Start time', { exact: true }).fill('09:15');
    await page.getByLabel('Enable scheduled checks for this store').check();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    let saved = JSON.parse(fs.readFileSync(configFile));
    const storeId = saved.sites[0].slug;
    assert.equal(saved.sites[0].name, 'Example Shop');
    assert.equal(saved.sites[0].productHandle, 'one');
    assert.deepEqual(saved.scheduler.sites[storeId].jobs[0].intervalMinutes, [180, 360]);
    assert.equal(saved.scheduler.sites[storeId].enabled, true);
    assert.equal(saved.scheduler.sites[storeId].jobs[0].window.timezone, 'Europe/Sofia');
    // Editing common fields must preserve advanced configuration from an import.
    saved.sites[0].spelling = { acceptedFindings: ['reviewed-id'], excludeSelectors: ['.reviews'] };
    saved.sites[0].selectors = { price: '.custom-price' };
    fs.writeFileSync(configFile, JSON.stringify(saved));
    await page.reload();
    await page.getByLabel('Store name', { exact: true }).fill('Updated Shop');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    saved = JSON.parse(fs.readFileSync(configFile));
    assert.deepEqual(saved.sites[0].spelling.acceptedFindings, ['reviewed-id']);
    assert.equal(saved.sites[0].selectors.price, '.custom-price');
    await page.getByRole('button', { name: 'Scheduling & pauses', exact: true }).click();
    await page.getByLabel('Spread first checks over (hours)').fill('2');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    assert.equal(JSON.parse(fs.readFileSync(configFile)).scheduler.startupSpreadMinutes, 120);
    await page.getByRole('button', { name: /Updated Shop/ }).click();
    const desktopAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(
      desktopAxe.violations.map(v => ({
        id: v.id,
        nodes: v.nodes.map(node => ({ html: node.html, summary: node.failureSummary })),
      })),
      [],
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), 'store-control-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      'Mobile editor must not overflow',
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), 'store-control-mobile.png'),
      fullPage: true,
    });
    await page.getByLabel('Enable scheduled checks for this store').uncheck();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    assert.equal(JSON.parse(fs.readFileSync(configFile)).scheduler.sites[storeId].enabled, false);
    await page.reload();
    await expect(page.getByLabel('Store name', { exact: true })).toHaveValue('Updated Shop');
    await expect(page.getByLabel('Enable scheduled checks for this store')).not.toBeChecked();
    await page.getByText('Import existing configuration', { exact: true }).click();
    const imported = JSON.parse(fs.readFileSync(configFile));
    await page.locator('#import-sites').setInputFiles({
      name: 'sites.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported.sites)),
    });
    await page.locator('#import-scheduler').setInputFiles({
      name: 'scheduler.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported.scheduler)),
    });
    await page.getByRole('button', { name: 'Load files into editor', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Configuration loaded into the editor');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    assert.deepEqual(JSON.parse(fs.readFileSync(configFile)).sites[0].spelling.acceptedFindings, [
      'reviewed-id',
    ]);
    // Reports stay within the current browser tab and settings keep unsaved edits.
    const reportRoot = path.join(directory, 'reports');
    for (const [date, content] of [
      ['2026-10-09_09-00-00-001', 'Older report'],
      ['2026-10-09_10-00-00-001', 'Latest report'],
    ]) {
      const reportDir = path.join(reportRoot, storeId, date, 'html');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'index.html'),
        '<html lang="en"><title>Fixture report</title><body><h1>' + content + '</h1></body></html>',
      );
      fs.writeFileSync(
        path.join(reportDir, '../results.json'),
        JSON.stringify({ stats: { expected: 1 } }),
      );
      fs.writeFileSync(
        path.join(reportDir, '../run-metadata.json'),
        JSON.stringify({ phase: 'finished', mode: 'smoke' }),
      );
    }
    await page.getByLabel('Store name', { exact: true }).fill('Unsaved store edit');
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(page.locator('#reports-submenu')).toBeVisible();
    await page
      .locator('#reports-submenu')
      .getByRole('button', { name: /Updated Shop/ })
      .click();
    await expect(page.locator('#report-list').getByRole('button')).toHaveCount(2);
    await expect(
      page
        .frameLocator('#report-frame')
        .getByRole('heading', { name: 'Latest report', exact: true }),
    ).toBeVisible();
    await page.locator('#report-list').getByRole('button').nth(1).click();
    await expect(
      page
        .frameLocator('#report-frame')
        .getByRole('heading', { name: 'Older report', exact: true }),
    ).toBeVisible();
    assert.equal(context.pages().length, 1, 'Reports must not open another tab');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Store name', { exact: true })).toHaveValue('Unsaved store edit');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    assert.deepEqual(errors, []);
    console.log(
      'Control panel browser checks passed: onboarding, schedule/window edits, save/reload, advanced setting preservation, pause, mobile layout and axe. No store requests made.',
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
