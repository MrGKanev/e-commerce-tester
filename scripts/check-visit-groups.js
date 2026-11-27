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
const steps = list => list.flatMap(step => [step, ...steps(step.steps || [])]);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'visit-groups-'));
  const css = fs.readFileSync(path.join(root, 'web/tailwind.css'));
  let stats,
    negative = false;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const document = request.headers['sec-fetch-dest'] === 'document';
    const missing = /does-not-exist|no-such|this-product/.test(pathname);
    const send = (status, type, body) => {
      stats.requests++;
      stats.bytes += Buffer.byteLength(body);
      if (document) stats.documents++;
      if ((request.headers['user-agent'] || '').includes('security-check/1.0'))
        stats.headerFetches++;
      stats.paths[pathname] = (stats.paths[pathname] || 0) + 1;
      response.writeHead(status, {
        'content-type': type,
        'strict-transport-security': 'max-age=31536000',
        ...(negative ? {} : { 'x-content-type-options': 'nosniff' }),
        'x-frame-options': 'DENY',
      });
      response.end(body);
    };
    if (pathname === '/fixture.css') return send(200, 'text/css', css);
    if (pathname === '/image.png') return send(200, 'image/png', png);
    if (pathname === '/bad-image.png') return send(404, 'text/plain', 'Owned broken image');
    if (pathname === '/bad.js') return send(404, 'text/javascript', '');
    if (pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    if (pathname === '/fixture.js') return send(200, 'text/javascript', '');
    const badProduct = negative && pathname.endsWith('/product-a');
    const image = negative ? '/bad-image.png' : '/image.png';
    const price = badProduct ? '' : '<span class="price">12 EUR</span>';
    const button = badProduct
      ? ''
      : '<button name="add" type="button" class="min-h-11 px-3">Add to cart</button>';
    const form = negative
      ? ''
      : '<form id="contact_form" action="/contact"><label for="email">Email</label><input id="email" type="email" name="email"><button type="submit">Send message</button></form>';
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${missing ? '404 — Page not found' : 'Owned store'}</title><meta name="description" content="Owned fixture"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="canonical" href="http://127.0.0.1:${server.address().port}${request.url}"><link rel="stylesheet" href="/fixture.css"><script src="/${negative ? 'bad' : 'fixture'}.js" defer></script><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Owned product"}</script></head><body class="bg-white p-4 font-sans text-slate-900"><header><a href="/">Store home</a><a href="/collections/all">Store collection</a></header><main class="${negative && pathname === '/pages/contact' ? 'w-[2000px]' : ''}"><h1>${missing ? '404 Page not found' : 'Owned product'}</h1><p>Welcome to the owned local fixture store. This page has enough human-readable content for all content checks.</p><section class="product-card product__media"><a href="/products/product-a">Owned product</a>${price}<img src="${image}" ${negative ? '' : 'alt="Owned product"'} srcset="${image} 1x" width="200" height="200" class="h-48 w-48 max-w-full">${button}</section>${pathname === '/pages/contact' ? form : ''}${missing && negative ? '<p>Exception at /var/www/owned.php</p>' : ''}</main><footer><a href="/policies/privacy-policy">Privacy policy</a><p>Owned store copyright</p></footer></body></html>`;
    send(missing ? 404 : 200, 'text/html; charset=utf-8', body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const inventory = ['product-a', 'product-b', 'extra'].map(handle => ({
    type: 'product',
    handle,
    url: origin + '/products/' + handle,
    language: 'en-US',
  }));
  inventory.unshift({ type: 'home', url: origin + '/', language: 'en-US' });
  inventory.push(
    { type: 'collection', url: origin + '/collections/all', language: 'en-US' },
    { type: 'search', url: origin + '/search?q=local&type=product', language: 'en-US' },
    { type: 'cart', url: origin + '/cart', language: 'en-US' },
  );
  const inventoryFile = path.join(temporary, 'inventory.json');
  fs.writeFileSync(inventoryFile, JSON.stringify({ pages: inventory }));
  const results = [];
  try {
    const runs = process.env.VISIT_GROUPS_BEFORE_ROOT
      ? ['before', 'after', 'negative']
      : ['after', 'negative'];
    for (const run of runs) {
      stats = { documents: 0, requests: 0, bytes: 0, headerFetches: 0, paths: {} };
      negative = run === 'negative';
      const directory = path.join(root, 'reports/local-visit-groups', run);
      fs.mkdirSync(directory, { recursive: true });
      const env = {
        ...process.env,
        STORE_URL: origin,
        STORE_PLATFORM: 'shopify',
        SITE_SLUG: 'visit-groups-local',
        SITE_SETTINGS_JSON: JSON.stringify({
          platform: 'shopify',
          locale: 'en-US',
          cookieConsent: { mode: 'none' },
          performanceMetrics: { enabled: false },
        }),
        PRODUCT_HANDLE: 'product-a',
        PRODUCT_HANDLE_2: 'product-b',
        SEARCH_TERM: 'local',
        PAGE_INVENTORY_FILE: inventoryFile,
        SHARED_INVENTORY_RUN: '0',
        VISIT_GROUPS_DIRECTORY: directory,
        VISIT_GROUPS_NEGATIVE: negative ? '1' : '0',
        VISIT_GROUPS_TEST_ROOT: run === 'before' ? process.env.VISIT_GROUPS_BEFORE_ROOT : root,
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
            '--config=checks/visit-groups.config.ts',
            '--project=Desktop Chrome',
            '--project=Mobile Chrome',
            ...(negative
              ? [
                  '--grep',
                  'shared media checks|shared document checks|shared response checks|crawled products — shared|collection — shared passive|Contact — shared page|homepage — shared axe',
                ]
              : []),
          ],
          { cwd: root, env, stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 0, `${run} execution failed`);
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'results.json')));
      assert.deepEqual(report.errors, []);
      const cases = specs(report.suites).flatMap(spec =>
        spec.tests.map(test => ({ title: spec.title, ...test })),
      );
      assert.ok(cases.length > 0);
      assert.ok(cases.every(test => test.status !== 'unexpected'));
      if (run === 'after') {
        assert.equal(stats.headerFetches, 2);
        assert.equal(stats.documents, 50, 'Each passive group must retain its shared visit budget');
        if (results.length) assert.ok(stats.documents < results[0].documents);
      }
      if (negative) {
        const expected = cases.filter(test => test.expectedStatus === 'failed');
        assert.equal(expected.length, 20, 'Every intended negative group must execute');
        for (const test of expected) {
          const nested = steps(test.results.flatMap(result => result.steps || []));
          if (test.title.includes('shared media checks')) {
            assert.ok(nested.find(step => step.title.endsWith('— no broken images'))?.error);
            assert.ok(
              nested.find(step => step.title.endsWith('— no failed CSS or JS assets'))?.error,
            );
          }
          if (test.title.includes('crawled products — shared')) {
            const atc = nested.filter(
              step =>
                step.title === 'all in-stock crawled products have an enabled add-to-cart button',
            );
            assert.equal(atc.length, 3);
            assert.ok(
              atc.some(step => step.error),
              'Missing add-to-cart controls cannot pass silently',
            );
            assert.equal(
              nested.filter(step => step.title === 'all crawled products have no broken hero image')
                .length,
              3,
            );
          }
          if (test.title === 'Contact — shared page checks') {
            assert.ok(
              nested.find(step => step.title === 'Contact page has no horizontal overflow')?.error,
            );
            assert.ok(
              nested.some(
                step => step.title === 'contact form is present on contact page (if found)',
              ),
            );
          }

          assert.ok(
            nested.some(step => step.error),
            test.title + ' must retain a failed step',
          );
          assert.ok(nested.length > 1, test.title + ' must retain multiple independent results');
        }
      }
      results.push({ run, ...stats });
      fs.writeFileSync(
        path.join(root, 'reports/local-visit-groups/traffic.json'),
        JSON.stringify(results, null, 2),
      );
    }
    if (process.env.VISIT_GROUPS_BEFORE_ROOT)
      fs.writeFileSync(
        path.join(root, 'reports/local-visit-groups/comparison.json'),
        JSON.stringify(
          results.map(({ paths: _paths, ...row }) => row),
          null,
          2,
        ),
      );
    console.log(
      'Grouped visits acceptance passed:',
      JSON.stringify(results.map(({ paths: _paths, ...row }) => row)),
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
