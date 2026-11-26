// Source: form-fields-automatically-fit-contents, fallback strategies:
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// Both native scrolling and authored growth/editing equivalents are acceptable.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectFieldContent } from '../tests/modern-web-field-content';
// Keep native caret/line-box geometry comparable across OS fallback fonts.
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'native',
  'hidden-overflow',
  'grow',
  'field-sizing',
  'blocked',
  'equivalent',
  'prefilled',
  'maxlength',
  'readonly',
  'inert',
  'replacement',
  'focus-theft',
  'network',
  'reset-handler',
]) {
  test(`textarea long content: ${scenario}`, async ({ page }, info) => {
    let writes = 0;
    await page.context().route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local field content</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Message editing</h1><button id="before" type="button" class="rounded border p-2">Before field</button><label class="block" for="field">Message</label><textarea id="field" rows="2" ${scenario === 'maxlength' ? 'maxlength="10"' : ''} ${scenario === 'readonly' ? 'readonly' : ''} ${scenario === 'inert' ? 'inert' : ''} class="block w-full max-w-full resize-y rounded border p-2 leading-tight ${scenario === 'field-sizing' ? 'field-sizing-content min-h-16 max-h-64' : ''} ${scenario === 'hidden-overflow' ? 'overflow-hidden' : 'overflow-auto'}">${scenario === 'prefilled' ? 'private-authored-value' : ''}</textarea><button id="after" type="button" class="rounded border p-2">After field</button></main><script>
      const field=document.getElementById('field'), scenario=${JSON.stringify(scenario)};
      field.addEventListener('input',()=>{
        if(scenario==='grow') field.rows=Math.max(2,field.value.split('\\n').length+1);
        if(scenario==='replacement' && field.value){const next=field.cloneNode();next.value='private-authored-value';field.replaceWith(next);}
        if(scenario==='network')fetch('/write',{method:'POST'}).catch(()=>{});
        if(scenario==='reset-handler'&&!field.value) field.value='private-authored-value';
      });
      field.addEventListener('keydown',event=>{
        if(event.key!=='ArrowDown')return;
        if(scenario==='blocked')event.preventDefault();
        if(scenario==='focus-theft')document.getElementById('after').focus();
        if(scenario==='equivalent'){event.preventDefault();field.setSelectionRange(field.value.length,field.value.length);field.scrollTop=field.scrollHeight;}
      });
      </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/field-content');
    await page.locator('#before').focus();
    await guard.freeze();
    const result = await inspectFieldContent(page);
    const observation = result.observations[0];
    expect(writes).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/private-authored-value|Probe line/);
    if (['native', 'hidden-overflow', 'grow', 'field-sizing', 'equivalent'].includes(scenario)) {
      expect(observation.tailInScrollport, JSON.stringify(observation)).toBe(true);
      expect(observation).toMatchObject({
        status: 'observed',
        caretAtEnd: true,
        tailInScrollport: true,
        restoration: { status: 'restored' },
      });
      expect(result.findings).toEqual([]);
      await expect(page.locator('#field')).toHaveValue('');
      await expect(page.locator('#before')).toBeFocused();
      if (scenario === 'native' || scenario === 'hidden-overflow')
        expect(observation.overflow).toBe(true);
      if (scenario === 'grow') expect(observation.overflow).toBe(false);
    } else if (['prefilled', 'maxlength', 'readonly', 'inert'].includes(scenario)) {
      expect(observation).toMatchObject({
        status: 'not-probed',
        restoration: { status: 'unchanged' },
      });
      expect(result.findings).toEqual([]);
      if (scenario === 'prefilled')
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else if (scenario === 'blocked') {
      expect(result.findings).toEqual([
        expect.objectContaining({ rule: 'field-content-arrow-navigation', severity: 'warning' }),
      ]);
      expect(observation).toMatchObject({
        status: 'observed',
        caretAtEnd: false,
        keyboard: { seen: true, cancelled: true },
      });
    } else if (scenario === 'reset-handler') {
      expect(observation).toMatchObject({ restoration: { status: 'not-restored' } });
      await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else {
      expect(observation).toMatchObject({ status: 'unverified' });
      expect(result.findings).toEqual([]);
      if (scenario === 'replacement')
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
      if (scenario === 'focus-theft') await expect(page.locator('#after')).toBeFocused();
      if (scenario === 'network') expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    }
    if (scenario === 'native')
      await page.screenshot({ path: info.outputPath('field-content.png'), fullPage: true });
  });
}
test('textarea content requires guard and bounds candidate sampling', async ({ page }) => {
  await expect(inspectFieldContent(page)).rejects.toThrow('freeze() first');
  const guard = await prepareInteractionProbe(page);
  await page.setContent('<textarea></textarea>'.repeat(7));
  await guard.freeze();
  const result = await inspectFieldContent(page);
  expect(result.observations).toHaveLength(5);
  expect(result.limit).toBe(5);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(result.successfulSubmissionAttempted).toBe(false);
});
