'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const families = [
  'modern-web',
  'modern-web-dialog-scroll',
  'modern-web-interactions',
  'modern-web-widgets',
  'modern-web-carousel',
  'modern-web-tooltips',
  'modern-web-presentation',
];
const css = fs.readFileSync(path.join(root, 'web/tailwind.css'));
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local storefront Modern Web entry fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tailwind.css"></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-3 p-4"><h1 class="text-2xl font-bold">Local store fixture</h1>
<form><label for="country">Country</label><select id="country" name="country" autocomplete="country" required aria-invalid="false"><option value="" disabled selected>Choose country</option><option value="bg">Bulgaria</option></select><p id="country-error" hidden>Choose a country.</p><div id="announcer" aria-live="polite"></div></form>
<form><label for="address">Address</label><input id="address" name="address1" autocomplete="shipping street-address"><label for="account">Account email</label><input id="account" type="email" autocomplete="username" spellcheck="false"><label for="password">New password</label><input id="password" type="password" autocomplete="new-password"></form>
<details><summary>Delivery details</summary><p>Local delivery information.</p></details><label><input type="checkbox" role="switch">Preview preference</label><label for="range">Preview quantity</label><input id="range" type="range" min="0" max="10" value="4"><section aria-roledescription="carousel" role="region" aria-label="Local gallery"><button type="button" aria-label="Previous slide">Previous</button><button type="button" aria-label="Next slide">Next</button><div role="group" aria-roledescription="slide" aria-label="1 of 2" id="slide-a">First view</div><div role="group" aria-roledescription="slide" aria-label="2 of 2" id="slide-b" hidden>Second view</div></section></main><script>
const slides=[document.getElementById('slide-a'),document.getElementById('slide-b')];document.querySelectorAll('[aria-label="Next slide"],[aria-label="Previous slide"]').forEach(button=>button.addEventListener('click',()=>{slides.forEach(slide=>slide.hidden=!slide.hidden);fetch('/probe-carousel',{method:'POST'}).catch(()=>{});}));
const select=document.getElementById('country'),error=document.getElementById('country-error');
const sync=()=>{const invalid=!select.validity.valid;select.setAttribute('aria-invalid',String(invalid));error.hidden=!invalid;if(invalid)select.setAttribute('aria-describedby','country-error');else select.removeAttribute('aria-describedby');};
select.addEventListener('invalid',sync);select.addEventListener('change',()=>{sync();fetch('/probe-save',{method:'POST',body:'synthetic-probe'}).catch(()=>{});fetch('/probe-get?change=1').catch(()=>{});});
</script></body></html>`;

function specs(suites) {
  return suites.flatMap(suite => [...(suite.specs || []), ...specs(suite.suites || [])]);
}
function attachmentJson(attachment) {
  assert.ok(attachment, 'Expected JSON attachment missing');
  return JSON.parse(
    attachment.path
      ? fs.readFileSync(attachment.path, 'utf8')
      : Buffer.from(attachment.body, 'base64').toString('utf8'),
  );
}
function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config=checks/modern-web-entry.config.ts',
      ],
      { cwd: root, stdio: 'inherit', env },
    );
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`Modern Web production entry exited ${code}`)),
    );
  });
}

async function main() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      document: request.headers['sec-fetch-dest'] === 'document',
    });
    if (request.url === '/tailwind.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(css);
    } else if (request.url.startsWith('/probe-')) {
      response.writeHead(204);
      response.end();
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(fixture);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const outputRoot = path.join(root, 'reports/local-modern-web-entry');
  fs.mkdirSync(outputRoot, { recursive: true });
  try {
    let total = 0;
    for (const platform of ['shopify', 'woocommerce']) {
      const reportFile = path.join(outputRoot, `${platform}.json`);
      const outputDir = path.join(outputRoot, platform);
      const settings = {
        platform,
        url: origin,
        locale: 'en-US',
        timezoneId: 'UTC',
        cookieConsent: { mode: 'none' },
        ...(platform === 'woocommerce'
          ? {
              commerce: {
                productUrls: ['/goods/product-a/', '/goods/product-b/'],
                routes: { catalog: '/catalog/', cart: '/basket/', checkout: '/pay/' },
              },
            }
          : {}),
      };
      const requestStart = requests.length;
      await run({
        ...process.env,
        CONTROL_EVENTS_FILE: '',
        PAGE_INVENTORY_FILE: '',
        STORE_URL: origin,
        STORE_PLATFORM: platform,
        SITE_SLUG: `modern-web-entry-${platform}-local`,
        SITE_SETTINGS_JSON: JSON.stringify(settings),
        PRODUCT_HANDLE: 'product-a',
        PRODUCT_HANDLE_2: 'product-b',
        SEARCH_TERM: 'local',
        TEST_DELAY_MS: '0',
        TEST_JITTER_MS: '0',
        REQUEST_DELAY_MS: '0',
        REQUEST_JITTER_MS: '0',
        MODERN_WEB_ENTRY_REPORT_FILE: reportFile,
        MODERN_WEB_ENTRY_OUTPUT_DIR: outputDir,
      });
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      assert.equal(report.stats.unexpected, 0);
      assert.equal(report.stats.skipped, 0);
      const tests = specs(report.suites).flatMap(spec => spec.tests);
      assert.equal(tests.length, 12, `${platform} must run six configured URLs in two projects`);
      const projectCounts = new Map();
      for (const test of tests) {
        projectCounts.set(test.projectName, (projectCounts.get(test.projectName) || 0) + 1);
        assert.equal(test.results.length, 1, 'No retries should hide fixture regressions');
        const result = test.results[0];
        assert.equal(result.status, 'passed');
        for (const family of families)
          for (const extension of ['json', 'txt'])
            assert.ok(
              result.attachments.some(item => item.name === `${family}.${extension}`),
              `Missing ${family}.${extension}`,
            );
        const passive = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web.json'),
        );
        assert.ok(passive.formPurposes);
        assert.ok(passive.resilience);
        assert.ok(passive.components);
        assert.ok(passive.documentPolicies);
        assert.equal(
          passive.findings.some(item => item.severity === 'error'),
          false,
        );
        const interactions = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-interactions.json'),
        );
        assert.equal(interactions.coverage.selects[0].status, 'observed');
        assert.ok(
          interactions.coverage.blockedRequests >= 2,
          'Select requests must be quarantined',
        );
        assert.equal(interactions.coverage.networkDependentStatesUnverified, true);
        const widgets = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-widgets.json'),
        );
        assert.equal(widgets.coverage.accordions.length, 1);
        assert.equal(widgets.coverage.switches.length, 1);
        assert.equal(widgets.coverage.sliders.length, 1);
        const carousel = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-carousel.json'),
        );
        assert.equal(carousel.coverage.observations.length, 1);
        assert.equal(carousel.coverage.observations[0].status, 'observed');
        assert.equal(carousel.coverage.observations[0].restoration.status, 'restored');
      }
      assert.equal(projectCounts.get('Desktop Chrome'), 6);
      assert.equal(projectCounts.get('Mobile Chrome'), 6);
      const platformRequests = requests.slice(requestStart);
      assert.equal(
        platformRequests.filter(item => item.document).length,
        12,
        'Each actual entry scenario must navigate exactly once',
      );
      const expectedPaths =
        platform === 'shopify'
          ? [
              '/',
              '/products/product-a',
              '/products/product-b',
              '/collections/all',
              '/search?q=local&type=product',
              '/cart',
            ]
          : [
              '/',
              '/goods/product-a/',
              '/goods/product-b/',
              '/catalog/',
              '/?s=local&post_type=product',
              '/basket/',
            ];
      const documentCounts = new Map();
      for (const request of platformRequests.filter(item => item.document))
        documentCounts.set(request.url, (documentCounts.get(request.url) || 0) + 1);
      assert.deepEqual(
        [...documentCounts.keys()].sort(),
        expectedPaths.sort(),
        'Every configured URL must be exercised',
      );
      assert.ok(
        [...documentCounts.values()].every(count => count === 2),
        'Every configured URL must be visited once per project',
      );

      assert.equal(
        platformRequests.filter(item => item.method !== 'GET').length,
        0,
        'Probe writes must never reach the fixture server',
      );
      assert.equal(
        platformRequests.filter(item => item.url.startsWith('/probe-')).length,
        0,
        'State-changing GETs must also remain quarantined',
      );
      total += tests.length;
    }
    console.log(
      `Modern Web production entry acceptance: ${total} scenarios passed across Shopify/WooCommerce and desktop/mobile Chromium; all ${families.length} evidence families attached, one visit per scenario, no probe traffic reached the server.`,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
