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
const switchingFixture = `<label for="entry-switch-before">Before command bar</label><input id="entry-switch-before"><div role="menubar" id="entry-switch-bar" aria-label="Local application commands" class="relative flex w-fit rounded border">${[0, 1].map(index => `<button type="button" id="entry-switch-${index}" role="menuitem" aria-haspopup="menu" aria-controls="entry-switch-menu-${index}" aria-expanded="false" tabindex="${index ? -1 : 0}" class="min-h-10 px-3 py-2 focus-visible:outline-2">${index ? 'View' : 'Tools'}</button><div id="entry-switch-menu-${index}" role="menu" aria-label="Local commands" hidden class="absolute left-0 top-full z-10 min-w-36 rounded border bg-white p-2"><button type="button" role="menuitem" tabindex="-1" class="min-h-10 px-3 py-2 focus-visible:outline-2">Local preview</button></div>`).join('')}</div><label for="entry-switch-after">After command bar</label><input id="entry-switch-after">`;
const compositeFixture = `<div role="toolbar" aria-label="Local toolbar" class="flex gap-2 rounded border p-2">${['First', 'Second', 'Third'].map((label, index) => `<button type="button" tabindex="${index ? -1 : 0}" class="min-h-10 rounded border px-3 focus-visible:outline-2">${label}</button>`).join('')}</div>${switchingFixture}`;
const switchingScript = `{
const bar=document.getElementById('entry-switch-bar'),buttons=[...bar.querySelectorAll(':scope > button')],menus=[...bar.querySelectorAll(':scope > [role="menu"]')];let current=-1,ignoreFocus=false;
const closeAll=()=>{menus.forEach((menu,index)=>{menu.hidden=true;buttons[index].setAttribute('aria-expanded','false');});current=-1;};
const show=index=>{closeAll();menus[index].hidden=false;buttons[index].setAttribute('aria-expanded','true');current=index;};
const preview=index=>{show(index);buttons.forEach((button,i)=>button.tabIndex=i===index?0:-1);buttons[index].focus();};
buttons.forEach((button,index)=>{button.addEventListener('focus',()=>{if(!ignoreFocus)show(index);});button.addEventListener('pointerenter',()=>{if(current>=0)preview(index);});button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();show(index);menus[index].querySelector('button').focus();}});menus[index].addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft'].includes(event.key)){event.preventDefault();event.stopPropagation();preview(1-index);}});});
bar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();const previous=current;closeAll();if(previous>=0){ignoreFocus=true;buttons[previous].focus();ignoreFocus=false;}}if(event.key==='Tab'){event.preventDefault();closeAll();document.getElementById(event.shiftKey?'entry-switch-before':'entry-switch-after').focus();}});
document.addEventListener('focusin',event=>{if(!bar.contains(event.target))closeAll();});
}`;
const compositeScript = `document.querySelectorAll('[role="toolbar"],[role="menubar"]').forEach(root=>{const items=[...root.querySelectorAll(':scope > button')];root.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft'].includes(event.key))return;event.preventDefault();const index=items.indexOf(document.activeElement),next=(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus();});});
const question=document.getElementById('entry-question'),answer=document.getElementById('entry-answer');question.addEventListener('click',()=>{answer.hidden=!answer.hidden;question.setAttribute('aria-expanded',String(!answer.hidden));fetch('/probe-accordion',{method:'POST'}).catch(()=>{});});`;
const menuNavigationFixture = `<button type="button" id="entry-menu-before" class="rounded border p-2 focus-visible:outline-2">Before menu</button><button type="button" id="entry-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="entry-menu" class="rounded border p-2 focus-visible:outline-2">Tools</button><div id="entry-menu" role="menu" aria-label="Tools" hidden class="space-y-2 rounded border p-2"><button type="button" role="menuitem" tabindex="-1" id="entry-menu-first">Preview</button><button type="button" role="menuitem" tabindex="-1" id="entry-submenu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="entry-submenu">More previews</button><div id="entry-submenu" role="menu" aria-label="More previews" hidden class="rounded border p-2"><button type="button" role="menuitem" tabindex="-1" id="entry-menu-leaf">Details</button></div></div><button type="button" id="entry-menu-after" class="rounded border p-2 focus-visible:outline-2">After menu</button>`;
const menuNavigationScript = `{
const trigger=document.getElementById('entry-menu-trigger'),menu=document.getElementById('entry-menu'),nested=document.getElementById('entry-submenu-trigger'),child=document.getElementById('entry-submenu');
const closeChild=()=>{child.hidden=true;nested.setAttribute('aria-expanded','false');};const closeRoot=()=>{closeChild();menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();menu.hidden=false;trigger.setAttribute('aria-expanded','true');document.getElementById('entry-menu-first').focus();}});
nested.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();child.hidden=false;nested.setAttribute('aria-expanded','true');document.getElementById('entry-menu-leaf').focus();}});
child.addEventListener('keydown',event=>{if(['Escape','ArrowLeft'].includes(event.key)){event.preventDefault();event.stopPropagation();closeChild();nested.focus();}});
menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeRoot();trigger.focus();}if(event.key==='Tab'){event.preventDefault();closeRoot();document.getElementById(event.shiftKey?'entry-menu-before':'entry-menu-after').focus();}});
}`;
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local storefront Modern Web entry fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tailwind.css"></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-3 p-4"><h1 class="text-2xl font-bold">Local store fixture</h1><div id="entry-table-scroll" role="region" tabindex="0" aria-label="Local comparison" class="w-[240px] overflow-x-auto border focus-visible:outline-2"><table class="w-[900px]"><caption>Comparison</caption><tr><th id="entry-header" headers="entry-header entry-header" scope="col">Item</th><td rowspan="2">Local option</td></tr><tr><td colspan="2">Local span</td></tr></table></div>
<form><label for="country">Country</label><select id="country" name="country" autocomplete="country" required aria-invalid="false"><option value="" disabled selected>Choose country</option><option value="bg">Bulgaria</option></select><p id="country-error" hidden>Choose a country.</p><div id="announcer" aria-live="polite"></div></form>
<form><label for="entry-message">Message</label><textarea id="entry-message" rows="2" class="block w-full overflow-auto rounded border p-2 leading-tight"></textarea><label for="entry-long-line">Long message</label><textarea id="entry-long-line" wrap="off" rows="2" class="block w-64 max-w-full overflow-auto rounded border p-2"></textarea><label for="entry-rtl-line">RTL message</label><textarea id="entry-rtl-line" wrap="off" dir="rtl" rows="2" class="block w-64 max-w-full overflow-auto rounded border p-2"></textarea><label for="entry-input-line">Line editing</label><input id="entry-input-line" type="text" name="local-line" class="block w-48 max-w-full rounded border p-2"><label for="address">Address</label><input id="address" required name="address1" autocomplete="shipping street-address"><label for="account">Account email</label><input id="account" type="email" autocomplete="username" spellcheck="false"><label for="password">New password</label><input id="password" type="password" autocomplete="new-password"></form>
<details><summary>Delivery details</summary><p>Local delivery information.</p></details><details name="entry-private-details" open><summary>First local disclosure</summary><p>First local content.</p></details><details name="entry-private-details"><summary>Second local disclosure</summary><p>Second local content.</p></details><label><input type="checkbox" role="switch">Preview preference</label><label for="range">Preview quantity</label><input id="range" type="range" min="0" max="10" value="4"><section aria-roledescription="carousel" role="region" aria-label="Local gallery"><button type="button" aria-label="Previous slide">Previous</button><button type="button" aria-label="Next slide">Next</button><div role="group" aria-roledescription="slide" aria-label="1 of 2" id="slide-a">First view</div><div role="group" aria-roledescription="slide" aria-label="2 of 2" id="slide-b" hidden>Second view</div></section>${compositeFixture}<section aria-label="Questions"><h2><button type="button" id="entry-question" aria-expanded="false" class="rounded border p-2 focus-visible:outline-2">Local question</button></h2><div id="entry-answer" hidden>Local answer</div></section>${menuNavigationFixture}<table class="w-full border-separate border-spacing-2"><caption>Local grid model</caption><colgroup span="3"></colgroup><tbody><tr><th colspan="2" scope="colgroup">Group</th></tr><tr><td rowspan="2">Local value</td></tr></tbody></table><table class="w-full border-separate border-spacing-2"><caption>Local scope anchor</caption><tbody><tr><th scope="colgroup">Local ungrouped header</th><td>Local value</td></tr></tbody></table><table class="w-full border-separate border-spacing-2"><caption>Local header scan</caption><tr><th scope="col">Item</th><th scope="col">Value</th></tr><tr><th scope="row">Sample</th><td>Local</td></tr></table><div class="flow-root h-8 overflow-hidden"><input type="text" readonly aria-label="Local partial clip" class="mt-4 block h-11 w-32"></div><div class="flow-root h-16 w-48 overflow-hidden"><button type="button" disabled class="mt-24 block h-11 w-24">Local clipped control</button></div></main><script>${compositeScript}${menuNavigationScript}${switchingScript}
document.getElementById('entry-table-scroll').onkeydown=event=>{if(['ArrowRight','ArrowLeft'].includes(event.key)){event.preventDefault();event.currentTarget.scrollLeft+=event.key==='ArrowRight'?40:-40;}};
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
        'Content-Security-Policy-Report-Only': 'report-to owned-private-group',
        'Reporting-Endpoints': 'unrelated="/owned-private-report?token=owned-report-secret"',
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
        assert.ok(
          passive.documentPolicies.policies.some(
            policy =>
              policy.disposition === 'report' &&
              policy.reporting?.endpointNameObserved === false &&
              policy.reporting.deliveryVerified === false,
          ),
          'Production evidence must retain reporting configuration gaps without claiming delivery',
        );
        // Source: https://html.spec.whatwg.org/multipage/tables.html#attr-tdth-headers
        // The actual Full entry must serialize the advisory graph/token findings;
        // these warnings must not become blocking Modern Web failures.
        assert.ok(passive.findings.some(item => item.rule === 'table-header-cycle'));
        assert.ok(passive.findings.some(item => item.rule === 'table-header-reference-duplicate'));
        assert.equal(passive.dataWidgets.observations.tables[0].cyclicRenderedHeaders, 1);
        assert.equal(passive.dataWidgets.observations.tables[0].duplicateReferenceTokens, 1);
        // Source: HTML row processing. Verify a real structural advisory without
        // turning it into a CSS overlap or inferred-header claim.
        // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-processing-rows
        assert.ok(passive.findings.some(item => item.rule === 'table-span-overlap'));
        assert.equal(passive.dataWidgets.observations.tables[0].spanOccupancy.status, 'observed');
        assert.equal(passive.dataWidgets.observations.tables[0].spanOccupancy.overlapPlacements, 1);
        assert.equal(passive.dataWidgets.observations.tables[0].spanOccupancy.renderedOverlapVerified, false);
        // Sources: complete-grid requirement and forming-a-table step 20.
        // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
        // Empty positions and absent anchors remain separate numeric advisories.
        assert.ok(passive.findings.some(item => item.rule === 'table-grid-gap'));
        assert.ok(passive.findings.some(item => item.rule === 'table-grid-anchors'));
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage.status, 'observed');
        // Step 9: colgroup establishes width 3 even though row cells reach only 2.
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage.declaredColumns, 3);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage.uncoveredSlots, 5);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage.columnsWithoutAnchors, 2);
        // Ending the row group adds one logical row; DOM tr count stays two.
        // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.checkedRows, 2);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.modeledRows, 3);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.impliedRows, 1);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage.rowsWithoutAnchors, 1);

        // Scope's colgroup keyword requires a real anchor group. Colspan alone
        // is insufficient; verify the advisory and separate candidate counters.
        // https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope
        assert.ok(passive.findings.some(item => item.rule === 'table-header-colgroup-anchor'));
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.groupScopes.columnGroupCandidatePairs, 1);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.groupScopes.unanchoredColumnGroupHeaders, 0);
        assert.equal(passive.dataWidgets.observations.tables[2].spanOccupancy.groupScopes.unanchoredColumnGroupHeaders, 1);
        assert.equal(passive.dataWidgets.observations.tables[2].spanOccupancy.groupScopes.completeHeaderAssociationsVerified, false);
        // Source: native west/north scanning; row header itself also receives
        // its column header. Three unique pairs are distinct from group pairs.
        // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
        const headerScan = passive.dataWidgets.observations.tables[3].spanOccupancy.headerScan;
        assert.equal(headerScan.status, 'observed');
        assert.equal(headerScan.rowScanPairs, 1);
        assert.equal(headerScan.columnScanPairs, 2);
        assert.equal(headerScan.scannedPairs, 3);
        assert.equal(headerScan.automaticDataCells, 1);
        assert.equal(headerScan.dataCellsWithScannedHeaders, 1);
        assert.equal(headerScan.completeHeaderAssociationsVerified, false);
        // Final bounded assignment unions directional/group sets, but explicit
        // headers overrides automatic selection. AX/speech remain unverified.
        const assignments = passive.dataWidgets.observations.tables[3].spanOccupancy.headerAssignments;
        assert.equal(assignments.status, 'observed');
        assert.equal(assignments.assignedPairs, 3);
        assert.equal(assignments.structuralAssignmentSubsetVerified, true);
        assert.equal(assignments.accessibilityTreeVerified, false);
        assert.equal(passive.dataWidgets.observations.tables[1].spanOccupancy.headerAssignments.assignedPairs, 1);

        assert.ok(passive.findings.some(item => item.rule === 'policy-csp-reporting-endpoint'));
        assert.doesNotMatch(
          JSON.stringify(passive),
          /owned-private-group|owned-private-report|owned-report-secret/,
        );
        assert.equal(
          passive.findings.some(item => item.severity === 'error'),
          false,
        );
        // Source: form-factor-adaptation forbids parent overflow clipping.
        // Require advisory geometry in real Full output without changing verdicts.
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
        const presentation = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-presentation.json'),
        );
        assert.ok(presentation.findings.some(item => item.rule === 'presentation-control-ancestor-clip'));
        assert.ok(presentation.findings.some(item => item.rule === 'presentation-control-partial-ancestor-clip'));
        assert.ok(presentation.coverage.states.some(state => state.fieldSizing?.some(field => field.kind === 'select')));
        assert.ok(presentation.coverage.states.some(state => state.fieldSizing?.some(field => field.kind === 'input')));

        assert.ok(presentation.coverage.states.some(state => state.partialControlAndGlyphClippingVerified === false));
        const interactions = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-interactions.json'),
        );
        // Source: forms guide, input/blur validation. Exercise the real Full entry
        // and require retained-node cleanup evidence, not just a unit fixture.
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
        assert.equal(interactions.coverage.fieldContent.observations[0].status, 'observed');
        assert.equal(interactions.coverage.fieldContent.observations[0].caretAtEnd, true);
        assert.equal(interactions.coverage.fieldContent.observations[0].tailInScrollport, true);
        assert.equal(interactions.coverage.fieldContent.observations[0].restoration.status, 'restored');
        // Source: field-sizing fallback + forms keyboard guidance (see probe).
        // Require the horizontal native editing path in actual Full evidence.
        assert.equal(interactions.coverage.horizontalFieldContent.observations[0].status, 'observed');
        assert.equal(interactions.coverage.horizontalFieldContent.observations[0].caretAtEnd, true);
        assert.equal(interactions.coverage.horizontalFieldContent.observations[0].tailInScrollport, true);
        assert.equal(interactions.coverage.horizontalFieldContent.observations[0].overflow, true);
        assert.equal(interactions.coverage.horizontalFieldContent.observations[0].restoration.status, 'restored');
        // Source: forms keyboard testing + fixed/internal-scroll field fallback.
        // RTL uses the native negative scrollLeft direction. Bidi verifies the
        // bounded end only; visual/grapheme/IME order is explicitly unverified.
        const rtl = interactions.coverage.rtlFieldContent.observations.find(item => item.status === 'observed');
        assert.equal(rtl.caretAtEnd, true);
        assert.equal(rtl.tailInScrollport, true);
        assert.equal(rtl.restoration.status, 'restored');
        assert.equal(interactions.coverage.bidiFieldContent.observations[0].caretAtEnd, true);
        assert.equal(interactions.coverage.bidiFieldContent.observations[0].tailInScrollport, true);
        assert.equal(interactions.coverage.bidiFieldContent.observations[0].restoration.status, 'restored');
        assert.equal(interactions.coverage.inputFieldContent.observations[0].caretAtEnd, true);
        assert.equal(interactions.coverage.inputFieldContent.observations[0].restoration.status, 'restored');
        assert.equal(interactions.coverage.inputFieldContent.mutationLimit, 1);

        assert.equal(interactions.coverage.fields[0].status, 'observed');
        assert.equal(interactions.coverage.fields[0].restoration.status, 'restored');
        assert.equal(interactions.coverage.selects[0].status, 'observed');
        // Retained option identity/order and the expected selection gate cleanup.
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/select-menu-interaction.md
        assert.equal(interactions.coverage.selects[0].restoration.status, 'restored');
        // Source: checkbox guide; require real two-Space reversal, not a property
        // cleanup that could otherwise conceal a broken keyboard interaction.
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/checkbox.md
        assert.equal(interactions.coverage.checkboxes[0].status, 'observed');
        assert.equal(interactions.coverage.checkboxes[0].keysSent, 2);
        assert.equal(interactions.coverage.checkboxes[0].before.checked, 'false');
        assert.equal(interactions.coverage.checkboxes[0].toggled.checked, 'true');
        assert.equal(interactions.coverage.checkboxes[0].restored.checked, 'false');
        assert.equal(interactions.coverage.checkboxes[0].restoration.method, 'keyboard');
        assert.equal(interactions.coverage.selectOptionOwnershipLimit, 512);
        assert.ok(
          interactions.coverage.blockedRequests >= 2,
          'Select requests must be quarantined',
        );
        assert.equal(interactions.coverage.networkDependentStatesUnverified, true);
        const widgets = attachmentJson(
          result.attachments.find(item => item.name === 'modern-web-widgets.json'),
        );
        assert.ok(
          widgets.coverage.tableScroll.observations.some(
            item =>
              item.status === 'observed' &&
              item.scrollRestoration.status === 'restored' &&
              item.scrollRestoration.applicationResetVerified === false &&
              item.samples.some(sample => sample.canMove && sample.moved),
          ),
          'Actual Full entry must retain table keyboard movement evidence',
        );
        assert.equal(widgets.coverage.tableScroll.retainedContextRequired, true);
        assert.equal(widgets.coverage.tableScroll.applicationResetVerified, false);
        // https://drafts.csswg.org/cssom-view/#scrolling-events
        // Native scroll-handler work is sampled before restoration succeeds;
        // the serialized DOM/focus result does not certify application reset.
        assert.equal(widgets.coverage.tableScroll.focusRestoration.status, 'restored');
        assert.equal(widgets.coverage.accordions.length, 3);
        // https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element
        // Native keyboard reversal must be distinct from conditional group DOM
        // cleanup; the retained context is a local probe safety requirement.
        assert.equal(widgets.coverage.accordions[0].status, 'observed');
        assert.equal(widgets.coverage.accordions[0].initial.open, false);
        assert.equal(widgets.coverage.accordions[0].toggled, true);
        assert.equal(widgets.coverage.accordions[0].restored, false);
        assert.equal(widgets.coverage.accordions[0].keysSent, 2);
        assert.equal(widgets.coverage.accordions[0].restoration.status, 'restored');
        assert.equal(widgets.coverage.accordions[0].restoration.method, 'keyboard');
        assert.equal(widgets.coverage.detailsOwnership.applicationResetVerified, false);
        assert.ok(widgets.coverage.accordions.some(item =>
          item.status === 'observed' && item.initial.grouped && !item.initial.open &&
          item.keysSent === 2 && item.restoration.status === 'restored' &&
          item.restoration.method === 'native-group' && item.restoration.cleanupWrites > 0),
        'Owned Chromium Full fixture must serialize conditional exclusive-group restoration');
        assert.equal(widgets.coverage.composites.menubars[0].status, 'observed');
        assert.equal(widgets.coverage.composites.toolbars[0].status, 'observed');
        assert.equal(widgets.coverage.composites.commandActivationAttempted, false);
        const nestedMenu = widgets.coverage.menuNavigation.observations.find(
          observation => observation.initial?.selector === '#entry-menu-trigger',
        );
        assert.ok(nestedMenu, 'The standalone nested-menu contract must be observed');
        assert.equal(nestedMenu.status, 'observed');
        assert.equal(nestedMenu.submenus.length, 2);
        assert.equal(nestedMenu.tabExit.steps.length, 2);
        assert.equal(widgets.coverage.menuNavigation.commandActivationAttempted, false);
        assert.equal(widgets.coverage.menubarSwitching.observations[0].keyboard.status, 'observed');
        assert.equal(widgets.coverage.menubarSwitching.observations[0].restoration.closed, true);
        assert.equal(widgets.coverage.menubarSwitching.commandActivationAttempted, false);
        assert.equal(widgets.coverage.menubarSwitching.pointerClicksAttempted, false);
        assert.equal(
          widgets.coverage.menubarSwitching.observations[0].pointer.status,
          widgets.coverage.menubarSwitching.hoverSupported ? 'observed' : 'not-probed',
        );
        assert.equal(widgets.coverage.composites.toolbars[0].tabTraversal.status, 'observed');
        assert.equal(widgets.coverage.customAccordions.observations[0].status, 'unverified');
        assert.equal(
          widgets.coverage.customAccordions.observations[0].reason,
          'dependent-work-blocked',
        );
        assert.ok(widgets.coverage.customAccordions.activationAttempts >= 2);
        assert.equal(widgets.coverage.customAccordionActionsAttempted, true);
        assert.deepEqual(widgets.coverage.continuation, {
          status: 'stopped',
          stoppedAfter: 'customAccordions',
          skippedStages: [],
          applicationResetVerified: false,
        });
        assert.equal(widgets.coverage.widgetDependenciesObserved, true);
        assert.equal(widgets.coverage.switches.length, 1);
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/switch.md
        // Read native checked state; DOM fallback cleanup must not conceal a
        // failed Space reversal in actual Full evidence. No persistence claim.
        assert.equal(widgets.coverage.switches[0].status, 'observed');
        assert.equal(widgets.coverage.switches[0].before.checked, 'false');
        assert.equal(widgets.coverage.switches[0].toggled.checked, 'true');
        assert.equal(widgets.coverage.switches[0].restored.checked, 'false');
        assert.equal(widgets.coverage.switches[0].keysSent, 2);
        assert.equal(widgets.coverage.switches[0].restoration.status, 'restored');
        assert.equal(widgets.coverage.switches[0].restoration.method, 'keyboard');
        assert.equal(widgets.coverage.switches[0].restoration.applicationResetVerified, false);
        assert.equal(widgets.coverage.switchOwnership.retainedContextRequired, true);
        assert.equal(widgets.coverage.switchOwnership.keyLimit, 2);
        assert.equal(widgets.coverage.sliders.length, 1);
        assert.equal(widgets.coverage.sliders[0].status, 'observed');
        assert.equal(widgets.coverage.sliders[0].changed.value, 5);
        assert.equal(widgets.coverage.sliders[0].restored.value, 4);
        assert.equal(widgets.coverage.sliders[0].cleanup.status, 'restored');
        assert.equal(widgets.coverage.sliders[0].cleanup.applicationResetVerified, false);
        assert.equal(widgets.coverage.sliders[0].keysSent, 1);
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
