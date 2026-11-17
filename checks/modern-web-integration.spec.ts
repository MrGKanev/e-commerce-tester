import { inspectDialogScroll } from '../tests/modern-web-dialog-scroll';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectModernWeb, attachModernWeb } from '../tests/modern-web';
import { prepareInteractionProbe, inspectInteractions } from '../tests/modern-web-interactions';
import { inspectWidgets } from '../tests/modern-web-widgets';
import { inspectPresentation } from '../tests/modern-web-presentation';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const platform of ['shopify', 'woocommerce'])
  test(`${platform} combined probes keep one visit, block writes and attach each evidence family`, async ({
    page,
  }, info) => {
    let navigations = 0,
      writes = 0;
    await page.context().route('**/*', route => {
      if (route.request().isNavigationRequest()) navigations++;
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><title>Local ${platform} probe integration</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-6 p-4 sm:p-8"><h1 class="text-2xl font-bold">Local store fixture</h1><p>Combined store observations</p><form class="space-y-3"><label class="block" for="country">Country</label><select id="country" required aria-invalid="false" class="w-full rounded border border-slate-500 p-2"><option value="">Choose</option><option value="bg">Bulgaria</option></select><p id="error" hidden>Choose a country.</p><div id="announcer" aria-live="polite"></div></form><details class="rounded border border-slate-300 p-3"><summary>Delivery details</summary><p>Local delivery information.</p></details><label class="flex gap-2"><input id="switch" type="checkbox" role="switch">Show details</label><label class="block" for="range">Quantity preview</label><input id="range" type="range" min="0" max="10" value="4" class="w-full"></main><script>
      const country=document.getElementById('country'),error=document.getElementById('error');
      const sync=()=>{const invalid=!country.validity.valid;country.setAttribute('aria-invalid',String(invalid));error.hidden=!invalid;if(invalid)country.setAttribute('aria-describedby','error');else country.removeAttribute('aria-describedby');};
      country.addEventListener('invalid',sync);country.addEventListener('change',()=>{sync();fetch('/save',{method:'POST'}).catch(()=>{});fetch('/unsafe-get?change=1').catch(()=>{});});
      </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    const response = await page.goto(`http://127.0.0.1:45996/${platform}`);
    const passive = await inspectModernWeb(page, await response?.allHeaders());
    await attachModernWeb(passive, info);
    await guard.freeze();
    const dialogScroll = await inspectDialogScroll(page);
    await attachModernWeb(dialogScroll, info, 'modern-web-dialog-scroll');
    const interactions = await inspectInteractions(page);
    await attachModernWeb(interactions, info, 'modern-web-interactions');
    const widgets = await inspectWidgets(page);
    await attachModernWeb(widgets, info, 'modern-web-widgets');
    const presentation = await inspectPresentation(page);
    await attachModernWeb(presentation, info, 'modern-web-presentation');
    expect(navigations).toBe(1);
    expect(writes).toBe(0);
    expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    expect(passive.documentPolicies.responseHeadersObserved).toBe(true);
    expect(passive.formPurposes.autofillBehaviorVerified).toBe(false);
    expect(passive.resilience.passive).toBe(true);
    expect(passive.components.closedRootsUnobservable).toBe(true);
    expect(dialogScroll.coverage.applicable).toBe(false);
    expect(interactions.coverage.selects[0]).toMatchObject({ status: 'observed' });
    expect(widgets.coverage.accordions).toHaveLength(1);
    expect(info.attachments.map(item => item.name)).toEqual(
      expect.arrayContaining([
        'modern-web.json',
        'modern-web-interactions.json',
        'modern-web-widgets.json',
        'modern-web-presentation.json',
        'modern-web-dialog-scroll.json',
      ]),
    );
    await expect(page.locator('#country')).toHaveValue('');
    await expect(page.locator('#switch')).not.toBeChecked();
    await page.screenshot({ path: info.outputPath('combined-probe-fixture.png'), fullPage: true });
  });
