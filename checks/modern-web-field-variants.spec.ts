// Sources: forms keyboard testing + field sizing's fixed/internal-scroll fallback.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// End reachability is not bidi visual order, grapheme/IME or OS keyboard proof.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectFieldContent } from '../tests/modern-web-field-content';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const variant of ['rtl', 'bidi', 'input'] as const)
  for (const scenario of [
    'native',
    'blocked',
    'prefilled',
    'readonly',
    'value-change',
    'focus-theft',
    'name-change',
    'network',
    'reset-handler',
  ]) {
    test(`field variant ${variant}: ${scenario}`, async ({ page }, info) => {
      let writes = 0;
      await page.context().route('**/*', route => {
        if (route.request().method() !== 'GET') writes++;
        const attrs = `id="field" name="message" ${scenario === 'readonly' ? 'readonly' : ''} class="block w-48 max-w-full overflow-auto rounded border p-2"`;
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editing variants</title><style>${css}</style><body class="bg-white text-slate-900"><main ${variant === 'rtl' ? 'dir="rtl"' : ''} class="space-y-4 p-4"><h1>Editing variants</h1><button type="button" id="before">Before</button><label for="field">Message</label>${variant === 'input' ? `<input type="text" ${attrs} value="${scenario === 'prefilled' ? 'private-authored-value' : ''}">` : `<textarea wrap="off" rows="2" ${attrs}>${scenario === 'prefilled' ? 'private-authored-value' : ''}</textarea>`}<button type="button" id="after">After</button></main><script>
          const field=document.getElementById('field'),scenario=${JSON.stringify(scenario)};
          window.keys=0;
          field.addEventListener('input',()=>{
            if(scenario==='value-change')field.value='private-authored-value';
            if(scenario==='name-change')field.name='private-authored-purpose';
            if(scenario==='network')fetch('/write',{method:'POST'}).catch(()=>{});
            if(scenario==='reset-handler'&&!field.value)field.value='private-authored-value';
          });
          field.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft'].includes(event.key))return;window.keys++;
            if(scenario==='blocked')event.preventDefault();
            if(scenario==='focus-theft')document.getElementById('after').focus();
          });
        </script></body></html>`,
        });
      });
      const guard = await prepareInteractionProbe(page);
      await page.goto('http://127.0.0.1:45996/field-variants');
      await page.locator('#before').focus();
      await guard.freeze();
      const result = await inspectFieldContent(page, 'horizontal', variant);
      const observation = result.observations[0];
      expect(writes).toBe(0);
      expect(result).toMatchObject({
        mutationLimit: 1,
        variant,
        graphemeAndVisualOrderVerified: false,
        imeVerified: false,
        applicationResetVerified: false,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /private-authored-value|private-authored-purpose|abcdefghij|אבגדה|مرحبا/,
      );
      expect(
        await page.evaluate(() => (window as unknown as { keys: number }).keys),
      ).toBeLessThanOrEqual(result.keyLimit);
      if (scenario === 'native') {
        expect(observation, JSON.stringify(observation)).toMatchObject({
          status: 'observed',
          caretAtEnd: true,
          tailInScrollport: true,
          overflow: true,
          restoration: { status: 'restored' },
        });
        expect(result.findings).toEqual([]);
        await expect(page.locator('#before')).toBeFocused();
        await expect(page.locator('#field')).toHaveValue('');
      } else if (scenario === 'blocked') {
        expect(result.findings).toEqual([
          expect.objectContaining({
            rule: `field-content-${variant === 'input' ? 'input' : variant}-navigation`,
            severity: 'warning',
          }),
        ]);
        expect(observation).toMatchObject({
          status: 'observed',
          keyboard: { seen: true, cancelled: true },
          restoration: { status: 'restored' },
        });
      } else if (['prefilled', 'readonly'].includes(scenario)) {
        expect(observation).toMatchObject({
          status: 'not-probed',
          restoration: { status: 'unchanged' },
        });
        expect(result.probes).toBe(0);
      } else if (scenario === 'reset-handler') {
        expect(observation).toMatchObject({
          status: 'observed',
          restoration: { status: 'not-restored' },
        });
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
      } else {
        expect(observation).toMatchObject({ status: 'unverified' });
        expect(result.findings).toEqual([]);
        if (scenario === 'value-change')
          await expect(page.locator('#field')).toHaveValue('private-authored-value');
        if (scenario === 'name-change')
          expect(observation.restoration).toMatchObject({ status: 'not-restored' });
        if (scenario === 'focus-theft') await expect(page.locator('#after')).toBeFocused();
        if (scenario === 'network') expect(guard.counts().blockedRequests).toBeGreaterThan(0);
      }
      if (scenario === 'native' && ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name))
        await page.screenshot({ path: info.outputPath('field-variant.png'), fullPage: true });
    });
  }

for (const variant of ['rtl', 'bidi', 'input'] as const)
  test(`field variant mutation budget: ${variant}`, async ({ page }) => {
    const control = (id: string) =>
      variant === 'input'
        ? `<input type="text" id="${id}" class="block w-48 rounded border p-2">`
        : `<textarea wrap="off" id="${id}" class="block w-48 rounded border p-2"></textarea>`;
    await page
      .context()
      .route('**/*', route =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mutation budget</title><style>${css}</style><body><main ${variant === 'rtl' ? 'dir="rtl"' : ''}>${control('first')}${control('second')}<script>window.secondInputs=0;document.getElementById('second').addEventListener('input',()=>window.secondInputs++);</script></main></body></html>`,
        }),
      );
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/mutation-budget');
    await guard.freeze();
    const result = await inspectFieldContent(page, 'horizontal', variant);
    expect(result.probes).toBe(1);
    expect(result.observations[0]).toMatchObject({
      status: 'observed',
      restoration: { status: 'restored' },
    });
    expect(result.observations[1]).toMatchObject({
      status: 'not-probed',
      reason: 'mutation-limit',
      restoration: { status: 'unchanged' },
    });
    expect(
      await page.evaluate(() => (window as unknown as { secondInputs: number }).secondInputs),
    ).toBe(0);
  });
