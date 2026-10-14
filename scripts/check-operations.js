'use strict';
/* global document, innerWidth -- Used in browser evaluations. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createControlServer } = require('./control-server');
const { emptyConfiguration } = require('./managed-config');
const { transition } = require('./monitoring');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-ui-'));
  const screenshots = path.resolve('reports/local-operations');
  fs.mkdirSync(screenshots, { recursive: true });
  const configFile = path.join(root, 'configuration.json'),
    reportsDir = path.join(root, 'reports');
  let mutations = 0;
  const fixture = http.createServer((request, response) => {
    if (request.method !== 'GET') mutations++;
    const woo = request.url.startsWith('/woo');
    const catalogue =
      request.url.startsWith('/products.json') ||
      request.url.startsWith('/woo/wp-json/wc/store/v1/products');
    response.setHeader('Content-Type', catalogue ? 'application/json' : 'text/html');
    if (catalogue)
      response.end(
        JSON.stringify(
          woo
            ? [
                {
                  name: 'Woo product',
                  permalink: `http://127.0.0.1:${fixture.address().port}/woo/product/sample`,
                  is_in_stock: true,
                  is_purchasable: true,
                },
              ]
            : {
                products: [
                  { title: 'Sample product', handle: 'sample', variants: [{ available: true }] },
                ],
              },
        ),
      );
    else
      response.end(
        `<!doctype html><html lang="en"><head><title>Store fixture</title></head><body><h1>Sample product</h1><span data-product-price>€29.90</span><button name="add">Add</button><input type="search"><script>${woo ? 'window.woocommerce={}' : 'window.Shopify={}'}</script></body></html>`,
      );
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const storeURL = `http://127.0.0.1:${fixture.address().port}`;
  const data = emptyConfiguration();
  data.sites = [
    {
      slug: 'shop',
      name: 'Fixture shop',
      url: storeURL,
      productHandle: 'old',
      productHandle2: 'old2',
      searchTerm: 'Sample',
    },
  ];
  data.scheduler.sites.shop = { enabled: false, jobs: [] };
  fs.writeFileSync(configFile, JSON.stringify(data));
  const scope = 'b'.repeat(64),
    run = '2026-10-14_12-00';
  fs.mkdirSync(path.join(reportsDir, 'shop/.monitoring'), { recursive: true });
  const incident = transition(
    {},
    {
      metadata: {},
      scenarios: [
        {
          name: 'Checkout total',
          title: 'Checkout total',
          project: 'Chrome',
          file: 'journey.ts',
          outcome: 'failed',
        },
      ],
    },
    run,
  ).state;
  fs.writeFileSync(
    path.join(reportsDir, 'shop/.monitoring', scope + '.json'),
    JSON.stringify(incident),
  );
  const server = createControlServer({
    configFile,
    stateDir: path.join(root, 'state'),
    reportsDir,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(origin + '/settings');
    await page.getByRole('button', { name: 'Discover products and check setup' }).click();
    await expect(page.locator('#discovery-result')).toContainText('Sample product', {
      timeout: 30000,
    });
    await page.getByRole('button', { name: 'Use suggested products' }).click();
    await expect(page.getByLabel('First product URL or handle')).toHaveValue('sample');
    assert.equal(mutations, 0);
    const configuration = await (await fetch(origin + '/api/config')).json();
    const discover = async (input, authorized = true) =>
      fetch(origin + '/api/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorized ? { 'X-Control-Token': configuration.token } : {}),
        },
        body: JSON.stringify(input),
      });
    assert.equal((await discover({ url: storeURL }, false)).status, 403);
    assert.equal((await discover({ url: 'file:///etc/passwd' })).status, 400);
    const woo = await (await discover({ url: storeURL + '/woo' })).json();
    assert.equal(woo.platform, 'woocommerce');
    assert.equal(woo.products[0].title, 'Woo product');
    const pinRun = path.join(reportsDir, 'shop', run);
    fs.mkdirSync(pinRun);
    fs.writeFileSync(
      path.join(pinRun, 'run-metadata.json'),
      JSON.stringify({ phase: 'finished', scenarios: [] }),
    );
    const pin = await fetch(origin + '/api/reports/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': configuration.token },
      body: JSON.stringify({ site: 'shop', run, pinned: true }),
    });
    assert.equal(pin.status, 200);
    assert.equal(fs.existsSync(path.join(pinRun, '.pinned')), true);
    await page.getByText('Report retention and backups', { exact: true }).click();
    await page.getByLabel('Maximum saved runs').fill('60');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('#message')).toContainText('Settings saved');
    assert.equal(JSON.parse(fs.readFileSync(configFile)).sites[0].retention.maxRuns, 60);
    await page.getByText('Checkout totals', { exact: true }).click();
    await page.getByRole('button', { name: 'Configure checkout totals' }).click();
    await expect(page.getByLabel('Shipping method radio selector')).toBeVisible();
    await page.getByRole('button', { name: 'Add form field', exact: true }).click();
    await expect(page.getByLabel('Field selector', { exact: true })).toBeVisible();
    await page.getByLabel('Field selector', { exact: true }).fill('#postal');
    await page.getByLabel('Test value (use synthetic details)', { exact: true }).fill('1000');
    await page.getByLabel('Shipping method radio selector').fill('#delivery');
    for (const key of ['subtotal', 'shipping', 'tax', 'discount', 'total'])
      await page.locator(`[data-path="sites.0.checkoutTotals.${key}Selector"]`).fill('#' + key);
    await page.getByText('Analytics and tracking consent', { exact: true }).click();
    await page.getByRole('button', { name: 'Configure analytics', exact: true }).click();
    await page.getByLabel('Expected analytics product ID').fill('10');
    await page.getByLabel('Accept consent button selector').fill('#accept');
    await page.getByLabel('Reject consent button selector').fill('#reject');
    await page.getByLabel('Tracker hostnames, one per line').fill('tracker.example.test');
    await page.getByLabel('Enable analytics checks', { exact: true }).check();
    await page.getByText('Market scenarios', { exact: true }).click();
    await page.getByRole('button', { name: 'Add market scenario', exact: true }).click();
    await page
      .locator('[data-path="sites.0.markets.0.checkoutTotals.shippingMethod"]')
      .fill('#delivery');
    for (const key of ['subtotal', 'shipping', 'tax', 'discount', 'total'])
      await page
        .locator(`[data-path="sites.0.markets.0.checkoutTotals.${key}Selector"]`)
        .fill('#' + key);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('#message')).toContainText('Settings saved');
    await expect
      .poll(() => JSON.parse(fs.readFileSync(configFile)).sites[0].markets?.length)
      .toBe(1);
    const configured = JSON.parse(fs.readFileSync(configFile)).sites[0];
    assert.equal(configured.analytics.enabled, true);
    assert.equal(configured.checkoutTotals.fields[0].value, '1000');
    for (const [width, label] of [
      [1280, 'desktop'],
      [390, 'mobile'],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: path.join(screenshots, `settings-${label}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal((await new AxeBuilder({ page }).analyze()).violations.length, 0);
    }
    await page.getByRole('link', { name: 'Problems', exact: true }).click();
    await expect(page.locator('#issues-list')).toContainText('Checkout total');
    await page.getByLabel('Owner', { exact: true }).fill('Ana');
    await page.getByLabel('Note', { exact: true }).fill('Checking shipping threshold');
    await page.getByLabel('Mute until (UTC, ISO timestamp)').fill('2030-01-01T00:00:00Z');
    await page.getByRole('button', { name: 'Save problem' }).click();
    await expect(page.locator('#issues-list [role=status]')).toHaveText('Problem saved');
    await page.getByRole('button', { name: 'Refresh problems' }).click();
    await expect(page.getByLabel('Owner', { exact: true })).toHaveValue('Ana');
    for (const [width, label] of [
      [1280, 'desktop'],
      [390, 'mobile'],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: path.join(screenshots, `issues-${label}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal((await new AxeBuilder({ page }).analyze()).violations.length, 0);
      await expect(page.locator('#activity-toggle')).toBeVisible();
    }
    await page.getByLabel('Filter by store, check or owner').fill('absent');
    await expect(page.locator('#issues-list')).toContainText('No matching');
    assert.deepEqual(errors, []);
    console.log(
      'Operations UI, read-only discovery, incident editing, retention, desktop/mobile and axe checks passed.',
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    fixture.closeAllConnections();
    await Promise.all([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => fixture.close(resolve)),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
