import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectComposites } from '../tests/modern-web-composites';
import { inspectCustomAccordions } from '../tests/modern-web-accordions';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const url = 'http://127.0.0.1:45996/composites';
async function load(page: import('@playwright/test').Page, body: string) {
  const guard = await prepareInteractionProbe(page);
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Composite fixtures</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Composite fixtures</h1><button type="button" id="outside" class="rounded border p-2 focus-visible:outline-2">Outside widget</button>${body}</main></body></html>`,
    }),
  );
  await page.goto(url);
  await guard.freeze();
  return guard;
}
function bar(kind = 'toolbar', extra = '', count = 3) {
  return `<div id="bar" role="${kind}" aria-label="private-widget-label" ${extra} class="flex flex-wrap gap-2 rounded border p-2">${Array.from({ length: count }, (_, i) => `<button type="button" id="item-${i}" ${kind === 'menubar' ? 'role="menuitem" aria-haspopup="menu" aria-expanded="false"' : ''} tabindex="${i ? -1 : 0}" class="min-h-10 rounded border px-3 focus-visible:outline-2">private-command-${i}</button>`).join('')}</div>`;
}
function keys(
  options: {
    clamp?: boolean;
    root?: boolean;
    request?: boolean;
    replace?: boolean;
    skip?: boolean;
  } = {},
) {
  return `<script>
  const root=document.getElementById('bar'), items=[...root.querySelectorAll(':scope > button')];
  window.activations=0;items.forEach(item=>item.addEventListener('click',()=>window.activations++));
  root.addEventListener('keydown',event=>{
    const vertical=root.getAttribute('aria-orientation')==='vertical',rtl=getComputedStyle(root).direction==='rtl';
    const steps=vertical?{ArrowDown:1,ArrowUp:-1}:{ArrowRight:rtl?-1:1,ArrowLeft:rtl?1:-1};
    if(!(event.key in steps) && !['Home','End'].includes(event.key))return;
    event.preventDefault();
    ${options.request ? "fetch('/blocked-command',{method:'POST'}).catch(()=>{});return;" : ''}
    ${options.replace ? 'items[1].replaceWith(items[1].cloneNode(true));return;' : ''}
    const index=${options.root ? "items.findIndex(item=>item.id===root.getAttribute('aria-activedescendant'))" : 'items.indexOf(document.activeElement)'};
    let next=event.key==='Home'?0:event.key==='End'?items.length-1:index+steps[event.key]${options.skip ? '*2' : ''};
    next=${options.clamp ? 'Math.max(0,Math.min(items.length-1,next))' : '(next+items.length)%items.length'};
    ${options.root ? "root.setAttribute('aria-activedescendant',items[next].id);" : 'items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus();'}
  });</script>`;
}

const disclosure = (extra = '') =>
  `<section aria-label="Questions" class="space-y-2"><h2><button id="question" type="button" aria-expanded="false" ${extra} class="rounded border p-2 focus-visible:outline-2">private-question</button></h2><div id="answer" hidden>private-answer</div></section>`;
const disclosureScript = `<script>document.getElementById('question').addEventListener('click',event=>{const panel=document.getElementById('answer');panel.hidden=!panel.hidden;event.currentTarget.setAttribute('aria-expanded',String(!panel.hidden));});</script>`;

test('new widget probes require quarantine and ordinary navigation is out of scope', async ({
  page,
}) => {
  await page.goto('about:blank');
  await expect(inspectComposites(page)).rejects.toThrow('freeze()');
  await expect(inspectCustomAccordions(page)).rejects.toThrow('freeze()');
  await load(page, '<nav aria-label="Main"><a href="/">Home</a><a href="/about">About</a></nav>');
  expect(await inspectComposites(page)).toMatchObject({
    menubars: [],
    toolbars: [],
    findings: [],
    commandActivationAttempted: false,
  });
  expect(await inspectCustomAccordions(page)).toMatchObject({ observations: [], findings: [] });
});

for (const kind of ['menubar', 'toolbar'])
  for (const clamp of [false, true])
    test(`${kind} ${clamp ? 'clamped' : 'wrapped'} arrows preserve one entry stop and never activate commands`, async ({
      page,
    }, info) => {
      const guard = await load(page, bar(kind) + keys({ clamp }));
      await page.locator('#outside').focus();
      const report = await inspectComposites(page);
      expect(report.findings).toEqual([]);
      const observations = kind === 'menubar' ? report.menubars : report.toolbars;
      expect(observations[0]).toMatchObject({
        status: 'observed',
        moved: { active: 1 },
        restored: { active: 0 },
        boundaries: [
          { policy: clamp ? 'clamped' : 'wrapped' },
          { policy: clamp ? 'clamped' : 'wrapped' },
        ],
      });
      await expect(page.locator('#outside')).toBeFocused();
      expect(
        await page.evaluate(() => (window as unknown as { activations: number }).activations),
      ).toBe(0);
      expect(guard.counts().blockedRequests).toBe(0);
      expect(JSON.stringify(report)).not.toMatch(/private-widget-label|private-command/);
      if (kind === 'toolbar' && !clamp)
        await page.screenshot({ path: info.outputPath('composite-fixture.png'), fullPage: true });
    });

for (const extra of ['dir="rtl"', 'dir="rtl" aria-orientation="vertical"'])
  test(`toolbar orientation follows ${extra}`, async ({ page }) => {
    await load(page, bar('toolbar', extra) + keys());
    const report = await inspectComposites(page);
    expect(report.findings).toEqual([]);
    expect(report.toolbars[0]).toMatchObject({ status: 'observed', moved: { active: 1 } });
  });

for (const kind of ['toolbar', 'menubar'])
  test(`${kind} root-focus model uses author active-descendant keys`, async ({ page }) => {
    await load(
      page,
      bar(kind, 'tabindex="0" aria-activedescendant="item-0"').replace(
        'tabindex="0" class="min-h',
        'tabindex="-1" class="min-h',
      ) + keys({ root: true }),
    );
    const report = await inspectComposites(page);
    expect(report.findings).toEqual([]);
    expect((kind === 'menubar' ? report.menubars : report.toolbars)[0]).toMatchObject({
      status: 'observed',
      initial: { rootModel: true },
      moved: { active: 1 },
      restored: { active: 0 },
    });
  });

test('broken composite names, entry stops and arrow behavior produce warnings', async ({
  page,
}) => {
  await load(
    page,
    bar('menubar')
      .replace('aria-label="private-widget-label"', '')
      .replaceAll('tabindex="-1"', 'tabindex="0"')
      .replace('private-command-0', '<span hidden>Hidden label</span>'),
  );
  const report = await inspectComposites(page);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining(['widget-menubar-semantics', 'widget-menubar-keyboard']),
  );
  expect(report.findings.every(item => item.severity === 'warning')).toBe(true);
});

test('unexpected boundary skips are advisory', async ({ page }) => {
  await load(page, bar('toolbar', '', 4) + keys({ skip: true }));
  const report = await inspectComposites(page);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining(['widget-toolbar-keyboard', 'widget-toolbar-boundary']),
  );
});

test('nested menus and groups do not join the top-level item order; aria-disabled items remain reachable', async ({
  page,
}) => {
  const body = bar('menubar').replace(
    '<button type="button" id="item-1"',
    '<div role="menu" aria-label="Submenu"><button type="submit" role="menuitem" tabindex="-1">Do not invoke</button></div><button type="button" id="item-1" aria-disabled="true"',
  );
  await load(page, body + keys());
  const report = await inspectComposites(page);
  expect(report.findings).toEqual([]);
  expect(report.menubars[0]).toMatchObject({
    status: 'observed',
    initial: { count: 3 },
    moved: { active: 1 },
  });
});

test('submitters and value controls are never keyboard sampled', async ({ page }) => {
  await load(
    page,
    bar().replace('type="button" id="item-1"', 'type="submit" id="item-1"') + keys(),
  );
  const report = await inspectComposites(page);
  expect(report.toolbars[0]).toMatchObject({
    status: 'not-probed',
    reason: 'action-or-value-control',
  });
  expect(
    await page.evaluate(() => (window as unknown as { activations: number }).activations),
  ).toBe(0);
});

for (const options of [{ replace: true }, { request: true }])
  test(`composite ${options.replace ? 'replacement nodes' : 'blocked dependencies'} remain unverified`, async ({
    page,
  }) => {
    const guard = await load(page, bar() + keys(options));
    const report = await inspectComposites(page);
    expect(report.toolbars[0]).toMatchObject({ status: 'unverified' });
    expect(report.findings).toEqual([]);
    if (options.request) expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  });

test('hidden scope, active modal and large widgets are explicit exclusions', async ({ page }) => {
  await load(page, bar('toolbar', '', 22));
  const large = await inspectComposites(page);
  expect(large.toolbars[0]).toMatchObject({
    status: 'not-probed',
    initial: { itemSampleTruncated: true },
  });
  await page.locator('#bar').evaluate(el => el.setAttribute('hidden', ''));
  expect((await inspectComposites(page)).toolbars).toEqual([]);
  await page.locator('#bar').evaluate(el => el.removeAttribute('hidden'));
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.textContent = 'Active modal';
    document.body.append(dialog);
    dialog.showModal();
  });
  const modal = await inspectComposites(page);
  expect(modal.toolbars[0]).toMatchObject({
    status: 'not-probed',
    reason: 'active-modal-outside-widget',
  });
});

test('custom heading disclosures support Enter/Space without requiring aria-controls', async ({
  page,
}, info) => {
  await load(page, disclosure() + disclosureScript);
  await page.locator('#outside').focus();
  const report = await inspectCustomAccordions(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'observed',
    toggled: { expanded: 'true', panelVisible: true, focused: true },
    restored: { expanded: 'false', panelVisible: false, focused: true },
  });
  await expect(page.locator('#outside')).toBeFocused();
  expect(JSON.stringify(report)).not.toMatch(/private-question|private-answer/);
  await page.screenshot({ path: info.outputPath('custom-accordion-fixture.png'), fullPage: true });
});

test('broken custom disclosures report stale state and keyboard failures', async ({ page }) => {
  await load(page, disclosure().replace('id="answer" hidden', 'id="answer"'));
  const report = await inspectCustomAccordions(page);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining([
      'widget-custom-accordion-semantics',
      'widget-custom-accordion-keyboard',
    ]),
  );
});

test('custom disclosures exclude submitters, popup triggers, disabled policies and ambiguous targets', async ({
  page,
}) => {
  for (const replacement of [
    'type="submit"',
    'type="button" aria-disabled="true"',
    'type="button" aria-haspopup="menu"',
    'type="button" aria-controls="missing"',
  ]) {
    await load(page, disclosure().replace('type="button"', replacement) + disclosureScript);
    const report = await inspectCustomAccordions(page);
    expect(report.observations[0]).toMatchObject({ status: 'not-probed' });
  }
});

test('custom disclosure replacement and blocked validation work remain unverified', async ({
  page,
}) => {
  const guard = await load(
    page,
    disclosure() +
      `<script>document.getElementById('question').addEventListener('click',()=>{fetch('/save',{method:'POST'}).catch(()=>{});});</script>`,
  );
  const report = await inspectCustomAccordions(page);
  expect(report.observations[0]).toMatchObject({
    status: 'unverified',
    reason: 'dependent-work-blocked',
  });
  expect(report.findings).toEqual([]);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
});

test('toolbar groups share one arrow sequence and hidden ancestors are outside scope', async ({
  page,
}) => {
  await load(
    page,
    bar()
      .replace(
        '<button type="button" id="item-1"',
        '<div role="group" aria-label="View"><button type="button" id="item-1"',
      )
      .replace('</div>', '</div></div>') +
      `<script>
    const root=document.getElementById('bar'),items=[...root.querySelectorAll('button')];
    root.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft'].includes(event.key))return;event.preventDefault();const index=items.indexOf(document.activeElement),next=(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus();});</script>`,
  );
  const report = await inspectComposites(page);
  expect(report.findings).toEqual([]);
  expect(report.toolbars[0]).toMatchObject({ status: 'observed', initial: { count: 3 } });
  await page
    .locator('#bar')
    .evaluate(el => ((el as HTMLElement).style.contentVisibility = 'hidden'));
  const hidden = await inspectComposites(page);
  expect(hidden.findings).toEqual([]);
  expect(hidden.toolbars.every(item => item.status === 'not-probed')).toBe(true);
});

test('native focusgroup toolbars are observed without demanding authored roving tabindex', async ({
  page,
}) => {
  await load(
    page,
    bar('toolbar', 'focusgroup="toolbar wrap"').replaceAll('tabindex="-1"', 'tabindex="0"'),
  );
  const native = await page.evaluate(() => 'focusGroup' in HTMLElement.prototype);
  const report = await inspectComposites(page);
  if (native) {
    expect(report.findings).toEqual([]);
    expect(report.toolbars[0]).toMatchObject({
      status: 'observed',
      initial: { nativeFocusgroup: true },
      moved: { active: 1 },
    });
  } else {
    expect(report.findings.map(item => item.rule)).toContain('widget-toolbar-keyboard');
    expect(report.findings.map(item => item.rule)).toContain('widget-toolbar-semantics');
  }
});

test('menubar preview opens on focus and closes on focus return without invoking actions', async ({
  page,
}) => {
  await load(
    page,
    bar('menubar') +
      keys() +
      `<script>
    document.querySelectorAll('[role="menubar"] > button').forEach(button=>{
      button.addEventListener('focus',()=>button.setAttribute('aria-expanded','true'));
      button.addEventListener('blur',()=>button.setAttribute('aria-expanded','false'));
    });</script>`,
  );
  await page.locator('#outside').focus();
  const report = await inspectComposites(page);
  expect(report.findings).toEqual([]);
  expect(report.menubars[0]).toMatchObject({
    status: 'observed',
    afterFocusReturn: { expanded: [false, false, false] },
  });
});

test('sample limits are explicit and custom disclosure replacement is never operated', async ({
  page,
}) => {
  await load(
    page,
    Array.from({ length: 7 }, (_, i) => bar().replace('id="bar"', `id="bar-${i}"`)).join('') +
      disclosure() +
      `<script>
    document.getElementById('question').addEventListener('focus',event=>event.currentTarget.replaceWith(event.currentTarget.cloneNode(true)));
    </script>`,
  );
  const report = await inspectComposites(page);
  expect(report.toolbars).toHaveLength(5);
  expect(report).toMatchObject({ candidateCount: 7, sampleTruncated: true });
  const accordion = await inspectCustomAccordions(page);
  expect(accordion.observations[0]).toMatchObject({ status: 'unverified' });
  expect(accordion.activationAttempts).toBe(0);
});

test('custom disclosure names exclude CSS-hidden text while explicit hidden labels remain valid', async ({
  page,
}) => {
  await load(
    page,
    disclosure().replace('private-question', '<span class="hidden">private-hidden-name</span>') +
      disclosureScript,
  );
  const hidden = await inspectCustomAccordions(page);
  expect(hidden.findings.map(item => item.rule)).toContain('widget-custom-accordion-semantics');
  await page.locator('#question').evaluate(el => el.setAttribute('aria-label', 'Question'));
  expect((await inspectCustomAccordions(page)).findings).toEqual([]);
});

test('conflicting authored panel targets and undeclared commands are not activated', async ({
  page,
}) => {
  await load(
    page,
    disclosure('aria-controls="answer" commandfor="other" command="--toggle"') +
      '<div id="other" hidden>Other panel</div>' +
      disclosureScript,
  );
  expect((await inspectCustomAccordions(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'ambiguous-panel-association',
  });
  await page.locator('#question').evaluate(el => {
    el.removeAttribute('commandfor');
    el.setAttribute('command', '--other-action');
  });
  expect((await inspectCustomAccordions(page)).activationAttempts).toBe(0);
});

test('long local disclosure animations remain unverified rather than failing a latency threshold', async ({
  page,
}) => {
  await load(
    page,
    disclosure() +
      disclosureScript +
      `<script>document.getElementById('question').addEventListener('click',()=>document.getElementById('answer').animate([{opacity:0.4},{opacity:1}],{duration:2000}));</script>`,
  );
  const report = await inspectCustomAccordions(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'unverified',
    reason: 'transition-still-running',
  });
});

test('always-open custom policy changes stop further activation and sample limits stay explicit', async ({
  page,
}) => {
  await load(
    page,
    disclosure() +
      `<script>document.getElementById('question').addEventListener('click',event=>{document.getElementById('answer').hidden=false;event.currentTarget.setAttribute('aria-expanded','true');event.currentTarget.setAttribute('aria-disabled','true');});</script>`,
  );
  const changed = await inspectCustomAccordions(page);
  expect(changed.observations[0]).toMatchObject({ status: 'unverified' });
  expect(changed.activationAttempts).toBe(1);
  await load(
    page,
    Array.from({ length: 6 }, (_, i) =>
      disclosure().replaceAll('question', `question-${i}`).replaceAll('answer', `answer-${i}`),
    ).join(''),
  );
  const bounded = await inspectCustomAccordions(page);
  expect(bounded).toMatchObject({ candidateCount: 6, sampleTruncated: true, limit: 5 });
  expect(bounded.observations).toHaveLength(5);
});

test('native name fallbacks and explicit hidden label references avoid false missing-name advisories', async ({
  page,
}) => {
  await load(
    page,
    bar()
      .replace('id="item-0"', 'id="item-0" aria-labelledby="missing"')
      .replace('id="item-1"', 'id="item-1" aria-label=""') +
      keys() +
      disclosure('aria-labelledby="hidden-label"') +
      '<span id="hidden-label" hidden>Private label</span>' +
      disclosureScript,
  );
  expect((await inspectComposites(page)).findings).toEqual([]);
  expect((await inspectCustomAccordions(page)).findings).toEqual([]);
});

test('focus-return rerenders invalidate composite evidence without adopting replacement controls', async ({
  page,
}) => {
  await load(
    page,
    bar() +
      keys() +
      `<script>
    let entered=false;document.getElementById('bar').addEventListener('focusin',()=>entered=true);
    document.getElementById('outside').addEventListener('focus',()=>{if(entered){const root=document.getElementById('bar');root.replaceWith(root.cloneNode(true));entered=false;}});
    </script>`,
  );
  await page.locator('#outside').focus();
  const report = await inspectComposites(page);
  expect(report.toolbars[0]).toMatchObject({ status: 'unverified' });
  expect(report.findings).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { activations: number }).activations),
  ).toBe(0);
});
