// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/select-menu-interaction.md
// Observe native validation/change/blur feedback. Exact select/option ownership
// and compare-and-restore are repository safety policy; never export values/text.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectInteractions, prepareInteractionProbe } from '../tests/modern-web-interactions';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'ordinary',
  'prefilled',
  'input-choice',
  'change-choice',
  'blur-choice',
  'invalid-choice',
  'option-reorder',
  'option-replace',
  'option-value',
  'option-label',
  'default-selection',
  'disabled',
  'optgroup-disabled',
  'select-replace',
  'focus-theft',
  'opens-modal',
  'reset-input',
  'reset-change',
  'no-selection',
  'option-limit',
  'option-limit-boundary',
  'no-candidate',
]) {
  test(`required select ownership: ${scenario}`, async ({ page }, info) => {
    let writes = 0;
    await page.context().route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Select ownership fixture</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Selection feedback</h1><form><label for="field" class="block">Country</label><select id="field" required ${scenario === 'input-choice' ? 'aria-invalid="true"' : ''} class="w-full rounded border p-2"><option value="" disabled selected>Choose</option><optgroup label="Local choices"><option value="private-a">Private first choice</option><option value="private-b">Private other choice</option></optgroup>${['option-limit', 'option-limit-boundary'].includes(scenario) ? '<option value="private-extra">Extra</option>'.repeat(scenario === 'option-limit' ? 510 : 509) : ''}</select><button id="after" type="button" class="mt-4 rounded border p-2">Next</button></form><dialog id="modal"><p>Local confirmation</p><button type="button">Continue</button></dialog></main><script>
      const field=document.getElementById('field'),scenario=${JSON.stringify(scenario)};
      window.original=field;window.inputs=0;window.changes=0;
      if(scenario==='prefilled')field.value='private-b';
      if(scenario==='no-selection')field.selectedIndex=-1;
      if(scenario==='no-candidate'){field.options[1].disabled=true;field.options[2].disabled=true;}
      const authored=()=>field.value='private-b';
      field.addEventListener('input',()=>{
        window.inputs++;
        if(scenario==='input-choice')authored();
        if(scenario==='option-reorder')field.appendChild(field.options[0]);
        if(scenario==='option-replace'){const next=field.options[1].cloneNode(true);field.options[1].replaceWith(next);field.selectedIndex=1;}
        if(scenario==='option-value')field.options[1].value='private-mutated';
        if(scenario==='option-label')field.options[1].label='Private changed label';
        if(scenario==='default-selection')field.options[1].defaultSelected=true;
        if(scenario==='disabled')field.disabled=true;
        if(scenario==='opens-modal')document.getElementById('modal').showModal();
        if(scenario==='optgroup-disabled')field.querySelector('optgroup').disabled=true;
        if(scenario==='select-replace'){const next=field.cloneNode(true);next.value='private-b';field.replaceWith(next);}
        if(scenario==='reset-input'&&!field.value)authored();
        fetch('/write',{method:'POST'}).catch(()=>{});
      });
      field.addEventListener('change',()=>{window.changes++;if(scenario==='change-choice')authored();if(scenario==='focus-theft')document.getElementById('after').focus();if(scenario==='reset-change'&&!field.value)authored();});
      if(scenario==='blur-choice')field.addEventListener('blur',authored);
      if(scenario==='invalid-choice')field.addEventListener('invalid',authored);
      </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/select-ownership');
    await guard.freeze();
    const report = await inspectInteractions(page);
    const entry = report.coverage.selects[0];
    expect(writes).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(
      /private-a|private-b|private-mutated|Private changed label|Private first choice/,
    );
    expect(report.coverage.selectOptionOwnershipLimit).toBe(512);
    if (['ordinary', 'no-selection', 'option-limit-boundary'].includes(scenario)) {
      expect(entry).toMatchObject({ status: 'observed', restoration: { status: 'restored' } });
      await expect(page.locator('#field')).toHaveValue('');
      if (scenario === 'no-selection')
        expect(
          await page.locator('#field').evaluate((el: HTMLSelectElement) => el.selectedIndex),
        ).toBe(-1);
      expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    } else if (scenario === 'prefilled') {
      expect(entry).toMatchObject({ status: 'not-probed', reason: 'prefilled-select' });
      await expect(page.locator('#field')).toHaveValue('private-b');
    } else if (scenario === 'option-limit' || scenario === 'no-candidate') {
      expect(entry).toMatchObject({
        status: 'unverified',
        reason:
          scenario === 'option-limit' ? 'option-ownership-limit' : 'no-enabled-nonempty-option',
      });
      expect(await page.evaluate(() => (window as unknown as { inputs: number }).inputs)).toBe(0);
    } else if (scenario === 'reset-input' || scenario === 'reset-change') {
      expect(entry).toMatchObject({
        status: 'observed',
        restoration: { status: 'not-restored', reason: 'reset-handler-changed-control' },
      });
      await expect(page.locator('#field')).toHaveValue('private-b');
      expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(
        scenario === 'reset-input' ? 1 : 2,
      );
    } else {
      expect(entry).toMatchObject({ status: 'unverified' });
      expect(report.findings).toEqual([]);
      if (scenario === 'focus-theft') {
        expect(entry).toMatchObject({ restoration: { status: 'restored' } });
        await expect(page.locator('#after')).toBeFocused();
      } else {
        expect(entry).toMatchObject({ restoration: { status: 'not-restored' } });
        await expect(page.locator('#field')).toHaveValue(
          [
            'input-choice',
            'change-choice',
            'blur-choice',
            'invalid-choice',
            'select-replace',
          ].includes(scenario)
            ? 'private-b'
            : scenario === 'option-value'
              ? 'private-mutated'
              : 'private-a',
        );
      }
      expect(await page.evaluate(() => (window as unknown as { inputs: number }).inputs)).toBe(
        scenario === 'invalid-choice' ? 0 : scenario === 'focus-theft' ? 2 : 1,
      );
    }
    if (scenario === 'ordinary')
      await page.screenshot({ path: info.outputPath('select-ownership.png'), fullPage: true });
  });
}

test('select candidate cap and following rerender preserve retained owners', async ({ page }) => {
  const guard = await prepareInteractionProbe(page);
  const field = (id: string) =>
    `<label for="${id}">Country</label><select id="${id}" required><option value="" disabled selected>Choose</option><option value="private-a">First</option><option value="private-b">Other</option></select>`;
  await page.setContent(Array.from({ length: 6 }, (_, i) => field('field-' + i)).join(''));
  await guard.freeze();
  const bounded = await inspectInteractions(page);
  expect(bounded.coverage.selects).toHaveLength(5);
  expect(bounded.coverage.selects.every(select => select.status === 'observed')).toBe(true);
  await expect(page.locator('#field-5')).toHaveValue('');
  await page.setContent(field('first') + field('second'));
  await page.locator('#first').evaluate(el =>
    el.addEventListener('change', () => {
      if (!(el as HTMLSelectElement).value) return;
      const previous = document.getElementById('second')!;
      const replacement = previous.cloneNode(true) as HTMLSelectElement;
      replacement.value = 'private-b';
      previous.replaceWith(replacement);
    }),
  );
  const report = await inspectInteractions(page);
  expect(report.coverage.selects).toHaveLength(2);
  expect(report.coverage.selects[0]).toMatchObject({
    status: 'observed',
    restoration: { status: 'restored' },
  });
  expect(report.coverage.selects[1]).toMatchObject({
    status: 'unverified',
    restoration: { status: 'not-restored' },
  });
  await expect(page.locator('#second')).toHaveValue('private-b');
  expect(JSON.stringify(report)).not.toContain('private-b');
});
