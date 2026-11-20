import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectWidgets } from '../tests/modern-web-widgets';

const url = 'http://127.0.0.1:45996/widgets';
const fixture = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Widget fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Widgets</h1>${body}</main></body></html>`;

const tabs = `<div role="tablist" aria-label="Details" id="tabs">
  <button type="button" id="first" role="tab" aria-selected="true" tabindex="0">First</button>
  <button type="button" id="second" role="tab" aria-selected="false" tabindex="-1">Second</button>
</div><section role="tabpanel" aria-labelledby="first">First panel</section><section role="tabpanel" aria-labelledby="second" hidden>Second panel</section>`;

const goodTabScript = (manual = false) => `<script>
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const select = tab => { tabs.forEach((item, i) => { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; panels[i].hidden = item !== tab; }); };
  tabs.forEach((tab, index) => { tab.addEventListener('click', () => select(tab)); tab.addEventListener('keydown', event => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; next.focus(); ${manual ? '' : 'select(next);'} }); });
</script>`;

async function load(page: Parameters<typeof prepareInteractionProbe>[0], body: string) {
  const guard = await prepareInteractionProbe(page);
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: fixture(body) }));
  await page.goto(url);
  await guard.freeze();
  return guard;
}

test('widget interactions reject an unfrozen page', async ({ page }) => {
  await page.goto('about:blank');
  await expect(inspectWidgets(page)).rejects.toThrow('freeze()');
});

test('absent optional widgets are explicit empty samples', async ({ page }) => {
  await load(page, '<p>Ordinary page without optional widgets.</p>');
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({
    tabs: [],
    accordions: [],
    switches: [],
    sliders: [],
    perCategoryLimit: 5,
  });
});

for (const manual of [false, true]) {
  test(`valid ${manual ? 'manual' : 'automatic'} tabs, native disclosures and form controls remain operable`, async ({
    page,
  }) => {
    const guard = await load(
      page,
      `${tabs}${goodTabScript(manual)}
      <section aria-label="Questions"><details id="disclosure"><summary>Shipping</summary><p>Shipping details</p></details></section>
      <label for="switch">Enable notifications</label><input type="checkbox" switch id="switch">
      <label for="range">Volume</label><input type="range" id="range" min="0" max="10" value="4">`,
    );
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.tabs[0]).toMatchObject({
      status: 'observed',
      moved: { active: 1 },
      activated: { selected: [false, true] },
      restored: { selected: [true, false] },
    });
    expect(report.coverage.accordions[0]).toMatchObject({
      status: 'observed',
      toggled: true,
      restored: false,
    });
    await expect(page.locator('#switch')).not.toBeChecked();
    await expect(page.locator('#range')).toHaveValue('4');
    expect(guard.counts().blockedRequests).toBe(0);
  });
}

test('broken declared widgets produce guide-specific advisories', async ({ page }) => {
  await load(
    page,
    `${tabs.replace('aria-label="Details"', '').replace('tabindex="-1"', 'tabindex="0"')}
    <details id="disclosure"><summary><h2>Heading inside summary</h2></summary><p>Details</p></details>
    <div id="switch" role="switch" tabindex="0"><span aria-hidden="true">Visual switch</span></div>
    <div id="slider" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5">Volume</div>
    <script>document.querySelector('summary').addEventListener('click', event => event.preventDefault());</script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings.map(finding => finding.rule)).toEqual(
    expect.arrayContaining([
      'widget-tabs-semantics',
      'widget-tabs-keyboard',
      'widget-accordion-summary',
      'widget-accordion-keyboard',
      'widget-switch-semantics',
      'widget-switch-keyboard',
      'widget-slider-semantics',
      'widget-slider-keyboard',
    ]),
  );
  expect(report.findings.every(finding => finding.severity === 'warning')).toBe(true);
});

test('custom switch and slider expose keyboard state and restore', async ({ page }) => {
  await load(
    page,
    `<button type="button" id="switch" role="switch" aria-checked="false" aria-label="Notifications">Toggle</button>
    <div id="slider" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5">Volume</div>
    <script>
      document.querySelector('#switch').addEventListener('click', event => event.currentTarget.setAttribute('aria-checked', event.currentTarget.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
      document.querySelector('#slider').addEventListener('keydown', event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return; event.preventDefault(); event.currentTarget.setAttribute('aria-valuenow', String(Number(event.currentTarget.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 1 : -1))); });
    </script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  await expect(page.locator('#switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#slider')).toHaveAttribute('aria-valuenow', '5');
});

test('submitter tabs and disabled disclosure policies are not activated', async ({ page }) => {
  await load(
    page,
    `${tabs.replaceAll('type="button"', 'type="submit"')}<details open><summary aria-disabled="true">Always open</summary><p>Content</p></details>`,
  );
  const report = await inspectWidgets(page);
  expect(report.coverage.tabs[0]).toMatchObject({ status: 'not-probed' });
  expect(report.coverage.accordions[0]).toMatchObject({
    status: 'not-probed',
    reason: 'declared-disabled-or-always-open-policy',
  });
});

test('exclusive details restore previously open sibling and bounded samples', async ({ page }) => {
  await load(
    page,
    `<details name="faq" id="one" open><summary>One</summary><p>First</p></details><details name="faq" id="two"><summary>Two</summary><p>Second</p></details>
    ${Array.from({ length: 6 }, (_, index) => `<label>Switch ${index}<input type="checkbox" switch></label>`).join('')}`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches).toHaveLength(5);
  await expect(page.locator('#one')).toHaveAttribute('open', '');
  await expect(page.locator('#two')).not.toHaveAttribute('open', '');
});

test('hidden disabled and nested tab candidates never redirect the keyboard sample', async ({
  page,
}) => {
  await load(
    page,
    `${tabs.replace('<button type="button" id="first"', '<button type="submit" role="tab" disabled>Disabled</button><button type="submit" role="tab" hidden>Hidden</button><button type="button" id="first"')}${goodTabScript(false).replace('querySelectorAll(\'[role="tab"]\')', 'querySelectorAll(\'[role="tab"]:not(:disabled):not([hidden])\')')}`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.tabs[0]).toMatchObject({
    status: 'observed',
    initial: { count: 2 },
    moved: { active: 1 },
  });
});

test('ARIA slider defaults and switch names from content are accepted; singleton range steps stay unverified', async ({
  page,
}) => {
  await load(
    page,
    `<div id="named-switch" role="switch" tabindex="0" aria-checked="false"><span>Notifications</span></div>
    <div id="default-slider" role="slider" tabindex="0" aria-label="Volume" aria-valuenow="50">Volume</div>
    <label>Singleton<input type="range" min="0" max="10" step="20" value="0"></label>
    <script>
      document.querySelector('#named-switch').addEventListener('keydown', event => { if (event.key === ' ') { event.preventDefault(); event.currentTarget.setAttribute('aria-checked', String(event.currentTarget.getAttribute('aria-checked') !== 'true')); } });
      document.querySelector('#default-slider').addEventListener('keydown', event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); event.currentTarget.setAttribute('aria-valuenow', String(Number(event.currentTarget.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 1 : -1))); } });
    </script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.sliders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: 'not-probed', reason: 'no-distinct-native-step-in-range' }),
    ]),
  );
});

test('RTL native ranges at the lower bound remain operable and input submitter switches are skipped', async ({
  page,
}) => {
  await load(
    page,
    '<label>RTL range<input dir="rtl" type="range" min="0" max="10" value="0"></label><input type="submit" role="switch" aria-label="Unsafe submitter" aria-checked="false" value="Submit">',
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.switches[0]).toMatchObject({
    status: 'not-probed',
    reason: 'submit-button',
  });
  expect(report.coverage.sliders[0]).toMatchObject({ status: 'observed', restored: { value: 0 } });
});

for (const manual of [false, true]) {
  test(`root-focus ${manual ? 'manual' : 'automatic'} tabs receive root keys and restore selection`, async ({
    page,
  }) => {
    await load(
      page,
      `${tabs}<script>
      const list=document.getElementById('tabs'),items=[...list.children],panels=[...document.querySelectorAll('[role="tabpanel"]')];
      list.tabIndex=0;list.setAttribute('aria-activedescendant','first');items.forEach(item=>item.tabIndex=-1);
      const select=()=>{const id=list.getAttribute('aria-activedescendant');items.forEach((item,index)=>{item.setAttribute('aria-selected',String(item.id===id));panels[index].hidden=item.id!==id;});};
      list.addEventListener('keydown',event=>{
        if(event.target!==list)throw new Error('Keys must target the root');
        let index=items.findIndex(item=>item.id===list.getAttribute('aria-activedescendant'));
        if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
          event.preventDefault();index=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
          list.setAttribute('aria-activedescendant',items[index].id);${manual ? '' : 'select();'}
        }
        if(event.key==='Enter')select();
      });
    </script>`,
    );
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.tabs[0]).toMatchObject({
      status: 'observed',
      rootFocusModel: true,
      moved: { active: 1 },
      activated: { selected: [false, true] },
      restored: { selected: [true, false], active: 0 },
    });
    await expect(page.locator('#tabs')).toBeFocused();
  });
}

for (const mode of ['clamped', 'wrapped', 'disabled-skip', 'vertical', 'rtl'] as const) {
  test(`tab boundary samples accept ${mode} navigation`, async ({ page }) => {
    const markup =
      tabs.replace(
        '</div>',
        '<button type="button" id="third" role="tab" aria-selected="false" tabindex="-1">Third</button></div>',
      ) + '<section role="tabpanel" aria-labelledby="third" hidden>Third panel</section>';
    await load(
      page,
      `${markup}<script>
      const list=document.getElementById('tabs'),items=[...list.children],panels=[...document.querySelectorAll('[role="tabpanel"]')];
      ${mode === 'disabled-skip' ? 'items[1].disabled=true;' : ''}
      ${mode === 'vertical' ? "list.setAttribute('aria-orientation','vertical');" : ''}
      ${mode === 'rtl' ? "list.dir='rtl';" : ''}
      const enabled=items.filter(item=>!item.disabled);
      const select=tab=>items.forEach((item,index)=>{item.setAttribute('aria-selected',String(item===tab));item.tabIndex=item===tab?0:-1;panels[index].hidden=item!==tab;});
      const forward=${JSON.stringify(mode === 'vertical' ? 'ArrowDown' : mode === 'rtl' ? 'ArrowLeft' : 'ArrowRight')},backward=${JSON.stringify(mode === 'vertical' ? 'ArrowUp' : mode === 'rtl' ? 'ArrowRight' : 'ArrowLeft')};
      enabled.forEach(tab=>tab.addEventListener('click',()=>select(tab)));
      enabled.forEach((tab,index)=>tab.addEventListener('keydown',event=>{
        if(![forward,backward,'Home','End'].includes(event.key))return;
        event.preventDefault();let next=event.key==='Home'?0:event.key==='End'?enabled.length-1:index+(event.key===forward?1:-1);
        next=${mode === 'clamped' ? 'Math.max(0,Math.min(enabled.length-1,next))' : '(next+enabled.length)%enabled.length'};
        enabled[next].focus();select(enabled[next]);
      }));
    </script>`,
    );
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.tabs[0]).toMatchObject({ status: 'observed', restored: { active: 0 } });
    const boundaries = report.coverage.tabs[0].boundaries as Array<Record<string, unknown>>;
    expect(boundaries).toHaveLength(2);
    expect(
      boundaries.every(sample => sample.policy === (mode === 'clamped' ? 'clamped' : 'wrapped')),
    ).toBe(true);
  });
}

test('unsupported optional Home/End shortcuts do not fail valid tabs', async ({ page }) => {
  await load(
    page,
    `${tabs}${goodTabScript().replace("['ArrowRight', 'ArrowLeft', 'Home', 'End']", "['ArrowRight', 'ArrowLeft']")}`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.tabs[0]).toMatchObject({ status: 'observed' });
});

for (const replacement of ['tabs', 'panels'] as const) {
  test(`replaced ${replacement} invalidate keyboard evidence without activating replacement controls`, async ({
    page,
  }) => {
    await load(
      page,
      `${tabs}<script>
      window.replacementActivations=0;
      document.getElementById('first').addEventListener('keydown',event=>{
        if(event.key!=='ArrowRight')return;
        const original=${replacement === 'tabs' ? "document.getElementById('second')" : "document.querySelector('[role=tabpanel]')"};
        const clone=original.cloneNode(true);original.replaceWith(clone);
        clone.addEventListener('click',()=>window.replacementActivations++);
      });
    </script>`,
    );
    const report = await inspectWidgets(page);
    expect(report.coverage.tabs[0]).toMatchObject({
      status: 'unverified',
      reason: 'widget-changed-or-dependent-work-blocked',
    });
    expect(report.findings).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { replacementActivations: number }).replacementActivations,
      ),
    ).toBe(0);
  });
}

test('root-focus submitter tabs are never activated', async ({ page }) => {
  await load(
    page,
    `${tabs.replaceAll('type="button"', 'type="submit"')}<script>const list=document.getElementById('tabs');list.tabIndex=0;list.setAttribute('aria-activedescendant','first');[...list.children].forEach(item=>item.tabIndex=-1);window.keys=0;list.addEventListener('keydown',()=>window.keys++);</script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.coverage.tabs[0]).toMatchObject({ status: 'not-probed' });
  expect(await page.evaluate(() => (window as unknown as { keys: number }).keys)).toBe(0);
});

for (const trigger of ['focus', 'arrow'] as const) {
  test(`tab becoming a submitter on ${trigger} is never activated`, async ({ page }) => {
    await load(
      page,
      `${tabs}<script>
      window.activations=0;
      const second=document.getElementById('second');second.addEventListener('click',()=>window.activations++);
      ${trigger === 'focus' ? "second.addEventListener('focus',()=>second.type='submit');" : ''}
      document.getElementById('first').addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();${trigger === 'arrow' ? "second.type='submit';" : ''}second.focus();}});
    </script>`,
    );
    const report = await inspectWidgets(page);
    expect(report.findings).toEqual([]);
    expect(report.coverage.tabs[0]).toMatchObject({ status: 'unverified' });
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
  });
}

test('stale active descendant cannot credit keyboard movement after root focus is stolen', async ({
  page,
}) => {
  await load(
    page,
    `${tabs}<button type="button" id="outside">Outside</button><script>
    const list=document.getElementById('tabs');list.tabIndex=0;list.setAttribute('aria-activedescendant','first');[...list.children].forEach(item=>item.tabIndex=-1);
    list.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){list.setAttribute('aria-activedescendant','second');document.getElementById('outside').focus();}});
  </script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.tabs[0]).toMatchObject({ status: 'unverified' });
});

test('tab network-dependent activation stays unverified and all requests remain quarantined', async ({
  page,
}) => {
  const guard = await load(
    page,
    `${tabs}<script>
    document.getElementById('first').addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();document.getElementById('second').focus();fetch('/dependent-panel').catch(()=>{});}});
  </script>`,
  );
  const report = await inspectWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.tabs[0]).toMatchObject({
    status: 'unverified',
    reason: 'widget-changed-or-dependent-work-blocked',
  });
  expect(guard.counts().blockedRequests).toBe(1);
});
