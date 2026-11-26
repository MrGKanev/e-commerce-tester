// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// Native horizontal caret scrolling and authored equivalents are accepted. Scope
// is explicit wrap=off LTR; do not rewrite merchant wrapping or expose field data.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe, inspectInteractions } from '../tests/modern-web-interactions';
import { inspectHorizontalFieldContent } from '../tests/modern-web-field-content';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'native',
  'hidden-overflow',
  'field-sizing',
  'blocked',
  'equivalent',
  'prefilled',
  'maxlength',
  'maxlength-boundary',
  'readonly',
  'inert',
  'rtl',
  'replacement',
  'input-value',
  'focus-theft',
  'network',
  'key-network',
  'geometry-change',
  'wrap-change',
  'reset-handler',
]) {
  test(`horizontal field content: ${scenario}`, async ({ page }, info) => {
    let writes = 0;
    await page.context().route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Horizontal field fixture</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-xl space-y-4 p-4"><h1 class="text-2xl font-bold">Long line editing</h1><button id="before" type="button" class="rounded border p-2">Before field</button><label for="field" class="block">Message</label><textarea id="field" wrap="off" rows="2" ${scenario === 'maxlength' ? 'maxlength="79"' : scenario === 'maxlength-boundary' ? 'maxlength="80"' : ''} ${scenario === 'readonly' ? 'readonly' : ''} ${scenario === 'inert' ? 'inert' : ''} ${scenario === 'rtl' ? 'dir="rtl"' : ''} class="block w-48 max-w-full resize-y rounded border p-2 ${scenario === 'hidden-overflow' ? 'overflow-hidden' : 'overflow-auto'} ${scenario === 'field-sizing' ? 'field-sizing-content' : ''}">${scenario === 'prefilled' ? 'private-authored-value' : ''}</textarea><button id="after" type="button" class="rounded border p-2">After field</button></main><script>
        const field=document.getElementById('field'),scenario=${JSON.stringify(scenario)};
        window.inputs=0;window.keys=0;
        field.addEventListener('input',()=>{
          window.inputs++;
          if(scenario==='replacement'&&field.value){const replacement=field.cloneNode();replacement.value='private-authored-value';field.replaceWith(replacement);}
          if(scenario==='input-value')field.value='private-authored-value';
          if(scenario==='network')fetch('/write',{method:'POST'}).catch(()=>{});
          if(scenario==='reset-handler'&&!field.value)field.value='private-authored-value';
        });
        field.addEventListener('keydown',event=>{
          if(event.key!=='ArrowRight')return;window.keys++;
          if(scenario==='blocked')event.preventDefault();
          if(scenario==='equivalent'){event.preventDefault();field.setSelectionRange(field.value.length,field.value.length);field.scrollLeft=field.scrollWidth;}
          if(scenario==='focus-theft')document.getElementById('after').focus();
          if(scenario==='key-network'){event.preventDefault();fetch('/key-write',{method:'POST'}).catch(()=>{});}
          if(scenario==='geometry-change')field.classList.replace('w-48','w-24');
          if(scenario==='wrap-change')field.wrap='soft';
        });
      </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/horizontal-field');
    await page.locator('#before').focus();
    await guard.freeze();
    const result = await inspectHorizontalFieldContent(page);
    const observation = result.observations[0];
    expect(writes).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/private-authored-value|abcdefghij/);
    expect(result).toMatchObject({
      axis: 'horizontal',
      sampleCharacters: 80,
      keyLimit: 82,
      parentClippingVerified: false,
      applicationResetVerified: false,
    });
    expect(
      await page.evaluate(() => (window as unknown as { keys: number }).keys),
    ).toBeLessThanOrEqual(82);
    if (
      ['native', 'hidden-overflow', 'field-sizing', 'equivalent', 'maxlength-boundary'].includes(
        scenario,
      )
    ) {
      expect(observation, JSON.stringify(observation)).toMatchObject({
        status: 'observed',
        caretAtEnd: true,
        tailInScrollport: true,
        overflow: true,
        restoration: { status: 'restored' },
      });
      expect(result.findings).toEqual([]);
      await expect(page.locator('#field')).toHaveValue('');
      await expect(page.locator('#before')).toBeFocused();
    } else if (['prefilled', 'maxlength', 'readonly', 'inert', 'rtl'].includes(scenario)) {
      expect(observation).toMatchObject({
        status: 'not-probed',
        restoration: { status: 'unchanged' },
      });
      expect(await page.evaluate(() => (window as unknown as { inputs: number }).inputs)).toBe(0);
      expect(result.findings).toEqual([]);
      if (scenario === 'prefilled')
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else if (scenario === 'blocked') {
      expect(result.findings).toEqual([
        expect.objectContaining({
          rule: 'field-content-horizontal-navigation',
          severity: 'warning',
        }),
      ]);
      expect(observation).toMatchObject({
        status: 'observed',
        caretAtEnd: false,
        keyboard: { seen: true, cancelled: true },
        restoration: { status: 'restored' },
      });
    } else if (scenario === 'reset-handler') {
      expect(observation).toMatchObject({
        status: 'observed',
        restoration: { status: 'not-restored' },
      });
      await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else {
      expect(observation).toMatchObject({ status: 'unverified' });
      expect(result.findings).toEqual([]);
      if (scenario === 'replacement' || scenario === 'input-value')
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
      if (scenario === 'focus-theft') await expect(page.locator('#after')).toBeFocused();
      if (scenario === 'network' || scenario === 'key-network')
        expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    }
    if (scenario === 'native')
      await page.screenshot({ path: info.outputPath('horizontal-field.png'), fullPage: true });
  });
}

test('horizontal field guard, candidate cap, soft-wrap and shadow exclusions', async ({ page }) => {
  await expect(inspectHorizontalFieldContent(page)).rejects.toThrow('freeze() first');
  const guard = await prepareInteractionProbe(page);
  await page.setContent('<textarea></textarea><div id="host"></div>');
  await page.locator('#host').evaluate(el => {
    el.attachShadow({ mode: 'open' }).innerHTML = '<textarea wrap="off"></textarea>';
  });
  await guard.freeze();
  const excluded = await inspectHorizontalFieldContent(page);
  expect(excluded.observations).toHaveLength(1);
  expect(excluded.observations[0]).toMatchObject({
    status: 'not-probed',
    restoration: { status: 'unchanged' },
  });
  await page.setContent('<textarea wrap="off"></textarea>'.repeat(7));
  const result = await inspectHorizontalFieldContent(page);
  expect(result.observations).toHaveLength(5);
  expect(result.limit).toBe(5);
  expect(result.findings).toEqual([]);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('shared interactions serialize horizontal advisory with retained cleanup', async ({
  page,
}, info) => {
  await page.context().route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><title>Integration</title><body><label for="field">Message</label><textarea id="field" wrap="off"></textarea><script>document.getElementById('field').addEventListener('keydown',event=>{if(event.key==='ArrowRight')event.preventDefault();});</script></body></html>`,
    }),
  );
  const guard = await prepareInteractionProbe(page);
  await page.goto('http://127.0.0.1:45996/horizontal-integration');
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: 'field-content-horizontal-navigation' }),
    ]),
  );
  expect(report.coverage.horizontalFieldContent.observations[0]).toMatchObject({
    restoration: { status: 'restored' },
  });
  await info.attach('horizontal-interactions.json', {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
  expect(JSON.stringify(report)).not.toContain('abcdefghij');
});
