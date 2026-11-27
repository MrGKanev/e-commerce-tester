'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const specs = suites =>
  suites.flatMap(suite => [...(suite.specs || []), ...specs(suite.suites || [])]);
const json = attachment =>
  JSON.parse(
    attachment.path
      ? fs.readFileSync(attachment.path, 'utf8')
      : Buffer.from(attachment.body, 'base64').toString(),
  );

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-visits-'));
  const site = `shared-visits-${process.pid}`;
  const css = fs.readFileSync(path.join(root, 'web/tailwind.css'));
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  let counts;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'x-robots-tag': 'noindex' });
      response.end(body);
      counts.requests++;
      counts.bytes += Buffer.byteLength(body);
      if (request.headers['sec-fetch-dest'] === 'document') counts.documents++;
    };
    if (url.pathname === '/wp-json/wc/store/v1/cart')
      return send(200, 'application/json', '{"items":[]}');
    if (url.pathname === '/cart/clear.js') return send(200, 'application/json', '{}');
    if (url.pathname === '/fixture.css') return send(200, 'text/css', css);
    if (url.pathname === '/image.png') return send(200, 'image/png', image);
    if (url.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    if (url.pathname.startsWith('/probe-')) {
      counts.probes++;
      return send(204, 'text/plain', '');
    }
    if (url.pathname === '/fixture.js') return send(200, 'text/javascript', '');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const canonical = origin + request.url;
    const schema = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': url.pathname.includes('/products/') ? 'Product' : 'WebSite',
      name: 'Fixture product',
      image: origin + '/image.png',
      offers: { '@type': 'Offer', price: '12', priceCurrency: 'EUR' },
    });
    send(
      200,
      'text/html; charset=utf-8',
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned store ${url.pathname}</title><meta name="description" content="Owned fixture description"><meta name="viewport" content="width=device-width,initial-scale=1"><meta property="og:title" content="Owned store"><meta property="og:description" content="Owned fixture"><meta property="og:image" content="${origin}/image.png"><link rel="canonical" href="${canonical}"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/fixture.css"><script src="/fixture.js" defer></script><script type="application/ld+json">${schema}</script></head><body class="bg-white p-4 font-sans text-slate-900"><header><a href="/">Store home</a></header><main><section><h1 class="product__title">Fixture product</h1><p class="price">12 €</p><p class="product__description">A local product description for the owned store.</p><a href="/products/product-a">Fixture product</a><div class="product__media"><img class="h-64 w-64 max-w-full" src="/image.png" alt="Fixture product" width="256" height="256"></div><button class="min-h-11" type="button" name="add">Add to cart</button></section></main><footer><a href="/">Store home</a></footer></body></html>`,
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const inventory = [
    { url: origin + '/', type: 'home', language: 'en-US' },
    ...['product-a', 'product-b', 'extra'].map(handle => ({
      url: origin + '/products/' + handle,
      type: 'product',
      handle,
      language: 'en-US',
    })),
    { url: origin + '/collections/all', type: 'collection', language: 'en-US' },
    { url: origin + '/search?q=local&type=product', type: 'search', language: 'en-US' },
    { url: origin + '/cart', type: 'cart', language: 'en-US' },
  ];
  const inventoryFile = path.join(temporary, 'inventory.json');
  fs.writeFileSync(inventoryFile, JSON.stringify({ pages: inventory }));
  const results = [];
  try {
    for (const [platform, batch] of [
      ['shopify', false],
      ['shopify', true],
      ['woocommerce', true],
    ]) {
      counts = { documents: 0, requests: 0, bytes: 0, probes: 0 };
      const run = platform + (batch ? '-batched' : '-separate');
      const pages =
        platform === 'shopify'
          ? inventory
          : inventory.map(entry => ({
              ...entry,
              url: entry.url
                .replace(/\/products\/([^/?]+)/, '/goods/$1/')
                .replace('/collections/all', '/catalog/')
                .replace('/search?q=local&type=product', '/?s=local&post_type=product')
                .replace('/cart', '/basket/'),
            }));
      fs.writeFileSync(inventoryFile, JSON.stringify({ pages }));
      const directory = path.join(root, 'reports', site, run);
      fs.mkdirSync(directory, { recursive: true });
      const env = {
        ...process.env,
        STORE_URL: origin,
        STORE_PLATFORM: platform,
        SITE_SLUG: site,
        TEST_RUN_DATE: run,
        PRODUCT_HANDLE: 'product-a',
        PRODUCT_HANDLE_2: 'product-b',
        SEARCH_TERM: 'local',
        SITE_SETTINGS_JSON: JSON.stringify({
          platform,
          monitorScripts: true,
          ...(platform === 'woocommerce'
            ? {
                commerce: {
                  productUrls: ['/goods/product-a/', '/goods/product-b/'],
                  routes: { catalog: '/catalog/', cart: '/basket/', checkout: '/pay/' },
                },
              }
            : {}),
          locale: 'en-US',
          cookieConsent: { mode: 'none' },
          spelling: { mode: 'report', languages: ['en'] },
        }),
        SHARED_INVENTORY_RUN: batch ? '1' : '0',
        SHARED_VISITS_DIRECTORY: directory,
        PAGE_INVENTORY_FILE: inventoryFile,
        VISUAL_BASELINES_DIR: path.join(temporary, 'baselines'),
        TEST_DELAY_MS: '0',
        TEST_JITTER_MS: '0',
        REQUEST_DELAY_MS: '0',
        REQUEST_JITTER_MS: '0',
      };
      const code = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            require.resolve('@playwright/test/cli'),
            'test',
            '--config=checks/shared-visits.config.ts',
            '--project=Desktop Chrome',
            '--project=Mobile Chrome',
            ...(platform === 'woocommerce' ? ['--grep', 'Shared inventory —'] : []),
          ],
          { cwd: root, env, stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 1, 'Missing visual references must remain failures');
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'results.json')));
      assert.deepEqual(report.errors, []);
      const cases = specs(report.suites).flatMap(spec => spec.tests);
      const failures = cases.filter(test => test.status === 'unexpected');
      assert.equal(failures.length, batch ? 2 : 14);
      for (const failure of failures) {
        const errors = failure.results.flatMap(result => result.errors);
        assert.ok(errors.length > 0);
        assert.ok(
          errors.every(error => /No approved baseline/.test(error.message)),
          JSON.stringify(errors),
        );
      }
      const attachments = cases.flatMap(test =>
        test.results.flatMap(result => result.attachments || []),
      );
      const contracts = attachments
        .filter(item => item.name === 'page-check-contract.json')
        .map(json);
      assert.equal(contracts.length, platform === 'shopify' ? 2 : 0);
      assert.ok(contracts.every(item => item.continued === 2));
      assert.equal(
        attachments.filter(item => item.name === 'spelling.json').length,
        batch ? 14 : 28,
        'Spell once per batched visit',
      );
      const seo = attachments.filter(item => item.name === 'seo-inventory.json').map(json);
      assert.equal(attachments.filter(item => item.name === 'third-party-scripts.json').length, 2);
      assert.equal(seo.length, 2);
      for (const audit of seo) {
        assert.equal(audit.pages.length, 7);
        assert.deepEqual(audit.navigationErrors, []);
      }
      for (const family of [
        'modern-web',
        'modern-web-interactions',
        'modern-web-widgets',
        'modern-web-presentation',
      ])
        assert.equal(
          attachments.filter(item => item.name === family + '.json').length,
          12,
          'Probe evidence must survive visual failures',
        );
      const visual = attachments.filter(item => item.name === 'visual-review').map(json);
      assert.equal(visual.length, 14);
      assert.ok(visual.every(item => item.file === '../tests/30-inventory-visual.spec.ts'));
      assert.equal(counts.probes, 0);
      if (batch) {
        const visits = attachments.filter(item => item.name === 'page-visit.json').map(json);
        assert.equal(visits.length, 14);
        assert.ok(
          visits.every(item => item.completedResponses >= 4 && item.responseBytesLowerBound > 0),
        );
        const evidence = path.join(root, 'reports/local-shared-visits');
        fs.mkdirSync(evidence, { recursive: true });
        for (const project of ['Desktop Chrome', 'Mobile Chrome']) {
          const current = visual.find(item => item.project === project);
          fs.copyFileSync(
            path.join(directory, 'visual', current.id + '-current.png'),
            path.join(evidence, project + '.png'),
          );
        }
        if (platform === 'shopify') {
          const previous = results[0];
          assert.deepEqual(
            visual.map(item => [item.id, item.environment, item.sha256]).sort(),
            previous.visual.map(item => [item.id, item.environment, item.sha256]).sort(),
            'Existing visual identities and environments must be preserved',
          );
          assert.equal(previous.documents, 80);
          assert.equal(counts.documents, 38);
          assert.ok(counts.requests < previous.requests);
          assert.ok(counts.bytes < previous.bytes);
        } else assert.equal(counts.documents, 14);
      }
      results.push({ platform, batch, ...counts, visual });
    }
    const summary = results.map(({ visual: _visual, ...counts }) => counts);
    fs.mkdirSync(path.join(root, 'reports/local-shared-visits'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'reports/local-shared-visits/traffic.json'),
      JSON.stringify(summary, null, 2),
    );
    console.log('Shared visits acceptance passed. Separate → batched:', JSON.stringify(summary));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(path.join(root, 'reports', site), { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
