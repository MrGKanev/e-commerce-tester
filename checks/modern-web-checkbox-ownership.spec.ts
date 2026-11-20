// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/checkbox.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// Binary Space reversal must retain the same context. Mixed states and author
// mutations are preserved; custom ARIA is never rewritten to simulate success.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe, inspectInteractions } from '../tests/modern-web-interactions';
import { inspectCheckboxes } from '../tests/modern-web-checkboxes';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'native',
  'checked',
  'custom',
  'custom-checked',
  'mixed',
  'custom-mixed',
  'disabled',
  'replacement',
  'value-change',
  'default-change',
  'role-change',
  'focus-theft',
  'custom-focus',
  'opens-modal',
  'custom-disabled',
  'async-author-change',
  'native-inverse-blocked',
  'custom-inverse-blocked',
  'reset-handler',
  'network',
  'no-handler',
]) {
  test(`checkbox ownership: ${scenario}`, async ({ page }, info) => {
    let writes = 0;
    const custom = scenario.startsWith('custom') || scenario === 'no-handler';
    await page.context().route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkbox ownership</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Reversible preference</h1>${custom ? `<span id="field" role="checkbox" aria-checked="${scenario === 'custom-mixed' ? 'mixed' : scenario === 'custom-checked' ? 'true' : 'false'}" tabindex="0" class="inline-flex min-h-11 items-center rounded border p-2 focus-visible:outline-2">Private label</span>` : `<label class="flex min-h-11 items-center gap-2"><input id="field" type="checkbox" value="private-original" ${scenario === 'checked' ? 'checked' : ''} ${scenario === 'disabled' ? 'disabled' : ''}>Private label</label>`}<button id="after" type="button" class="rounded border p-2">Next</button><dialog id="modal"><button type="button">Continue</button></dialog></main><script>
      const field=document.getElementById('field'),scenario=${JSON.stringify(scenario)},custom=${custom};
      window.keys=0;window.inputs=0;window.changes=0;
      if(scenario==='mixed')field.indeterminate=true;
      const mutate=()=>{
        if(scenario==='replacement'){const replacement=field.cloneNode(true);replacement.checked=true;field.replaceWith(replacement);}
        if(scenario==='value-change')field.value='private-new-purpose';
        if(scenario==='default-change')field.defaultChecked=true;
        if(scenario==='role-change')field.setAttribute('role','radio');
        if(scenario==='focus-theft'||scenario==='custom-focus')document.getElementById('after').focus();
        if(scenario==='opens-modal')document.getElementById('modal').showModal();
        if(scenario==='custom-disabled')field.setAttribute('aria-disabled','true');
        if(scenario==='async-author-change')setTimeout(()=>field.checked=false,60);
        if(scenario==='network')fetch('/write',{method:'POST'}).catch(()=>{});
      };
      field.addEventListener('keydown',event=>{
        if(event.key!==' ')return;window.keys++;
        if(custom&&scenario!=='no-handler')event.preventDefault();
        if(['native-inverse-blocked','reset-handler'].includes(scenario)&&window.keys===2)event.preventDefault();
      });
      field.addEventListener('keyup',event=>{
        if(event.key!==' '||!custom||['custom-mixed','no-handler'].includes(scenario))return;
        if(scenario==='custom-inverse-blocked'&&window.keys===2)return;
        field.setAttribute('aria-checked',String(field.getAttribute('aria-checked')!=='true'));mutate();
      });
      field.addEventListener('input',()=>{window.inputs++;if(scenario==='reset-handler'&&window.inputs===2)field.checked=true;mutate();});
      field.addEventListener('change',()=>window.changes++);
      </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/checkbox-ownership');
    await guard.freeze();
    const report = await inspectCheckboxes(page);
    const entry = report.observations[0];
    expect(writes).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(
      /private-original|private-new-purpose|Private label/,
    );
    const keys = await page.evaluate(() => (window as unknown as { keys: number }).keys);
    expect(keys).toBeLessThanOrEqual(2);
    if (['native', 'checked', 'custom', 'custom-checked', 'network'].includes(scenario)) {
      expect(entry).toMatchObject({
        status: 'observed',
        keysSent: 2,
        restoration: { status: 'restored', method: 'keyboard' },
      });
      expect(report.findings).toEqual([]);
      if (scenario === 'network') expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    } else if (['mixed', 'custom-mixed', 'disabled'].includes(scenario)) {
      expect(entry).toMatchObject({
        status: 'not-probed',
        keysSent: 0,
        restoration: { status: 'unchanged' },
      });
      if (scenario === 'mixed')
        expect(
          await page.locator('#field').evaluate((el: HTMLInputElement) => el.indeterminate),
        ).toBe(true);
      if (scenario === 'custom-mixed')
        await expect(page.locator('#field')).toHaveAttribute('aria-checked', 'mixed');
    } else if (
      ['native-inverse-blocked', 'custom-inverse-blocked', 'reset-handler', 'no-handler'].includes(
        scenario,
      )
    ) {
      expect(report.findings).toEqual([
        expect.objectContaining({ rule: 'interaction-checkbox-keyboard', severity: 'warning' }),
      ]);
      if (scenario === 'native-inverse-blocked')
        expect(entry).toMatchObject({
          restoration: { status: 'restored', method: 'native-property' },
        });
      if (scenario === 'custom-inverse-blocked') {
        expect(entry).toMatchObject({ restoration: { status: 'not-restored' } });
        await expect(page.locator('#field')).toHaveAttribute('aria-checked', 'true');
      }
      if (scenario === 'reset-handler') {
        expect(entry).toMatchObject({
          restoration: { status: 'not-restored', reason: 'reset-handler-changed-control' },
        });
        expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(
          1,
        );
      }
      if (scenario === 'no-handler')
        expect(entry).toMatchObject({ keysSent: 1, restoration: { status: 'unchanged' } });
    } else {
      expect(entry).toMatchObject({ status: 'unverified', keysSent: 1 });
      expect(report.findings).toEqual([]);
      if (scenario === 'focus-theft') {
        expect(entry).toMatchObject({
          restoration: { status: 'restored', method: 'native-property' },
        });
        await expect(page.locator('#after')).toBeFocused();
      } else expect(entry).toMatchObject({ restoration: { status: 'not-restored' } });
      if (scenario === 'custom-focus') {
        await expect(page.locator('#field')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#after')).toBeFocused();
      }
      if (scenario === 'value-change')
        await expect(page.locator('#field')).toHaveValue('private-new-purpose');
    }
    if (scenario === 'native')
      await page.screenshot({ path: info.outputPath('checkbox-ownership.png'), fullPage: true });
  });
}

test('checkbox guard and static candidate snapshot keep replacements out of the probe', async ({
  page,
}) => {
  await expect(inspectCheckboxes(page)).rejects.toThrow('freeze() first');
  const guard = await prepareInteractionProbe(page);
  await page.setContent('<input id="first" type="checkbox"><input id="second" type="checkbox">');
  await page.locator('#first').evaluate(el =>
    el.addEventListener('input', () => {
      const previous = document.getElementById('second')!;
      if (previous.dataset.replaced) return;
      const next = previous.cloneNode(true) as HTMLInputElement;
      next.checked = true;
      next.dataset.replaced = 'yes';
      previous.replaceWith(next);
    }),
  );
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.coverage.checkboxes[0]).toMatchObject({ restoration: { status: 'restored' } });
  expect(report.coverage.checkboxes[1]).toMatchObject({ status: 'not-probed', keysSent: 0 });
  await expect(page.locator('#second')).toBeChecked();
  await page.setContent('<input type="checkbox">'.repeat(7));
  const bounded = await inspectCheckboxes(page);
  expect(bounded.observations).toHaveLength(5);
  expect(bounded.observations.every(item => item.keysSent === 2)).toBe(true);
  // An ancestor ARIA state can disable the owned context without changing the
  // native checkbox's disabled property. Do not send another Space into it.
  await page.setContent('<label><input id="scoped" type="checkbox">Preference</label>');
  await page
    .locator('#scoped')
    .evaluate(el =>
      el.addEventListener('input', () => el.parentElement!.setAttribute('aria-disabled', 'true')),
    );
  const scoped = await inspectCheckboxes(page);
  expect(scoped.observations[0]).toMatchObject({
    status: 'unverified',
    keysSent: 1,
    restoration: { status: 'not-restored' },
  });
  await expect(page.locator('#scoped')).toBeChecked();
});
