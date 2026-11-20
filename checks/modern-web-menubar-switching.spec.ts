import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectMenubarSwitching } from '../tests/modern-web-menubar-switching';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const url = 'http://127.0.0.1:45996/menubar-switching';
type Options = {
  native?: boolean;
  rtl?: boolean;
  cold?: boolean;
  hoverBroken?: boolean;
  keyboardBroken?: boolean;
  stealFocus?: boolean;
  staleExpanded?: boolean;
  request?: boolean;
  replace?: boolean;
  submit?: boolean;
};
function fixture(options: Options = {}) {
  return `<div id="bar" role="menubar" aria-label="private-command-bar" ${options.rtl ? 'dir="rtl"' : ''} class="flex w-fit flex-wrap rounded border border-slate-500 bg-white">
 ${[0, 1].map(i => `<button id="trigger-${i}" type="${options.submit && i === 1 ? 'submit' : 'button'}" role="menuitem" aria-haspopup="menu" aria-controls="menu-${i}" aria-expanded="false" tabindex="${i ? -1 : 0}" class="min-h-10 border-transparent px-4 py-2 hover:bg-slate-100 focus-visible:outline-2">private-menu-${i}</button><div id="menu-${i}" role="menu" aria-label="private-popup-${i}" ${options.native ? 'popover="auto"' : 'hidden'} class="fixed left-[var(--menu-left)] top-[var(--menu-top)] z-10 m-0 min-w-36 max-w-[calc(100vw-2rem)] rounded border border-slate-500 bg-white p-2 shadow-lg"><button type="button" role="menuitem" tabindex="-1" class="min-h-10 rounded px-3 py-2 focus-visible:outline-2">private-command-${i}</button></div>`).join('')}
 </div><script>(()=>{
 const bar=document.getElementById('bar'),buttons=[...bar.querySelectorAll(':scope > button')],menus=[...bar.querySelectorAll(':scope > [role="menu"]')];let active=-1,ignoreFocus=false;
 window.activations=0;window.switchKeys=0;menus.forEach(menu=>menu.querySelector('button').addEventListener('click',()=>window.activations++));
 menus.forEach(menu=>{if(menu.hasAttribute('popover')&&typeof menu.showPopover!=='function'){menu.removeAttribute('popover');menu.hidden=true;}});
 const closeAll=()=>{menus.forEach((menu,i)=>{if(menu.hasAttribute('popover'))menu.hidePopover();else menu.hidden=true;buttons[i].setAttribute('aria-expanded','false');});active=-1;};
 const show=index=>{closeAll();const rect=buttons[index].getBoundingClientRect(),menu=menus[index];menu.style.setProperty('--menu-left',Math.max(8,Math.min(rect.left,innerWidth-160))+'px');menu.style.setProperty('--menu-top',(rect.bottom+4)+'px');if(menu.hasAttribute('popover'))menu.showPopover();else menu.hidden=false;buttons[index].setAttribute('aria-expanded','true');active=index;};
 const preview=index=>{show(index);buttons.forEach((button,i)=>button.tabIndex=i===index?0:-1);buttons[index].focus();};
 buttons.forEach((button,index)=>{
 button.addEventListener('focus',()=>{if(!ignoreFocus)show(index);});
 button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();show(index);menus[index].querySelector('button').focus();}});
 button.addEventListener('pointerenter',()=>{
   if(active<0){${options.cold ? 'preview(index);' : ''}return;}
   ${options.hoverBroken ? 'return;' : ''}
   ${options.request ? "fetch('/blocked-hover',{method:'POST'}).catch(()=>{});return;" : ''}
   ${options.replace ? 'buttons[0].replaceWith(buttons[0].cloneNode(true));return;' : ''}
   preview(index);
   ${options.stealFocus ? "menus[index].querySelector('button').focus();" : ''}
   ${options.staleExpanded ? "button.setAttribute('aria-expanded','false');" : ''}
 });
 menus[index].addEventListener('keydown',event=>{
   if(event.key===${JSON.stringify(options.rtl ? 'ArrowLeft' : 'ArrowRight')}){event.preventDefault();event.stopPropagation();window.switchKeys++;${options.keyboardBroken ? 'return;' : ''}preview(1-index);}
 });
 });
 bar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();const previous=active;closeAll();if(previous>=0){ignoreFocus=true;buttons[previous].focus();ignoreFocus=false;}}});
 document.addEventListener('focusin',event=>{if(!bar.contains(event.target))closeAll();});
 })();</script>`;
}
async function load(page: import('@playwright/test').Page, body: string) {
  const guard = await prepareInteractionProbe(page);
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Menubar switching fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Menubar switching</h1><label for="outside" class="block">Outside menu system</label><input id="outside" class="w-32 rounded border p-2 focus-visible:outline-2">${body}</main></body></html>`,
    }),
  );
  await page.goto(url);
  await guard.freeze();
  await page.locator('#outside').focus();
  return guard;
}

test('switching requires quarantine and ordinary navigation remains out of scope', async ({
  page,
}) => {
  await page.goto('about:blank');
  await expect(inspectMenubarSwitching(page)).rejects.toThrow('freeze()');
  await load(page, '<nav><a href="/">Home</a></nav>');
  expect(await inspectMenubarSwitching(page)).toMatchObject({
    observations: [],
    findings: [],
    pointerClicksAttempted: false,
    commandActivationAttempted: false,
  });
});

for (const options of [{}, { native: true }, { rtl: true }])
  test(`keyboard and fine-hover switching remain reversible ${JSON.stringify(options)}`, async ({
    page,
  }, info) => {
    const guard = await load(page, fixture(options));
    const report = await inspectMenubarSwitching(page);
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      status: 'observed',
      keyboard: { status: 'observed', switched: { matched: true } },
      restoration: { closed: true },
    });
    if (report.hoverSupported)
      expect(report.observations[0]).toMatchObject({
        pointer: {
          status: 'observed',
          cold: { matched: true, sameFocus: true },
          forward: { matched: true },
          backward: { matched: true },
        },
      });
    else
      expect(report.observations[0]).toMatchObject({
        pointer: { status: 'not-probed', reason: 'no-fine-hover-pointer' },
      });
    expect(guard.counts().blockedRequests).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
    await expect(page.locator('#outside')).toBeFocused();
    expect(JSON.stringify(report)).not.toMatch(/private-command-bar|private-popup|private-command/);
    if (options.native) {
      await page.locator('#trigger-0').focus();
      await page.keyboard.press('ArrowDown');
      await page.screenshot({
        path: info.outputPath('menubar-switching-fixture.png'),
        fullPage: true,
      });
    }
  });
for (const [options, rule] of [
  [{ keyboardBroken: true }, 'menubar-keyboard-switch'],
  [{ cold: true }, 'menubar-hover-closed'],
  [{ hoverBroken: true }, 'menubar-hover-switch'],
  [{ stealFocus: true }, 'menubar-hover-switch'],
  [{ staleExpanded: true }, 'menubar-switch-expanded-state'],
] as const)
  test(`switching defect is advisory: ${rule} ${JSON.stringify(options)}`, async ({ page }) => {
    await load(page, fixture(options));
    const report = await inspectMenubarSwitching(page);
    if (rule === 'menubar-keyboard-switch' || report.hoverSupported)
      expect(report.findings.map(item => item.rule)).toContain(rule);
    else {
      expect(report.findings).toEqual([]);
      expect(report.observations[0]).toMatchObject({ pointer: { status: 'not-probed' } });
    }
    expect(report.findings.every(item => item.severity === 'warning')).toBe(true);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
  });
for (const options of [{ request: true }, { replace: true }])
  test(`dependent hover and replacement controls remain unverified ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const guard = await load(page, fixture(options));
    const report = await inspectMenubarSwitching(page);
    expect(report.findings).toEqual([]);
    expect(report.observations[0]).toMatchObject({
      status: report.hoverSupported ? 'unverified' : 'observed',
    });
    if (report.hoverSupported && options.request)
      expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => (window as unknown as { activations: number }).activations),
    ).toBe(0);
  });

test('unsafe triggers, initial open state and unrelated modals are excluded', async ({ page }) => {
  await load(page, fixture({ submit: true }));
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.locator('#trigger-1').evaluate(el => ((el as HTMLButtonElement).type = 'button'));
  await page.locator('#trigger-0').focus();
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'initially-open-menu',
  });
  await page.locator('#outside').focus();
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.textContent = 'Unrelated modal';
    document.body.append(dialog);
    dialog.showModal();
  });
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
  });
});

test('ambiguous target ownership is not guessed and root sampling is bounded', async ({ page }) => {
  await load(page, fixture());
  await page.locator('#trigger-1').evaluate(el => el.setAttribute('aria-controls', 'menu-0'));
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'ambiguous-or-unidentified-menu-targets',
  });
  await page.evaluate(() => {
    const bar = document.getElementById('bar')!;
    for (let i = 0; i < 6; i++) document.querySelector('main')!.append(bar.cloneNode(true));
  });
  const report = await inspectMenubarSwitching(page);
  expect(report).toMatchObject({ candidateCount: 7, sampleTruncated: true });
  expect(report.observations).toHaveLength(5);
});

test('vertical/root-focus menubars and oversized trigger sets require their own contract', async ({
  page,
}) => {
  await load(page, fixture());
  await page.locator('#bar').evaluate(el => el.setAttribute('aria-orientation', 'vertical'));
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.locator('#bar').evaluate(el => {
    el.removeAttribute('aria-orientation');
    for (let i = 0; i < 21; i++) {
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.textContent = 'Other';
      el.append(trigger);
    }
  });
  expect((await inspectMenubarSwitching(page)).observations[0]).toMatchObject({
    status: 'not-probed',
    triggerSampleTruncated: true,
  });
});
