import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectComposites } from '../tests/modern-web-composites';
import { inspectMenuNavigation } from '../tests/modern-web-menu-navigation';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const url = 'http://127.0.0.1:45996/menu-navigation';
// Text inputs supply ordinary outside Tab targets even when a browser/OS skips native buttons.
async function load(page: import('@playwright/test').Page, body: string) {
  const guard = await prepareInteractionProbe(page);
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Keyboard navigation fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Keyboard navigation</h1><label for="before" class="block">Before</label><input id="before" type="text" class="w-28 rounded border p-2 focus-visible:outline-2">${body}<label for="after" class="block">After</label><input id="after" type="text" class="w-28 rounded border p-2 focus-visible:outline-2"></main></body></html>`,
    }),
  );
  await page.goto(url);
  await guard.freeze();
  return guard;
}
const command =
  'class="min-h-10 rounded border border-slate-500 bg-white px-3 py-2 focus-visible:outline-2"';
function menuFixture(
  options: {
    rtl?: boolean;
    native?: boolean;
    trapTab?: boolean;
    badEntry?: boolean;
    badClose?: boolean;
    rootClose?: boolean;
    request?: boolean;
    replace?: boolean;
    nestedSubmit?: boolean;
    noSubmenu?: boolean;
  } = {},
) {
  return `<button type="button" id="top" aria-haspopup="menu" aria-expanded="false" aria-controls="menu" ${command}>private-tools-label</button>
  <div id="menu" role="menu" aria-label="private-menu-label" ${options.rtl ? 'dir="rtl"' : ''} ${options.native ? 'popover="auto"' : 'hidden'} class="fixed left-4 top-40 z-10 m-0 max-w-[calc(100vw-2rem)] space-y-2 rounded border border-slate-500 bg-white p-3 shadow-lg">
    <button type="button" id="first" role="menuitem" tabindex="-1" ${command}>private-command</button>
    ${
      options.noSubmenu
        ? ''
        : `<button type="button" id="nested" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-controls="child" ${command}>private-export-label</button>
    <div id="child" role="menu" aria-label="private-child-label" ${options.native ? 'popover="auto"' : 'hidden'} class="fixed left-6 top-64 z-20 m-0 max-w-[calc(100vw-3rem)] space-y-2 rounded border border-slate-500 bg-white p-3 shadow-lg"><button type="button" id="leaf" role="menuitem" tabindex="-1" ${command}>private-leaf</button></div>`
    }
    <button type="button" id="last" role="menuitem" tabindex="-1" ${command}>Last command</button>
  </div><script>
  const topButton=document.getElementById('top'),menu=document.getElementById('menu'),nested=document.getElementById('nested'),child=document.getElementById('child');
  window.activations=0;window.nestedArrows=0;
  document.querySelectorAll('[role="menuitem"]').forEach(item=>item.addEventListener('click',()=>window.activations++));
  const show=(target,trigger,open)=>{if(!target)return;if(target.hasAttribute('popover') && typeof target.showPopover==='function'){if(open)target.showPopover();else target.hidePopover();}else target.hidden=!open;trigger.setAttribute('aria-expanded',String(open));};
  const closeAll=()=>{if(child)show(child,nested,false);show(menu,topButton,false);};
  topButton.addEventListener('keydown',event=>{if(event.key!=='ArrowDown')return;event.preventDefault();${options.request ? "fetch('/blocked-menu',{method:'POST'}).catch(()=>{});return;" : ''}show(menu,topButton,true);${options.badEntry ? '' : "document.getElementById('first').focus();"}});
  ${options.replace ? "topButton.addEventListener('focus',()=>menu.replaceWith(menu.cloneNode(true)));" : ''}
  if(nested){
    ${options.nestedSubmit ? "nested.addEventListener('focus',()=>nested.type='submit');" : ''}
    nested.addEventListener('keydown',event=>{if(event.key!==${JSON.stringify(options.rtl ? 'ArrowLeft' : 'ArrowRight')})return;window.nestedArrows++;event.preventDefault();event.stopPropagation();show(child,nested,true);document.getElementById('leaf').focus();});
    child.addEventListener('keydown',event=>{
      if(!['Escape',${JSON.stringify(options.rtl ? 'ArrowRight' : 'ArrowLeft')}].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      ${options.badClose ? 'closeAll();topButton.focus();' : `show(child,nested,false);nested.focus();`}
    });
  }
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAll();${options.rootClose ? '' : 'topButton.focus();'}}
    if(event.key==='Tab'){event.preventDefault();${options.trapTab ? "document.getElementById('last').focus();" : "closeAll();document.getElementById(event.shiftKey?'before':'after').focus();"}}
  });
  </script>`;
}
function composite(kind: 'menubar' | 'toolbar', broken = false, rootModel = false) {
  return `<div id="bar" role="${kind}" aria-label="Preview commands" ${rootModel ? 'tabindex="0" aria-activedescendant="one"' : ''} class="flex flex-wrap gap-2 rounded border p-2"><button type="button" id="one" ${kind === 'menubar' ? 'role="menuitem"' : ''} tabindex="${rootModel ? -1 : 0}" ${command}>First</button><button type="button" id="two" ${kind === 'menubar' ? 'role="menuitem"' : ''} tabindex="-1" ${command}>Second</button></div><script>
  const bar=document.getElementById('bar'),items=[...bar.querySelectorAll('button')];window.activations=0;
  items.forEach(item=>item.addEventListener('click',()=>window.activations++));
  bar.addEventListener('keydown',event=>{
    if(event.key==='Tab' && ${broken}){event.preventDefault();items[1].focus();return;}
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();
    const index=${rootModel ? "items.findIndex(item=>item.id===bar.getAttribute('aria-activedescendant'))" : 'items.indexOf(document.activeElement)'},next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
    ${rootModel ? "bar.setAttribute('aria-activedescendant',items[next].id);" : 'items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus();'}
  });</script>`;
}

test('menu navigation requires quarantine and absent menus are an empty scope', async ({
  page,
}) => {
  await page.goto('about:blank');
  await expect(inspectMenuNavigation(page)).rejects.toThrow('freeze()');
  await load(page, '<nav><a href="/">Ordinary navigation</a></nav>');
  expect(await inspectMenuNavigation(page)).toMatchObject({
    observations: [],
    findings: [],
    commandActivationAttempted: false,
  });
});

for (const kind of ['toolbar', 'menubar'] as const)
  for (const rootModel of [false, true])
    test(`${kind} ${rootModel ? 'root' : 'roving'} focus leaves and reenters with real Tab and Shift+Tab`, async ({
      page,
    }) => {
      await load(page, composite(kind, false, rootModel));
      await page.locator('#before').focus();
      await page.keyboard.press('Tab');
      const nativeEntry = await page
        .locator('#bar')
        .evaluate(root => root.contains(document.activeElement));
      const report = await inspectComposites(page);
      expect(report.findings).toEqual([]);
      if (nativeEntry) {
        expect((kind === 'toolbar' ? report.toolbars : report.menubars)[0]).toMatchObject({
          tabTraversal: {
            status: 'observed',
            steps: [
              { key: 'Tab', outside: { outsideRendered: true }, returned: { entryControl: true } },
              {
                key: 'Shift+Tab',
                outside: { outsideRendered: true },
                returned: { entryControl: true },
              },
            ],
          },
        });
      } else {
        expect((kind === 'toolbar' ? report.toolbars : report.menubars)[0]).toMatchObject({
          tabTraversal: {
            status: 'unverified',
            sequentialEntryObserved: false,
            steps: [
              { outside: { browserOrDocumentFocus: true } },
              { outside: { browserOrDocumentFocus: true } },
            ],
          },
        });
      }
      expect(
        await page.evaluate(() => (window as unknown as { activations: number }).activations),
      ).toBe(0);
    });
for (const kind of ['toolbar', 'menubar'] as const)
  test(`${kind} Tab trap is advisory without invoking a command`, async ({ page }) => {
    await load(page, composite(kind, true));
    const report = await inspectComposites(page);
    expect(report.findings.map(item => item.rule)).toContain(`widget-${kind}-tab-exit`);
    expect(report.findings.every(item => item.severity === 'warning')).toBe(true);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
  });
for (const options of [{}, { rtl: true }, { native: true }, { noSubmenu: true }])
  test(`menu keyboard entry, level dismissal and Tab exit ${JSON.stringify(options)}`, async ({
    page,
  }, info) => {
    const guard = await load(page, menuFixture(options));
    await page.locator('#before').focus();
    const report = await inspectMenuNavigation(page);
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      status: 'observed',
      entered: { visible: true, focusInside: true },
      rootDismiss: { closed: { visible: false, triggerFocused: true } },
      tabExit: {
        status: 'observed',
        exited: { visible: false, systemFocus: false, effectiveFocusVisible: true },
      },
    });
    if (!options.noSubmenu)
      expect(report.observations[0]).toMatchObject({
        submenus: [
          {
            closeKey: 'Escape',
            parentVisible: true,
            closed: { visible: false, triggerFocused: true },
          },
          { parentVisible: true, closed: { visible: false, triggerFocused: true } },
        ],
      });
    expect(JSON.stringify(report)).not.toMatch(
      /private-tools-label|private-menu-label|private-child-label|private-leaf|private-command/,
    );
    expect(guard.counts().blockedRequests).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
    if (options.native) {
      await page.locator('#top').focus();
      await page.keyboard.press('ArrowDown');
      await page.screenshot({ path: info.outputPath('menu-keyboard-fixture.png'), fullPage: true });
    }
  });
for (const [options, rule] of [
  [{ badEntry: true }, 'menu-keyboard-entry'],
  [{ badClose: true }, 'menu-submenu-dismiss'],
  [{ trapTab: true }, 'menu-tab-exit'],
  [{ rootClose: true }, 'menu-dismiss-focus'],
] as const)
  test(`broken menu behavior reports ${rule}`, async ({ page }) => {
    await load(page, menuFixture(options));
    const report = await inspectMenuNavigation(page);
    expect(report.findings.map(item => item.rule)).toContain(rule);
    expect(report.findings.every(item => item.severity === 'warning')).toBe(true);
  });
for (const options of [{ request: true }, { replace: true }, { nestedSubmit: true }])
  test(`menu unsafe/dependent state stays unverified ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const guard = await load(page, menuFixture(options));
    const report = await inspectMenuNavigation(page);
    expect(report.observations[0]).toMatchObject({ status: 'unverified' });
    expect(report.findings).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
    if (options.request) expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    if (options.nestedSubmit)
      expect(
        await page.evaluate(() => (window as unknown as { nestedArrows: number }).nestedArrows),
      ).toBe(0);
  });

test('submitters, ambiguous targets and unrelated active modals are never entered', async ({
  page,
}) => {
  await load(page, menuFixture().replace('type="button" id="top"', 'type="submit" id="top"'));
  expect((await inspectMenuNavigation(page)).observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.locator('#top').evaluate(el => {
    (el as HTMLButtonElement).type = 'button';
    el.setAttribute('commandfor', 'child');
  });
  expect((await inspectMenuNavigation(page)).observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.locator('#top').evaluate(el => el.removeAttribute('commandfor'));
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.textContent = 'Unrelated dialog';
    document.body.append(dialog);
    dialog.showModal();
  });
  expect((await inspectMenuNavigation(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'active-modal-outside-menu',
  });
});

test('inverse Tab that skips the composite produces an entry advisory', async ({ page }) => {
  await load(
    page,
    composite('toolbar') +
      `<script>
      document.getElementById('bar').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();document.getElementById(event.shiftKey?'before':'after').focus();}});
      document.addEventListener('keydown',event=>{if(event.key!=='Tab')return;if(event.target.id==='after' && event.shiftKey){event.preventDefault();document.getElementById('before').focus();}else if(event.target.id==='before' && !event.shiftKey){event.preventDefault();document.getElementById('one').focus();}});</script>`,
  );
  const report = await inspectComposites(page);
  expect(report.findings.map(item => item.rule)).toContain('widget-toolbar-tab-entry');
});

test('blocked Tab handlers suppress dependent composite verdicts', async ({ page }) => {
  const guard = await load(
    page,
    composite('toolbar') +
      `<script>document.getElementById('bar').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();fetch('/blocked-tab',{method:'POST'}).catch(()=>{});}});</script>`,
  );
  const report = await inspectComposites(page);
  expect(report.findings).toEqual([]);
  expect(report.toolbars[0]).toMatchObject({
    status: 'unverified',
    tabTraversal: { status: 'unverified', reason: 'dependent-work-blocked' },
  });
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
});

test('missing submenu name is advisory while destination links are never followed', async ({
  page,
}) => {
  const guard = await load(
    page,
    menuFixture()
      .replace('aria-label="private-child-label"', '')
      .replace(
        '<button type="button" id="leaf" role="menuitem" tabindex="-1"',
        '<a href="/never-follow" id="leaf" role="menuitem" tabindex="-1"',
      )
      .replace('>private-leaf</button>', '>private-leaf</a>'),
  );
  const report = await inspectMenuNavigation(page);
  expect(report.findings.map(item => item.rule)).toContain('menu-submenu-semantics');
  expect(guard.counts().blockedRequests).toBe(0);
  expect(page.url()).toBe(url);
});

test('initial open menus are left alone and menu sample limits are explicit', async ({ page }) => {
  await load(page, menuFixture());
  await page.locator('#top').focus();
  await page.keyboard.press('ArrowDown');
  expect((await inspectMenuNavigation(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'initially-open-menu',
  });
  await expect(page.locator('#menu')).toBeVisible();
  await load(
    page,
    Array.from(
      { length: 6 },
      (_, i) =>
        `<button type="button" aria-haspopup="menu" aria-controls="sample-${i}">Menu</button><div id="sample-${i}" role="menu" aria-label="Commands" hidden><button type="button" role="menuitem">Command</button></div>`,
    ).join(''),
  );
  const bounded = await inspectMenuNavigation(page);
  expect(bounded).toMatchObject({ candidateCount: 6, sampleTruncated: true, limit: 5 });
  expect(bounded.observations).toHaveLength(5);
});

test('large opened menus stop before submenu commands and retain truncation evidence', async ({
  page,
}) => {
  await load(
    page,
    menuFixture().replace(
      '<button type="button" id="last"',
      Array.from(
        { length: 22 },
        () => '<button type="button" role="menuitem" tabindex="-1">Extra command</button>',
      ).join('') + '<button type="button" id="last"',
    ),
  );
  const report = await inspectMenuNavigation(page);
  expect(report.observations[0]).toMatchObject({ status: 'not-probed', itemSampleTruncated: true });
  expect(
    await page.evaluate(() => (window as unknown as { activations: number }).activations),
  ).toBe(0);
});

test('iframe focus after menu exit is explicitly unverified', async ({ page }) => {
  await load(
    page,
    menuFixture() +
      `<iframe id="external-frame" title="Local empty focus surface" src="about:blank"></iframe><script>document.addEventListener('keydown',event=>{if(event.key==='Tab' && event.target.closest('[role="menu"]'))document.getElementById('external-frame').focus();});</script>`,
  );
  const report = await inspectMenuNavigation(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    tabExit: { status: 'unverified', exited: { unsupportedFocus: true } },
  });
});

test('portal submenu ownership is excluded without inventing a hierarchy contract', async ({
  page,
}) => {
  await load(page, menuFixture());
  await page.locator('#child').evaluate(el => document.body.append(el));
  const report = await inspectMenuNavigation(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    submenus: [{ status: 'not-probed', reason: 'portal-submenu-ownership-unverified' }],
  });
});

test('missing sequential entry in both directions remains unverified without a calibrated entry path', async ({
  page,
}) => {
  await load(
    page,
    composite('toolbar') +
      `<script>
 document.getElementById('bar').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();document.getElementById(event.shiftKey?'before':'after').focus();}});
 document.addEventListener('keydown',event=>{if(event.key==='Tab' && ['before','after'].includes(event.target.id)){event.preventDefault();document.getElementById(event.target.id==='before'?'after':'before').focus();}});
 </script>`,
  );
  const report = await inspectComposites(page);
  expect(report.findings).toEqual([]);
  expect(report.toolbars[0]).toMatchObject({
    tabTraversal: {
      status: 'unverified',
      sequentialEntryObserved: false,
      steps: [
        { reason: 'sequential-entry-policy-unverified' },
        { reason: 'sequential-entry-policy-unverified' },
      ],
    },
  });
});

test('vertical menubar entry does not inherit a horizontal menu-button key contract', async ({
  page,
}) => {
  await load(
    page,
    `<div role="menubar" aria-label="Vertical commands" aria-orientation="vertical">${menuFixture()}</div>`,
  );
  const report = await inspectMenuNavigation(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'vertical-menubar-entry-contract-unverified',
  });
  expect(
    await page.evaluate(() => (window as unknown as { activations: number }).activations),
  ).toBe(0);
});
