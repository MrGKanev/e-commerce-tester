// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
// Observe preservation of authored focus/state, not compliance with a particular
// focus API. Stage stopping is local audit safety policy, not application reset.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectWidgets } from '../tests/modern-web-widgets';
import { canContinueWidgetProbe } from '../tests/modern-web-probe-continuation';
import type { Page } from '@playwright/test';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const stages = [
  'tabs',
  'details',
  'switches',
  'sliders',
  'menuNavigation',
  'menubarSwitching',
  'composites',
  'tableScroll',
  'customAccordions',
];
const switchMarkup =
  '<label for="preference">Private preference</label><input id="preference" type="checkbox" switch>';
const sliderMarkup =
  '<label for="range">Private range</label><input id="range" type="range" min="0" max="10" value="4">';
const laterMarkup = `<input id="menu-before" aria-label="Before commands"><button id="menu-trigger" type="button" aria-haspopup="menu" aria-controls="local-menu" aria-expanded="false" class="min-h-11 rounded border p-2">Commands</button><div id="local-menu" role="menu" aria-label="Local commands" hidden><button type="button" role="menuitem" tabindex="-1">Preview</button></div><input id="menu-after" aria-label="After commands">
<div id="table-region" role="region" tabindex="0" aria-label="Private comparison" class="w-[240px] overflow-x-auto border focus-visible:outline-2"><table class="w-[900px]"><caption>Private comparison</caption><tr><th scope="col">Column</th><td>Value</td></tr></table></div>
<section><h2><button id="custom-question" type="button" aria-expanded="false" aria-controls="custom-answer" class="min-h-11 rounded border p-2">Local question</button></h2><div id="custom-answer" hidden>Local answer</div></section>`;
const laterScript = `
const trigger=document.getElementById('menu-trigger'),menu=document.getElementById('local-menu');
const closeMenu=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();menu.hidden=false;trigger.setAttribute('aria-expanded','true');menu.querySelector('button').focus();}});
menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeMenu();trigger.focus();}if(event.key==='Tab'){event.preventDefault();closeMenu();document.getElementById(event.shiftKey?'menu-before':'menu-after').focus();}});
const region=document.getElementById('table-region');region.addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft'].includes(event.key)){event.preventDefault();region.scrollLeft+=event.key==='ArrowRight'?40:-40;}});
const question=document.getElementById('custom-question'),answer=document.getElementById('custom-answer');question.addEventListener('click',()=>{window.activity.accordionClicks++;answer.hidden=!answer.hidden;question.setAttribute('aria-expanded',String(!answer.hidden));});
`;

async function load(page: Page, markup: string, script = '') {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Probe continuation fixture</title><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-2xl space-y-4 p-4"><h1 class="text-2xl font-bold">Probe continuation</h1><input id="outside" aria-label="Outside">${markup}${laterMarkup}</main><script>
      window.activity={switchFocuses:0,sliderFocuses:0,menuFocuses:0,tableFocuses:0,accordionClicks:0,sliderKeys:0};
      for(const [id,key] of [['preference','switchFocuses'],['range','sliderFocuses'],['menu-trigger','menuFocuses'],['table-region','tableFocuses']])document.getElementById(id)?.addEventListener('focus',()=>window.activity[key]++);
      ${laterScript}${script}
      </script></body></html>`,
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto('http://127.0.0.1:45996/probe-continuation');
  await page.locator('#outside').focus();
  await guard.freeze();
  return { guard, writes: () => writes };
}

const activity = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          activity: Record<string, number>;
        }
      ).activity,
  );

function stopped(coverage: Record<string, unknown>, stage: string) {
  expect(coverage.continuation).toEqual({
    status: 'stopped',
    stoppedAfter: stage,
    skippedStages: stages.slice(stages.indexOf(stage) + 1),
    applicationResetVerified: false,
  });
}

test('continuation classifier distinguishes lost ownership from untouched exclusions and restored advisories', () => {
  expect(canContinueWidgetProbe({ observations: [] })).toBe(true);
  expect(canContinueWidgetProbe({ continuationSafe: false, observations: [] })).toBe(false);
  expect(canContinueWidgetProbe({ networkDependent: true, observations: [] })).toBe(false);
  expect(canContinueWidgetProbe({ observations: [{ status: 'not-probed', keysSent: 0 }] })).toBe(
    true,
  );
  expect(canContinueWidgetProbe({ observations: [{ status: 'not-probed', keysSent: 1 }] })).toBe(
    false,
  );
  expect(canContinueWidgetProbe({ observations: [{ status: 'unverified' }] })).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restored: false, restoration: { status: 'restored' } }],
    }),
  ).toBe(true);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restoration: { status: 'not-restored' } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', cleanup: { status: 'unverified' } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restoration: { closed: false } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [
        { status: 'observed', optional: { status: 'unverified' }, restoration: { closed: true } },
      ],
    }),
  ).toBe(true);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', scrollRestoration: { status: 'restored' } }],
      focusRestoration: { status: 'not-restored' },
    }),
  ).toBe(false);
});

test('continuation stops tabs without recovery refocus before disclosure probing', async ({
  page,
}) => {
  await load(
    page,
    `<div role="tablist" aria-label="Local tabs"><button id="tab-first" type="button" role="tab" aria-selected="true" tabindex="0">First</button><button id="tab-second" type="button" role="tab" aria-selected="false" tabindex="-1">Second</button></div><section role="tabpanel" aria-labelledby="tab-first">First content</section><section role="tabpanel" aria-labelledby="tab-second" hidden>Second content</section><details><summary id="later-summary">Local disclosure</summary><p>Local content</p></details>${switchMarkup}`,
    `
    window.tabFocuses=0;window.summaryFocuses=0;
    const tab=document.getElementById('tab-first');tab.addEventListener('focus',()=>window.tabFocuses++);
    tab.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();document.getElementById('outside').focus();}});
    document.getElementById('later-summary').addEventListener('focus',()=>window.summaryFocuses++);
  `,
  );
  const report = await inspectWidgets(page);
  stopped(report.coverage, 'tabs');
  expect(report.coverage.accordions).toEqual([]);
  expect(report.coverage.switches).toEqual([]);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { tabFocuses: number; summaryFocuses: number };
      return { tabs: w.tabFocuses, summaries: w.summaryFocuses };
    }),
  ).toEqual({ tabs: 1, summaries: 0 });
  expect(await activity(page)).toMatchObject({
    switchFocuses: 0,
    menuFocuses: 0,
    tableFocuses: 0,
    accordionClicks: 0,
  });
  await expect(page.locator('#outside')).toBeFocused();
});

for (const phase of ['focus', 'enter'] as const)
  test(`continuation stops details before a later switch after authored ${phase} focus theft`, async ({
    page,
  }) => {
    await load(
      page,
      `<details id="disclosure"><summary>Private disclosure</summary><p>Local content</p></details>${switchMarkup}${sliderMarkup}`,
      `
      const disclosure=document.getElementById('disclosure'),summary=disclosure.querySelector('summary');
      summary.addEventListener('${phase === 'focus' ? 'focus' : 'keydown'}',event=>{${phase === 'enter' ? "if(event.key!=='Enter')return;event.preventDefault();disclosure.open=true;" : ''}document.getElementById('outside').focus();});
    `,
    );
    const report = await inspectWidgets(page);
    stopped(report.coverage, 'details');
    expect(report.coverage.switches).toEqual([]);
    expect(report.coverage.sliders).toEqual([]);
    expect(await activity(page)).toMatchObject({
      switchFocuses: 0,
      sliderFocuses: 0,
      menuFocuses: 0,
      tableFocuses: 0,
      accordionClicks: 0,
    });
    await expect(page.locator('#outside')).toBeFocused();
    await expect(page.locator('#preference')).not.toBeChecked();
    expect(JSON.stringify(report)).not.toMatch(
      /Private preference|Private disclosure|Private comparison/,
    );
  });

for (const phase of ['focus', 'space', 'dependency'] as const)
  test(`continuation stops switches before a later slider after ${phase} loss`, async ({
    page,
  }) => {
    const fixture = await load(
      page,
      switchMarkup + sliderMarkup,
      `
      const preference=document.getElementById('preference');
      ${phase === 'dependency' ? "preference.addEventListener('change',()=>fetch('/private-write',{method:'POST'}).catch(()=>{}));" : `preference.addEventListener('${phase === 'focus' ? 'focus' : 'keydown'}',event=>{${phase === 'space' ? "if(event.key!==' ')return;event.preventDefault();preference.checked=true;" : ''}document.getElementById('outside').focus();});`}
    `,
    );
    const report = await inspectWidgets(page);
    stopped(report.coverage, 'switches');
    expect(report.coverage.sliders).toEqual([]);
    expect(await activity(page)).toMatchObject({
      sliderFocuses: 0,
      menuFocuses: 0,
      tableFocuses: 0,
      accordionClicks: 0,
    });
    await expect(page.locator('#range')).toHaveValue('4');
    if (phase !== 'dependency') await expect(page.locator('#outside')).toBeFocused();
    else {
      expect(fixture.guard.counts().blockedRequests).toBeGreaterThan(0);
      expect(fixture.writes()).toBe(0);
      await expect(page.locator('#preference')).toBeChecked();
    }
  });

for (const failure of ['focus-theft', 'inverse-focus', 'inverse-value'] as const)
  test(`continuation stops sliders before menu accordion and table actions after ${failure}`, async ({
    page,
  }) => {
    const markup =
      failure === 'focus-theft'
        ? sliderMarkup
        : '<div id="range" role="slider" tabindex="0" aria-label="Private range" aria-valuemin="0" aria-valuemax="10" aria-valuenow="4">Range</div>';
    await load(
      page,
      markup,
      `
      const range=document.getElementById('range');
      ${failure === 'focus-theft' ? "range.addEventListener('focus',()=>document.getElementById('outside').focus());" : `range.addEventListener('keydown',event=>{event.preventDefault();window.activity.sliderKeys++;range.setAttribute('aria-valuenow',window.activity.sliderKeys===1?'5':'8');${failure === 'inverse-focus' ? "if(window.activity.sliderKeys===2)document.getElementById('outside').focus();" : ''}});`}
    `,
    );
    const report = await inspectWidgets(page);
    stopped(report.coverage, 'sliders');
    expect(await activity(page)).toMatchObject({
      menuFocuses: 0,
      tableFocuses: 0,
      accordionClicks: 0,
    });
    expect(report.coverage.menuNavigation.observations).toEqual([]);
    expect(report.coverage.customAccordions.observations).toEqual([]);
    expect(report.coverage.tableScroll.observations).toEqual([]);
    if (failure !== 'focus-theft')
      await expect(page.locator('#range')).toHaveAttribute('aria-valuenow', '8');
    if (failure !== 'inverse-value') await expect(page.locator('#outside')).toBeFocused();
  });

test('continuation stops an observed custom switch with unavailable inverse cleanup', async ({
  page,
}) => {
  await load(
    page,
    '<button id="preference" type="button" role="switch" aria-checked="false">Local preference</button>' +
      sliderMarkup,
    `
    const preference=document.getElementById('preference');let spaces=0;
    preference.addEventListener('keydown',event=>{if(event.key===' '&&++spaces===2)event.preventDefault();});
    preference.addEventListener('click',()=>preference.setAttribute('aria-checked',String(preference.getAttribute('aria-checked')!=='true')));
  `,
  );
  const report = await inspectWidgets(page);
  stopped(report.coverage, 'switches');
  expect(report.coverage.switches[0]).toMatchObject({
    status: 'observed',
    keysSent: 2,
    restoration: { status: 'not-restored', method: 'none' },
  });
  expect(report.findings.some(finding => finding.rule === 'widget-switch-keyboard')).toBe(true);
  expect(await activity(page)).toMatchObject({
    sliderFocuses: 0,
    menuFocuses: 0,
    tableFocuses: 0,
    accordionClicks: 0,
  });
  await expect(page.locator('#preference')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#range')).toHaveValue('4');
});

test('continuation stops after table focus restoration loses its original target', async ({
  page,
}) => {
  await load(
    page,
    sliderMarkup + '<div id="moved-target"></div>',
    `
    region.scrollLeft=120;let tableKeys=0,moved=false;
    region.addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft'].includes(event.key))tableKeys++;});
    region.addEventListener('scroll',()=>{if(!moved&&tableKeys===2&&region.scrollLeft===120){moved=true;document.getElementById('moved-target').append(document.getElementById('range'));}});
  `,
  );
  const report = await inspectWidgets(page);
  stopped(report.coverage, 'tableScroll');
  expect(report.coverage.tableScroll.observations[0]).toMatchObject({
    status: 'observed',
    scrollRestoration: { status: 'restored' },
  });
  expect(report.coverage.tableScroll.focusRestoration).toMatchObject({ status: 'not-restored' });
  await expect(page.locator('#moved-target > #range')).toHaveCount(1);
  expect(await activity(page)).toMatchObject({ accordionClicks: 0 });
  expect(report.coverage.customAccordions.observations).toEqual([]);
});

test('continuation reaches later command-free stages after ordinary successful probes', async ({
  page,
}, info) => {
  await load(
    page,
    '<details><summary>Local disclosure</summary><p>Local content</p></details>' +
      switchMarkup +
      sliderMarkup,
  );
  const report = await inspectWidgets(page);
  expect(report.coverage.continuation).toEqual({
    status: 'completed',
    stoppedAfter: null,
    skippedStages: [],
    applicationResetVerified: false,
  });
  expect(report.coverage.switches[0]).toMatchObject({ status: 'observed', keysSent: 2 });
  expect(report.coverage.sliders[0]).toMatchObject({ status: 'observed' });
  expect(report.coverage.menuNavigation.observations[0]).toMatchObject({ status: 'observed' });
  expect(report.coverage.tableScroll.observations[0]).toMatchObject({ status: 'observed' });
  expect(report.coverage.customAccordions.observations[0]).toMatchObject({ status: 'observed' });
  const observed = await activity(page);
  expect(observed.menuFocuses).toBeGreaterThan(0);
  expect(observed.tableFocuses).toBeGreaterThan(0);
  expect(observed.accordionClicks).toBeGreaterThan(0);
  if (['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name))
    await page.screenshot({ path: info.outputPath('probe-continuation.png'), fullPage: true });
});

test('continuation allows an untouched switch exclusion and a restored advisory before later probes', async ({
  page,
}) => {
  await load(
    page,
    '<input id="excluded" type="checkbox" switch aria-label="Excluded mixed preference">' +
      switchMarkup +
      sliderMarkup,
    `
    document.getElementById('excluded').indeterminate=true;
    document.getElementById('preference').addEventListener('keydown',event=>{if(event.key===' ')event.preventDefault();});
  `,
  );
  const report = await inspectWidgets(page);
  expect(report.coverage.continuation).toMatchObject({
    status: 'completed',
    stoppedAfter: null,
    skippedStages: [],
  });
  expect(report.coverage.switches[0]).toMatchObject({ status: 'not-probed', keysSent: 0 });
  expect(report.coverage.switches[1]).toMatchObject({
    status: 'observed',
    keysSent: 1,
    restoration: { status: 'unchanged' },
  });
  expect(report.findings.some(finding => finding.rule === 'widget-switch-keyboard')).toBe(true);
  expect(report.coverage.sliders[0]).toMatchObject({ status: 'observed' });
  expect((await activity(page)).sliderFocuses).toBeGreaterThan(0);
});

for (const scheduling of ['sync', 'microtask', 'animation-frame'] as const)
  test(`continuation preserves slider state after ${scheduling} input dependency`, async ({
    page,
  }) => {
    const send = "()=>fetch('/private-slider-write',{method:'POST'}).catch(()=>{})";
    const fixture = await load(
      page,
      sliderMarkup,
      `
      document.getElementById('range').addEventListener('input',()=>{
        ${scheduling === 'sync' ? `(${send})();` : scheduling === 'microtask' ? `queueMicrotask(${send});` : `requestAnimationFrame(${send});`}
      });
    `,
    );
    const report = await inspectWidgets(page);
    await expect(page.locator('#range')).toHaveValue('5');
    stopped(report.coverage, 'sliders');
    expect(report.coverage.widgetDependenciesObserved).toBe(true);
    expect(report.coverage.sliders[0]).toMatchObject({ status: 'unverified', keysSent: 1 });
    expect(report.findings).toEqual([]);
    expect(fixture.writes()).toBe(0);
    expect(fixture.guard.counts().blockedRequests).toBeGreaterThan(0);
    expect(await activity(page)).toMatchObject({
      menuFocuses: 0,
      tableFocuses: 0,
      accordionClicks: 0,
    });
  });
