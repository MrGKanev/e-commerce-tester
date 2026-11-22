// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/switch.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
// Observe native/custom binary Space behavior. Retained context, candidate/work
// bounds and no refocus after theft are local probe safety policy, not store API rules.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectWidgets } from '../tests/modern-web-widgets';
import type { Page } from '@playwright/test';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
async function load(
  page: Page,
  { native = true, checked = false, script = '', later = false, attributes = '' } = {},
) {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Switch ownership fixture</title><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Reversible preference</h1><form id="original-form"><div id="owner">${
        native
          ? `<label for="field" class="block">Private preference label</label><input id="field" type="checkbox" switch value="private-switch-value" ${checked ? 'checked' : ''} ${attributes} class="min-h-11 focus-visible:outline-2">`
          : `<button id="field" type="button" role="switch" aria-checked="${checked}" ${attributes} class="min-h-11 rounded border p-2 focus-visible:outline-2">Private preference label</button>`
      }</div></form><form id="other-form"></form><div id="destination"></div><input id="outside" aria-label="Outside">${later ? '<label for="later">Later preference</label><input id="later" type="checkbox" switch class="min-h-11 focus-visible:outline-2">' : ''}<script>
      const field=document.getElementById('field'),outside=document.getElementById('outside');
      const read=()=>${native ? 'field.checked' : 'field.getAttribute("aria-checked")==="true"'};
      const setChecked=value=>{${native ? 'field.checked=value;' : 'field.setAttribute("aria-checked",String(value));'}};
      window.keys=0;window.focuses=0;window.laterFocuses=0;window.inputs=0;window.changes=0;
      field.addEventListener('keydown',event=>{if(event.key===' ')window.keys++;});
      field.addEventListener('focus',()=>window.focuses++);
      field.addEventListener('input',()=>window.inputs++);
      field.addEventListener('change',()=>window.changes++);
      document.getElementById('later')?.addEventListener('focus',()=>window.laterFocuses++);
      ${native ? '' : "field.addEventListener('click',()=>setChecked(!read()));"}
      ${script}
      </script></main></body></html>`,
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto('http://127.0.0.1:45996/switch-ownership');
  await page.locator('#outside').focus();
  await guard.freeze();
  return { guard, writes: () => writes };
}

async function state(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      keys: number;
      focuses: number;
      laterFocuses: number;
      inputs: number;
      changes: number;
    };
    const field = document.getElementById('field')!;
    return {
      keys: w.keys,
      focuses: w.focuses,
      laterFocuses: w.laterFocuses,
      inputs: w.inputs,
      changes: w.changes,
      checked:
        field instanceof HTMLInputElement
          ? String(field.checked)
          : field.getAttribute('aria-checked'),
    };
  });
}

for (const native of [true, false])
  for (const checked of [false, true])
    test(`switch ownership restores ${native ? 'native' : 'custom'} ${checked} through keyboard`, async ({
      page,
    }, info) => {
      const fixture = await load(page, { native, checked });
      const report = await inspectWidgets(page);
      expect(report.findings).toEqual([]);
      expect(report.coverage.switches).toHaveLength(1);
      expect(report.coverage.switches[0]).toMatchObject({
        status: 'observed',
        keysSent: 2,
        before: { checked: String(checked) },
        toggled: { checked: String(!checked) },
        restored: { checked: String(checked) },
        restoration: { status: 'restored', method: 'keyboard', applicationResetVerified: false },
      });
      expect(await state(page)).toMatchObject({ keys: 2, focuses: 1, checked: String(checked) });
      expect(fixture.writes()).toBe(0);
      expect(JSON.stringify(report)).not.toMatch(/Private preference|private-switch-value/);
      if (!checked)
        await page.screenshot({ path: info.outputPath('switch-ownership.png'), fullPage: true });
    });

for (const native of [true, false])
  for (const phase of ['focus', 'space', 'return'] as const)
    test(`switch ownership preserves ${native ? 'native' : 'custom'} focus theft at ${phase}`, async ({
      page,
    }) => {
      await load(page, {
        native,
        later: true,
        script:
          phase === 'focus'
            ? "field.addEventListener('focus',()=>outside.focus());"
            : `field.addEventListener('keydown',event=>{if(event.key!==' ')return;event.preventDefault();setChecked(true);outside.focus();${phase === 'return' ? 'field.focus();' : ''}});`,
      });
      const report = await inspectWidgets(page);
      expect(report.findings).toEqual([]);
      expect(report.coverage.switches).toHaveLength(1);
      expect(report.coverage.switches[0]).toMatchObject({
        status: 'unverified',
        keysSent: phase === 'focus' ? 0 : 1,
      });
      expect(await state(page)).toMatchObject({
        keys: phase === 'focus' ? 0 : 1,
        focuses: phase === 'return' ? 2 : 1,
        laterFocuses: 0,
        checked: String(phase !== 'focus'),
      });
      await expect(page.locator(phase === 'return' ? '#field' : '#outside')).toBeFocused();
      await expect(page.locator('#later')).not.toBeChecked();
    });

for (const native of [true, false])
  test(`switch ownership preserves ${native ? 'native' : 'custom'} state supplied on focus`, async ({
    page,
  }) => {
    await load(page, {
      native,
      later: true,
      script: "field.addEventListener('focus',()=>setChecked(true));",
    });
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.switches).toHaveLength(1);
    expect(report.coverage.switches[0]).toMatchObject({ status: 'unverified', keysSent: 0 });
    expect(await state(page)).toMatchObject({
      checked: 'true',
      keys: 0,
      focuses: 1,
      laterFocuses: 0,
    });
    await expect(page.locator('#later')).not.toBeChecked();
  });

for (const mutation of [
  'reparent',
  'type',
  'form',
  'role',
  'value',
  'default',
  'disabled',
] as const)
  test(`switch ownership preserves native ${mutation} change before reversal`, async ({ page }) => {
    const work = {
      reparent: "document.getElementById('destination').append(field);field.focus();",
      type: "field.type='text';",
      form: "field.setAttribute('form','other-form');",
      role: "field.setAttribute('role','radio');",
      value: "field.value='private-repurposed-value';",
      default: 'field.defaultChecked=true;',
      disabled: 'field.disabled=true;',
    }[mutation];
    await load(page, {
      later: true,
      script: `field.addEventListener('keydown',event=>{if(event.key!==' ')return;event.preventDefault();setChecked(true);${work}});`,
    });
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.switches).toHaveLength(1);
    expect(report.coverage.switches[0]).toMatchObject({ status: 'unverified', keysSent: 1 });
    expect(await state(page)).toMatchObject({ keys: 1, laterFocuses: 0 });
    expect(JSON.stringify(report)).not.toMatch(
      /private-switch-value|private-repurposed-value|Private preference/,
    );
    await expect(page.locator('#later')).not.toBeChecked();
    if (mutation === 'reparent') await expect(page.locator('#destination > #field')).toHaveCount(1);
    if (mutation === 'type') await expect(page.locator('#field')).toHaveAttribute('type', 'text');
    if (mutation === 'form')
      await expect(page.locator('#field')).toHaveAttribute('form', 'other-form');
    if (mutation === 'role') await expect(page.locator('#field')).toHaveAttribute('role', 'radio');
    if (mutation === 'value')
      await expect(page.locator('#field')).toHaveValue('private-repurposed-value');
    if (mutation === 'default')
      expect(
        await page.locator('#field').evaluate((el: HTMLInputElement) => el.defaultChecked),
      ).toBe(true);
    if (mutation === 'disabled') await expect(page.locator('#field')).toBeDisabled();
  });

for (const native of [true, false])
  test(`switch ownership excludes ${native ? 'native indeterminate' : 'ARIA mixed'} states`, async ({
    page,
  }) => {
    await load(page, {
      native,
      script: native ? 'field.indeterminate=true;' : "field.setAttribute('aria-checked','mixed');",
    });
    const report = await inspectWidgets(page);
    expect(report.coverage.switches[0]).toMatchObject({ status: 'not-probed', keysSent: 0 });
    expect(await state(page)).toMatchObject({ keys: 0, focuses: 0 });
    if (native)
      expect(
        await page.locator('#field').evaluate((el: HTMLInputElement) => el.indeterminate),
      ).toBe(true);
    else await expect(page.locator('#field')).toHaveAttribute('aria-checked', 'mixed');
    expect(report.findings.some(finding => finding.rule === 'widget-switch-keyboard')).toBe(false);
  });

for (const native of [true, false])
  test(`switch ownership distinguishes blocked ${native ? 'native' : 'custom'} inverse`, async ({
    page,
  }) => {
    await load(page, {
      native,
      script:
        "field.addEventListener('keydown',event=>{if(event.key===' '&&window.keys===2)event.preventDefault();});",
    });
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([
      expect.objectContaining({ rule: 'widget-switch-keyboard', severity: 'warning' }),
    ]);
    expect(report.coverage.switches[0]).toMatchObject({
      keysSent: 2,
      restoration: {
        status: native ? 'restored' : 'not-restored',
        method: native ? 'native-property' : 'none',
        applicationResetVerified: false,
      },
    });
    expect(await state(page)).toMatchObject({ keys: 2, checked: String(!native) });
    if (native) expect(await state(page)).toMatchObject({ inputs: 1, changes: 1 });
  });

test('switch ownership preserves authored mixed state during inverse without warning', async ({
  page,
}) => {
  await load(page, {
    native: false,
    later: true,
    script:
      "field.addEventListener('keydown',event=>{if(event.key===' '&&window.keys===2){event.preventDefault();field.setAttribute('aria-checked','mixed');}});",
  });
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches).toHaveLength(1);
  expect(report.coverage.switches[0]).toMatchObject({
    status: 'unverified',
    keysSent: 2,
    restoration: { status: 'not-restored', applicationResetVerified: false },
  });
  await expect(page.locator('#field')).toHaveAttribute('aria-checked', 'mixed');
  expect(await state(page)).toMatchObject({ keys: 2, laterFocuses: 0 });
});

test('switch ownership quarantines a dependent write and does not sample later controls', async ({
  page,
}) => {
  const fixture = await load(page, {
    native: false,
    later: true,
    script:
      "field.addEventListener('click',()=>fetch('/private-write',{method:'POST'}).catch(()=>{}));",
  });
  const report = await inspectWidgets(page);
  expect(fixture.writes()).toBe(0);
  expect(fixture.guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches).toHaveLength(1);
  expect(report.coverage.switches[0]).toMatchObject({ status: 'unverified' });
  expect(await state(page)).toMatchObject({ keys: 1, checked: 'true', laterFocuses: 0 });
});

for (const budget of ['ancestry', 'attributes'] as const)
  test(`switch ownership excludes excessive ${budget} without focus or private export`, async ({
    page,
  }) => {
    await load(page, {
      script:
        budget === 'ancestry'
          ? "for(let i=0;i<25;i++){const wrapper=document.createElement('div');field.parentNode.insertBefore(wrapper,field);wrapper.append(field);}"
          : "field.setAttribute('data-private','private-ownership-sentinel'.repeat(1000));",
    });
    const report = await inspectWidgets(page);
    expect(report.coverage.switches[0]).toMatchObject({
      status: 'not-probed',
      reason: 'switch-ownership-budget',
      keysSent: 0,
    });
    expect(await state(page)).toMatchObject({ keys: 0, focuses: 0 });
    expect(JSON.stringify(report)).not.toContain('private-ownership-sentinel');
  });

test('switch ownership samples only five initial candidates', async ({ page }) => {
  await load(page, {
    script:
      "for(let i=0;i<5;i++){const copy=field.cloneNode(true);copy.id='extra-'+i;copy.setAttribute('aria-label','Extra preference');document.querySelector('main').append(copy);}",
  });
  const report = await inspectWidgets(page);
  expect(report.coverage.switches).toHaveLength(5);
  await expect(page.locator('#extra-4')).not.toBeFocused();
  await expect(page.locator('#extra-4')).not.toBeChecked();
});

for (const native of [true, false])
  test(`switch ownership warns for blocked ${native ? 'native' : 'custom'} first Space without an inverse`, async ({
    page,
  }) => {
    await load(page, {
      native,
      script:
        "field.addEventListener('keydown',event=>{if(event.key===' ')event.preventDefault();});",
    });
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([
      expect.objectContaining({ rule: 'widget-switch-keyboard', severity: 'warning' }),
    ]);
    expect(report.coverage.switches[0]).toMatchObject({
      status: 'observed',
      keysSent: 1,
      restoration: { status: 'unchanged', method: 'none', applicationResetVerified: false },
    });
    expect(await state(page)).toMatchObject({ keys: 1, checked: 'false', inputs: 0, changes: 0 });
  });

test('switch ownership excludes malformed custom state without sending keys', async ({ page }) => {
  await load(page, { native: false, script: "field.removeAttribute('aria-checked');" });
  const report = await inspectWidgets(page);
  expect(report.coverage.switches[0]).toMatchObject({ status: 'not-probed', keysSent: 0 });
  expect(report.findings).toEqual([
    expect.objectContaining({ rule: 'widget-switch-semantics', severity: 'warning' }),
  ]);
  expect(await state(page)).toMatchObject({ keys: 0, focuses: 0 });
  await expect(page.locator('#field')).not.toHaveAttribute('aria-checked');
});

test('switch ownership never focuses a later candidate repurposed by the first switch', async ({
  page,
}) => {
  await load(page, {
    native: false,
    later: true,
    script: "field.addEventListener('click',()=>document.getElementById('later').type='submit');",
  });
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches).toHaveLength(2);
  expect(report.coverage.switches[0]).toMatchObject({ status: 'observed', keysSent: 2 });
  expect(report.coverage.switches[1]).toMatchObject({ status: 'unverified', keysSent: 0 });
  expect(await state(page)).toMatchObject({ keys: 2, laterFocuses: 0 });
  await expect(page.locator('#later')).toHaveAttribute('type', 'submit');
});

for (const native of [true, false])
  test(`switch ownership leaves an oversized ${native ? 'native label' : 'custom content name'} unverified`, async ({
    page,
  }) => {
    await load(page, {
      native,
      script: `${native ? 'document.querySelector("label")' : 'field'}.textContent='private-long-name-'.repeat(500);`,
    });
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.switches[0]).toMatchObject({
      status: 'not-probed',
      reason: 'switch-naming-budget',
      keysSent: 0,
      restoration: { status: 'unchanged', method: 'none', applicationResetVerified: false },
    });
    expect(await state(page)).toMatchObject({ keys: 0, focuses: 0, checked: 'false' });
    expect(JSON.stringify(report)).not.toContain('private-long-name');
  });

test('switch ownership accepts a definite ARIA name despite oversized fallback content', async ({
  page,
}) => {
  await load(page, {
    native: false,
    attributes: 'aria-label="Definite preference"',
    script: "field.textContent='private-long-name-'.repeat(500);",
  });
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches[0]).toMatchObject({
    status: 'observed',
    keysSent: 2,
    before: { named: true },
    restoration: { status: 'restored', method: 'keyboard', applicationResetVerified: false },
  });
  expect(await state(page)).toMatchObject({ keys: 2, checked: 'false' });
  expect(JSON.stringify(report)).not.toMatch(/private-long-name|Definite preference/);
});
