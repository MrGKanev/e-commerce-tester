import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectDetails } from '../tests/modern-web-details';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const item = (id = 'field', open = false, name = '') =>
  `<details id="${id}" ${open ? 'open' : ''} ${name ? `name="${name}"` : ''} class="rounded border p-2"><summary class="min-h-11 focus-visible:outline-2">Private disclosure label</summary><p>Private disclosure content</p></details>`;
async function load(page: Page, { markup = item(), script = '' } = {}) {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native disclosure ownership fixture</title><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Local disclosures</h1><input id="outside" aria-label="Outside">${markup}<div id="destination"></div><script>
      const field=document.getElementById('field'),summary=field?.querySelector(':scope > summary'),outside=document.getElementById('outside');
      window.keys=0;window.focuses=0;window.peerFocuses=0;
      summary?.addEventListener('focus',()=>window.focuses++);
      summary?.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))window.keys++;});
      document.getElementById('peer')?.querySelector('summary')?.addEventListener('focus',()=>window.peerFocuses++);
      ${script}
    </script></main></body></html>`,
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto('http://127.0.0.1:45996/details-ownership');
  await page.locator('#outside').focus();
  await guard.freeze();
  return { guard, writes: () => writes };
}
const counts = (page: Page) =>
  page.evaluate(() => {
    const state = window as unknown as { keys: number; focuses: number; peerFocuses: number };
    return { keys: state.keys, focuses: state.focuses, peerFocuses: state.peerFocuses };
  });

test('native details ownership refuses an unfrozen document and records absent optional disclosures', async ({ page }) => {
  await page.goto('about:blank');
  await expect(inspectDetails(page)).rejects.toThrow('freeze()');
  await load(page, { markup: '<p>No disclosures.</p>' });
  expect(await inspectDetails(page)).toMatchObject({
    observations: [],
    findings: [],
    continuationSafe: true,
  });
});

for (const open of [false, true])
  test(`native details ownership restores initial open ${open} through keyboard`, async ({
    page,
  }, info) => {
    const fixture = await load(page, { markup: item('field', open) });
    const result = await inspectDetails(page);
    expect(result.findings).toEqual([]);
    expect(result.continuationSafe).toBe(true);
    expect(result.observations[0]).toMatchObject({
      initial: { open, grouped: false },
      toggled: !open,
      restored: open,
      keysSent: 2,
      status: 'observed',
      restoration: {
        status: 'restored',
        method: 'keyboard',
        cleanupWrites: 0,
        applicationResetVerified: false,
      },
    });
    expect(await counts(page)).toEqual({ keys: 2, focuses: 1, peerFocuses: 0 });
    expect(await page.locator('#field').evaluate(el => el.hasAttribute('open'))).toBe(open);
    expect(fixture.writes()).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/Private disclosure|field/);
    if (!open)
      await page.screenshot({ path: info.outputPath('details-ownership.png'), fullPage: true });
  });

test('native details ownership restores an original exclusive peer without reactivating it', async ({
  page,
}) => {
  await load(page, {
    markup: item('field', false, 'private-group') + item('peer', true, 'private-group'),
  });
  const result = await inspectDetails(page);
  expect(result.findings).toEqual([]);
  expect(result.continuationSafe).toBe(true);
  expect(result.observations).toHaveLength(2);
  const exclusive = await page.evaluate(() => Object.hasOwn(HTMLDetailsElement.prototype, 'name'));
  expect(result.observations[0]).toMatchObject({
    keysSent: 2,
    status: 'observed',
    initial: { open: false, grouped: true },
    toggled: true,
    restored: false,
    restoration: {
      status: 'restored',
      method: exclusive ? 'native-group' : 'keyboard',
      cleanupWrites: exclusive ? 1 : 0,
    },
  });
  await expect(page.locator('#field')).not.toHaveAttribute('open');
  await expect(page.locator('#peer')).toHaveAttribute('open', '');
  expect(JSON.stringify(result)).not.toMatch(/private-group|Private disclosure/);
});

for (const phase of ['focus', 'enter', 'space', 'return'] as const)
  test(`native details ownership preserves focus theft at ${phase}`, async ({ page }) => {
    await load(page, {
      markup: item() + item('peer'),
      script:
        phase === 'focus'
          ? "summary.addEventListener('focus',()=>outside.focus());"
          : `summary.addEventListener('keydown',event=>{if(${phase === 'space' ? "event.key===' '" : "event.key==='Enter'"}){event.preventDefault();outside.focus();${phase === 'return' ? 'summary.focus();' : ''}}});`,
    });
    const result = await inspectDetails(page);
    expect(result.findings).toEqual([]);
    expect(result.continuationSafe).toBe(false);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      status: 'unverified',
      keysSent: phase === 'focus' ? 0 : phase === 'space' ? 2 : 1,
      restoration: { status: 'not-restored' },
    });
    expect(await counts(page)).toMatchObject({
      focuses: phase === 'return' ? 2 : 1,
      peerFocuses: 0,
    });
    await expect(page.locator(phase === 'return' ? '#field > summary' : '#outside')).toBeFocused();
    expect(await page.locator('#field').evaluate(el => el.hasAttribute('open'))).toBe(
      phase === 'space',
    );
  });

test('native details ownership preserves state supplied on focus before sending any key', async ({
  page,
}) => {
  await load(page, {
    markup: item() + item('peer'),
    script: "summary.addEventListener('focus',()=>field.open=true);",
  });
  const result = await inspectDetails(page);
  expect(result.findings).toEqual([]);
  expect(result.continuationSafe).toBe(false);
  expect(result.observations[0]).toMatchObject({ status: 'unverified', keysSent: 0 });
  expect(await counts(page)).toEqual({ keys: 0, focuses: 1, peerFocuses: 0 });
  await expect(page.locator('#field')).toHaveAttribute('open', '');
});

for (const mutation of [
  'reparent',
  'summary-replacement',
  'name',
  'group-member',
  'disabled',
  'role',
] as const)
  test(`native details ownership preserves authored ${mutation} after Enter`, async ({ page }) => {
    const work = {
      reparent: "document.getElementById('destination').append(field);summary.focus();",
      'summary-replacement': 'summary.replaceWith(summary.cloneNode(true));',
      name: "field.name='private-new-group';",
      'group-member':
        "const extra=document.createElement('details');extra.name='private-group';extra.innerHTML='<summary>New disclosure</summary>';document.querySelector('main').append(extra);",
      disabled: "summary.setAttribute('aria-disabled','true');",
      role: "summary.setAttribute('role','link');",
    }[mutation];
    await load(page, {
      markup: item('field', false, 'private-group'),
      script: `summary.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();field.open=true;${work}}});`,
    });
    const result = await inspectDetails(page);
    expect(result.findings).toEqual([]);
    expect(result.continuationSafe).toBe(false);
    expect(result.observations[0]).toMatchObject({ status: 'unverified', keysSent: 1 });
    await expect(page.locator('#field')).toHaveAttribute('open', '');
    expect(JSON.stringify(result)).not.toMatch(
      /private-group|private-new-group|Private disclosure/,
    );
    if (mutation === 'reparent') await expect(page.locator('#destination > #field')).toHaveCount(1);
    if (mutation === 'name')
      await expect(page.locator('#field')).toHaveAttribute('name', 'private-new-group');
  });

for (const inverse of [false, true])
  test(`native details ownership reports blocked ${inverse ? 'inverse Space' : 'first Enter'} without concealing keyboard failure`, async ({
    page,
  }) => {
    await load(page, {
      script: `summary.addEventListener('keydown',event=>{if(event.key===${JSON.stringify(inverse ? ' ' : 'Enter')})event.preventDefault();});`,
    });
    const result = await inspectDetails(page);
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'widget-accordion-keyboard', severity: 'warning' }),
    ]);
    expect(result.continuationSafe).toBe(true);
    expect(result.observations[0]).toMatchObject({
      status: 'observed',
      keysSent: inverse ? 2 : 1,
      restoration: {
        status: inverse ? 'restored' : 'unchanged',
        method: inverse ? 'native-property' : 'none',
        applicationResetVerified: false,
      },
    });
    await expect(page.locator('#field')).not.toHaveAttribute('open');
  });

for (const schedule of ['sync', 'microtask', 'animation-frame'] as const)
  for (const change of ['focus', 'name', 'peer-state'] as const)
    test(`native details cleanup toggle handler preserves ${schedule} ${change}`, async ({
      page,
    }) => {
      const work = {
        focus: 'outside.focus();',
        name: "document.getElementById('peer').name='private-new-group';",
        'peer-state': "document.getElementById('third').open=true;",
      }[change];
      const callback = `()=>{window.cleanupApplied++;${work}}`;
      await load(page, {
        markup:
          item('field', false, 'private-group') +
          item('peer', true, 'private-group') +
          item('third', false, 'private-group'),
        script: `window.cleanupApplied=0;const peer=document.getElementById('peer');peer.addEventListener('toggle',()=>{if(window.keys!==2||!peer.open)return;${schedule === 'sync' ? `(${callback})();` : schedule === 'microtask' ? `queueMicrotask(${callback});` : `requestAnimationFrame(${callback});`}});`,
      });
      const result = await inspectDetails(page);
      expect(
        await page.evaluate(() => (window as unknown as { cleanupApplied: number }).cleanupApplied),
      ).toBe(1);
      expect(result.findings).toEqual([]);
      expect(result.continuationSafe).toBe(false);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]).toMatchObject({
        status: 'unverified',
        keysSent: 2,
        restoration: { status: 'not-restored' },
      });
      expect(await counts(page)).toMatchObject({ keys: 2, peerFocuses: 0 });
      if (change === 'focus') await expect(page.locator('#outside')).toBeFocused();
      if (change === 'name')
        await expect(page.locator('#peer')).toHaveAttribute('name', 'private-new-group');
      if (change === 'peer-state') await expect(page.locator('#third')).toHaveAttribute('open', '');
    });

test('native details cleanup retains authored document scrolling', async ({ page }) => {
  await load(page, {
    markup:
      item('field', false, 'private-group') +
      item('peer', true, 'private-group') +
      '<div class="min-h-[2000px]"></div>',
    script:
      "document.getElementById('peer').addEventListener('toggle',event=>{if(window.keys===2&&event.currentTarget.open)window.scrollTo({top:160,behavior:'instant'});});",
  });
  const result = await inspectDetails(page);
  expect(result.findings).toEqual([]);
  expect(result.continuationSafe).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(160);
});

test('native details ownership never focuses a later repurposed candidate', async ({ page }) => {
  await load(page, {
    markup: item() + item('peer'),
    script:
      "summary.addEventListener('click',()=>document.getElementById('peer').name='private-new-group');",
  });
  const result = await inspectDetails(page);
  expect(result.findings).toEqual([]);
  expect(result.observations[0]).toMatchObject({ status: 'observed', keysSent: 2 });
  expect(result.observations[1]).toMatchObject({ status: 'unverified', keysSent: 0 });
  expect(result.continuationSafe).toBe(false);
  expect(await counts(page)).toMatchObject({ peerFocuses: 0 });
});

for (const limit of ['ancestry', 'attributes', 'group', 'document'] as const)
  test(`native details ownership excludes excessive ${limit} without private exports`, async ({
    page,
  }) => {
    await load(page, {
      markup: item('field', false, 'private-group'),
      script:
        limit === 'ancestry'
          ? "for(let i=0;i<25;i++){const wrapper=document.createElement('div');field.parentNode.insertBefore(wrapper,field);wrapper.append(field);}"
          : limit === 'attributes'
            ? "field.setAttribute('data-private','private-ownership-sentinel'.repeat(1000));"
            : `for(let i=0;i<${limit === 'group' ? 32 : 64};i++){const peer=document.createElement('details');peer.name=${JSON.stringify(limit === 'group' ? 'private-group' : 'different')};peer.innerHTML='<summary>Other disclosure</summary>';document.querySelector('main').append(peer);}`,
    });
    const result = await inspectDetails(page);
    expect(result.observations[0]).toMatchObject({
      status: 'not-probed',
      reason: 'details-ownership-budget',
      keysSent: 0,
    });
    expect(await counts(page)).toMatchObject({ keys: 0, focuses: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private-ownership-sentinel|private-group/);
  });

for (const kind of [
  'empty',
  'heading',
  'oversized',
  'aria-name',
  'disabled',
  'missing',
  'hidden-missing',
] as const)
  test(`native details ownership distinguishes summary ${kind}`, async ({ page }) => {
    const markup =
      kind === 'missing'
        ? '<details id="field"><p>Answer</p></details>'
        : kind === 'hidden-missing'
          ? '<details hidden id="field"><p>Answer</p></details>'
          : item();
    const script = {
      empty: "summary.textContent='';",
      heading: "summary.innerHTML='<h2>Local heading</h2>';",
      oversized: "summary.textContent='private-long-label-'.repeat(500);",
      'aria-name':
        "summary.textContent='private-long-label-'.repeat(500);summary.setAttribute('aria-label','Definite name');",
      disabled: "summary.setAttribute('aria-disabled','true');",
      missing: '',
      'hidden-missing': '',
    }[kind];
    await load(page, { markup, script });
    const result = await inspectDetails(page);
    if (['empty', 'heading', 'missing'].includes(kind))
      expect(result.findings).toEqual([
        expect.objectContaining({ rule: 'widget-accordion-summary', severity: 'warning' }),
      ]);
    else expect(result.findings).toEqual([]);
    if (['disabled', 'missing', 'hidden-missing', 'oversized'].includes(kind))
      expect(result.observations[0]).toMatchObject({ status: 'not-probed', keysSent: 0 });
    else expect(result.observations[0]).toMatchObject({ status: 'observed', keysSent: 2 });
    expect(JSON.stringify(result)).not.toMatch(/private-long-label|Definite name/);
  });

test('native details ownership quarantines requests and stops before another disclosure', async ({
  page,
}) => {
  const fixture = await load(page, {
    markup: item() + item('peer'),
    script:
      "summary.addEventListener('click',()=>fetch('/private-write',{method:'POST'}).catch(()=>{}));",
  });
  const result = await inspectDetails(page);
  expect(result.findings).toEqual([]);
  expect(result.continuationSafe).toBe(false);
  expect(result.observations).toHaveLength(1);
  expect(result.observations[0]).toMatchObject({ status: 'unverified', keysSent: 1 });
  expect(fixture.guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(fixture.writes()).toBe(0);
  expect(await counts(page)).toMatchObject({ peerFocuses: 0 });
});
