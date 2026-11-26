import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectTableScroll } from '../tests/modern-web-table-scroll';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const region =
  '<div id="scroll-region" role="region" tabindex="0" aria-label="Private table label" class="w-[240px] overflow-x-auto border focus-visible:outline-2"><table class="w-[900px]"><caption>Private table content</caption><tr><th scope="col">Column</th><td>Private cell value</td></tr></table></div>';
async function fixture(page: import('@playwright/test').Page, markup = region, script = '') {
  const guard = await prepareInteractionProbe(page);
  await page.route('**/*', route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table scrolling fixture</title><style>${css}</style></head><body><main class="p-4"><h1>Table scrolling</h1><input id="outside" aria-label="Outside">${markup}</main><script>${script}</script></body></html>`,
    });
  });
  await page.goto('http://127.0.0.1:45996/table-scroll');
  await page.locator('#outside').focus();
  await guard.freeze();
  return guard;
}

test('table keyboard probe refuses an unquarantined document', async ({ page }) => {
  await page.goto('about:blank');
  await expect(inspectTableScroll(page)).rejects.toThrow('freeze()');
});

for (const rtl of [false, true])
  test(`native table region keyboard movement and restoration, RTL ${rtl}`, async ({
    page,
  }, info) => {
    await fixture(page, rtl ? region.replace('role="region"', 'dir="rtl" role="region"') : region);
    if (!rtl && ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name))
      await page.screenshot({
        path: '/tmp/modern-table-' + info.project.name.replace(' ', '-') + '.png',
      });
    const report = await inspectTableScroll(page);
    expect(report.observations, JSON.stringify(report)).toHaveLength(1);
    expect(report.observations[0], JSON.stringify(report)).toMatchObject({
      samples: expect.arrayContaining([expect.objectContaining({ canMove: true })]),
    });
    const observation = report.observations[0] as {
      status: string;
      samples: Array<{ canMove: boolean; moved: boolean }>;
    };
    expect(observation.status).toBe(
      observation.samples.some(s => s.canMove && !s.moved) ? 'unverified' : 'observed',
    );
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      scrollRestoration: { status: 'restored', applicationResetVerified: false },
    });
    expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(0);
    await expect(page.locator('#outside')).toBeFocused();
    expect(JSON.stringify(report)).not.toMatch(/Private|scroll-region/);
  });

test('blocked arrow behavior produces only an advisory', async ({ page }) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").addEventListener("keydown",e=>e.preventDefault());',
  );
  const report = await inspectTableScroll(page);
  expect(report.observations[0]).toMatchObject({ status: 'observed' });
  expect(report.findings.map(f => [f.rule, f.severity])).toEqual([
    ['table-scroll-keyboard', 'warning'],
  ]);
});

for (const variant of [
  'hidden',
  'inert',
  'negative-tabindex',
  'no-overflow',
  'no-table',
  'grid',
  'editable',
  'modal',
] as const)
  test(`table scrolling excludes unsafe or inapplicable scope: ${variant}`, async ({ page }) => {
    const markup =
      variant === 'hidden'
        ? `<section class="[content-visibility:hidden]">${region}</section>`
        : variant === 'inert'
          ? `<section inert>${region}</section>`
          : variant === 'negative-tabindex'
            ? region.replace('tabindex="0"', 'tabindex="-1"')
            : variant === 'no-overflow'
              ? region.replace('w-[900px]', 'w-[100px]')
              : variant === 'no-table'
                ? region.replaceAll('table', 'aside')
                : variant === 'grid'
                  ? region.replace('<table ', '<table role="grid" ')
                  : variant === 'editable'
                    ? region.replace('role="region"', 'contenteditable="true" role="region"')
                    : region + '<dialog open>Open modal context</dialog>';
    await fixture(page, markup);
    const report = await inspectTableScroll(page);
    expect(report.observations).toEqual([]);
    expect(report.findings).toEqual([]);
  });

test('dependent requests are quarantined and cannot generate a failed scroll verdict', async ({
  page,
}) => {
  const guard = await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();fetch("/private-update",{method:"POST"}).catch(()=>{});};',
  );
  const report = await inspectTableScroll(page);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

test('rerendered table and focus theft invalidate the retained sample', async ({ page }) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();document.getElementById("outside").focus();document.querySelector("table").replaceWith(document.createElement("table"));};',
  );
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

// A scripted but equivalent scroll contract calibrates all engines independently
// of their headless/native key-scroll policy; no API implementation is mandated.
test('authored keyboard scroll movement is accepted and exact offset is restored', async ({
  page,
}) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();e.currentTarget.scrollLeft += e.key==="ArrowRight" ? 40 : -40;};',
  );
  await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'observed',
    samples: expect.arrayContaining([expect.objectContaining({ canMove: true, moved: true })]),
  });
  expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(120);
});

test('focus-triggered requests invalidate evidence before any key is sent', async ({ page }) => {
  const guard = await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onfocus=()=>fetch("/private-focus",{method:"POST"}).catch(()=>{});',
  );
  const report = await inspectTableScroll(page);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

test('body focus restores without leaving the table as an artificial tab owner', async ({
  page,
}) => {
  await fixture(page, region);
  await page.locator('#outside').evaluate(el => el.blur());
  const report = await inspectTableScroll(page);
  expect(report.observations).toHaveLength(1);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('table keyboard sampling is bounded to five candidate regions', async ({ page }) => {
  const markup = Array.from({ length: 6 }, (_, i) =>
    region.replace('id="scroll-region"', `id="region-${i}"`),
  ).join('');
  const guard = await fixture(
    page,
    markup,
    'document.getElementById("region-5").onfocus=()=>fetch("/sixth-region").catch(()=>{});',
  );
  const report = await inspectTableScroll(page);
  expect(report.observations).toHaveLength(5);
  expect(report.perPageLimit).toBe(5);
  expect(guard.counts().blockedRequests).toBe(0);
});

// Ownership is local safety policy: a retained node alone is insufficient if
// authored focus/arrow handlers repurpose its context. Never emit a store warning
// or overwrite that changed context during cleanup.
// Source: accessibility, "Manage focus correctly to and from updated content".
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
const ownerChanges = {
  parent: 'document.getElementById("destination").append(r);r.focus({preventScroll:true});',
  'table-parent':
    'const wrapper=document.createElement("div");r.append(wrapper);wrapper.append(r.querySelector("table"));',
  role: 'r.setAttribute("role","group");',
  tabindex: 'r.setAttribute("tabindex","1");',
  label: 'r.setAttribute("aria-label","Private changed purpose");',
  labelledby: 'r.setAttribute("aria-labelledby","destination-title");',
  direction: 'r.setAttribute("dir","rtl");',
  'table-role': 'r.querySelector("table").setAttribute("role","table");',
  width: 'r.className=r.className.replace("w-[240px]","w-[200px]");',
  focus: 'document.getElementById("outside").focus({preventScroll:true});',
};
for (const stage of ['focus', 'key'] as const)
  for (const [change, mutate] of Object.entries(ownerChanges))
    test(`table scroll ownership: ${stage} ${change}`, async ({ page }) => {
      await fixture(
        page,
        region + '<section id="destination"><h2 id="destination-title">Destination</h2></section>',
        `
        const r=document.getElementById("scroll-region");
        window.keys=0;let changed=false;
        r.addEventListener("keydown",e=>{window.keys++;e.preventDefault();});
        r.addEventListener(${JSON.stringify(stage === 'focus' ? 'focus' : 'keydown')},e=>{
          if(changed)return;changed=true;
          ${mutate}
          r.scrollLeft=160;
          window.authoredOffset=r.scrollLeft;
          window.authoredFocus=document.activeElement;
        });
      `,
      );
      await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
      const report = await inspectTableScroll(page);
      expect(report.findings).toEqual([]);
      expect(report.observations).toHaveLength(1);
      expect(report.observations[0]).toMatchObject({
        status: 'unverified',
        scrollRestoration: { status: 'not-restored', applicationResetVerified: false },
      });
      expect(
        await page.evaluate(() => {
          const state = window as unknown as {
            keys: number;
            authoredOffset: number;
            authoredFocus: Element;
          };
          return {
            keys: state.keys,
            offsetPreserved:
              document.getElementById('scroll-region')!.scrollLeft === state.authoredOffset,
            focusPreserved: document.activeElement === state.authoredFocus,
          };
        }),
      ).toEqual({ keys: stage === 'focus' ? 0 : 1, offsetPreserved: true, focusPreserved: true });
      expect(JSON.stringify(report)).not.toMatch(
        /Private|Destination|scroll-region|destination-title/,
      );
    });

for (const stage of ['focus', 'key'] as const)
  test(`table scroll preserves authored document scrolling on ${stage}`, async ({ page }) => {
    await fixture(
      page,
      region + '<div class="min-h-[2000px]"></div>',
      `
      const r=document.getElementById("scroll-region");
      r.addEventListener("keydown",e=>{e.preventDefault();r.scrollLeft+=e.key==="ArrowRight"?40:-40;${stage === 'key' ? 'window.scrollTo({top:160,behavior:"instant"});' : ''}});
      ${stage === 'focus' ? 'r.addEventListener("focus",()=>window.scrollTo({top:160,behavior:"instant"}));' : ''}
    `,
    );
    await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
    const report = await inspectTableScroll(page);
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      status: 'observed',
      scrollRestoration: { status: 'restored' },
    });
    expect(await page.evaluate(() => scrollY)).toBe(160);
    expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(120);
    await expect(page.locator('#outside')).toBeFocused();
  });

test('table scroll discards provisional warning when cleanup changes context', async ({ page }) => {
  await fixture(
    page,
    region,
    `
    const r=document.getElementById("scroll-region");
    r.addEventListener("keydown",e=>e.preventDefault());
    const original=r.scrollTo.bind(r);let calls=0;
    r.scrollTo=(options)=>{original(options);if(++calls===3)r.setAttribute("aria-label","Private cleanup purpose");};
  `,
  );
  await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'unverified',
    scrollRestoration: { status: 'not-restored' },
  });
  await expect(page.locator('#scroll-region')).toBeFocused();
  await expect(page.locator('#scroll-region')).toHaveAttribute(
    'aria-label',
    'Private cleanup purpose',
  );
});

for (const change of ['move', 'remove', 'hide', 'disable'] as const)
  test(`table scroll does not refocus a changed original target: ${change}`, async ({ page }) => {
    await fixture(
      page,
      region + '<section id="destination"></section>',
      `
      const r=document.getElementById("scroll-region");let changed=false;
      r.addEventListener("keydown",e=>{
        e.preventDefault();r.scrollLeft+=e.key==="ArrowRight"?40:-40;
        if(changed)return;changed=true;
        const target=document.getElementById("outside");
        ${change === 'move' ? 'document.getElementById("destination").append(target);' : change === 'remove' ? 'target.remove();' : change === 'hide' ? 'target.hidden=true;' : 'target.disabled=true;'}
      });
    `,
    );
    const report = await inspectTableScroll(page);
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      status: 'observed',
      scrollRestoration: { status: 'restored' },
    });
    expect(report.focusRestoration).toEqual({
      status: 'not-restored',
      applicationResetVerified: false,
    });
    await expect(page.locator('#scroll-region')).toBeFocused();
  });

for (const stage of ['focus', 'key'] as const)
  test(`table scroll stops after lost context on ${stage}`, async ({ page }) => {
    await fixture(
      page,
      region + region.replace('id="scroll-region"', 'id="later-region"'),
      `
      window.laterFocus=0;
      document.getElementById("later-region").addEventListener("focus",()=>window.laterFocus++);
      document.getElementById("scroll-region").addEventListener(${JSON.stringify(stage === 'focus' ? 'focus' : 'keydown')},e=>{
        e.preventDefault();document.getElementById("outside").focus({preventScroll:true});
      });
    `,
    );
    const report = await inspectTableScroll(page);
    expect(report.findings).toEqual([]);
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0]).toMatchObject({
      status: 'unverified',
      scrollRestoration: { status: 'not-restored' },
    });
    expect(
      await page.evaluate(() => (window as unknown as { laterFocus: number }).laterFocus),
    ).toBe(0);
    await expect(page.locator('#outside')).toBeFocused();
  });

test('table scroll discards provisional warning when cleanup changes width', async ({ page }) => {
  await fixture(
    page,
    region,
    `
    const r=document.getElementById("scroll-region");
    r.addEventListener("keydown",e=>e.preventDefault());
    const original=r.scrollTo.bind(r);let calls=0;
    r.scrollTo=(options)=>{original(options);if(++calls===3)r.className=r.className.replace("w-[240px]","w-[200px]");};
  `,
  );
  await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'unverified',
    scrollRestoration: { status: 'not-restored' },
  });
  await expect(page.locator('#scroll-region')).toBeFocused();
  expect(await page.locator('#scroll-region').evaluate(el => el.clientWidth)).toBe(198);
});

// Native scroll events are delivered during rendering; direct scrollTo overrides
// do not exercise that queue. Cover handlers and the work they immediately queue.
// https://drafts.csswg.org/cssom-view/#scrolling-events
for (const scheduling of ['sync', 'microtask', 'animation-frame'] as const)
  for (const change of [
    'none',
    'offset',
    'context',
    'focus',
    'original-target',
    'document-scroll',
  ] as const)
    test(`table native cleanup scroll: ${scheduling} ${change}`, async ({ page }) => {
      const mutation = {
        none: '',
        offset: 'r.scrollLeft=180;',
        context: 'r.setAttribute("aria-label","Private cleanup purpose");',
        focus: 'document.getElementById("stolen-focus").focus({preventScroll:true});',
        'original-target':
          'document.getElementById("destination").append(document.getElementById("outside"));',
        'document-scroll': 'window.scrollTo({top:160,behavior:"instant"});',
      }[change];
      const work = `()=>{window.cleanupApplied++;${mutation}}`;
      await fixture(
        page,
        region +
          '<input id="stolen-focus" aria-label="Other focus"><section id="destination"></section><div class="min-h-[2000px]"></div>',
        `
        const r=document.getElementById("scroll-region");
        let keys=0,handled=false;window.cleanupApplied=0;window.nativeCleanup=false;
        r.addEventListener("keydown",e=>{e.preventDefault();keys++;});
        r.addEventListener("scroll",event=>{
          if(handled||keys!==2||r.scrollLeft!==120)return;
          handled=true;window.nativeCleanup=event.isTrusted;
          ${scheduling === 'sync' ? `(${work})();` : scheduling === 'microtask' ? `queueMicrotask(${work});` : `requestAnimationFrame(${work});`}
        });
        `,
      );
      await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
      const report = await inspectTableScroll(page);
      expect(
        await page.evaluate(() => {
          const state = window as unknown as { cleanupApplied: number; nativeCleanup: boolean };
          return { applied: state.cleanupApplied, native: state.nativeCleanup };
        }),
      ).toEqual({ applied: 1, native: true });
      const lost = ['offset', 'context', 'focus'].includes(change);
      expect(report.observations).toHaveLength(1);
      expect(report.observations[0]).toMatchObject({
        status: lost ? 'unverified' : 'observed',
        scrollRestoration: {
          status: lost ? 'not-restored' : 'restored',
          applicationResetVerified: false,
        },
      });
      expect(report.findings.map(f => f.rule)).toEqual(lost ? [] : ['table-scroll-keyboard']);
      expect(report.focusRestoration).toEqual({
        status: lost || change === 'original-target' ? 'not-restored' : 'restored',
        applicationResetVerified: false,
      });
      expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(
        change === 'offset' ? 180 : 120,
      );
      await expect(
        page.locator(
          change === 'focus'
            ? '#stolen-focus'
            : lost || change === 'original-target'
              ? '#scroll-region'
              : '#outside',
        ),
      ).toBeFocused();
      if (change === 'context')
        await expect(page.locator('#scroll-region')).toHaveAttribute(
          'aria-label',
          'Private cleanup purpose',
        );
      if (change === 'original-target')
        await expect(page.locator('#destination > #outside')).toHaveCount(1);
      expect(await page.evaluate(() => scrollY)).toBe(change === 'document-scroll' ? 160 : 0);
      expect(JSON.stringify(report)).not.toMatch(/Private|scroll-region|stolen-focus|destination/);
    });
