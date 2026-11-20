import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectTooltips } from '../tests/modern-web-tooltips';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const url = 'http://127.0.0.1:45996/tooltips';
async function fixture(page: import('@playwright/test').Page, body: string, script = '') {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Tooltip fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="p-8"><main><h1>Tooltip fixture</h1>${body}</main><script>${script}</script></body></html>`,
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  return { guard, writes: () => writes };
}
const markup =
  '<button id="trigger" type="button" aria-describedby="hint">Help</button><div id="hint" role="tooltip" hidden class="fixed left-8 top-40 w-48 rounded bg-slate-900 p-3 text-white">private-tooltip-text</div>';
const behavior = (delay = 0) =>
  `const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');let timer;const show=()=>{timer=setTimeout(()=>hint.hidden=false,${delay});};const hide=()=>{clearTimeout(timer);hint.hidden=true;};trigger.addEventListener('focus',show);trigger.addEventListener('mouseenter',show);trigger.addEventListener('blur',hide);trigger.addEventListener('mouseleave',()=>{timer=setTimeout(hide,250);});hint.addEventListener('mouseenter',()=>clearTimeout(timer));hint.addEventListener('mouseleave',hide);document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});`;

test('tooltip probes reject unfrozen pages and absent optional scope stays empty', async ({
  page,
}) => {
  await page.goto('about:blank');
  await expect(inspectTooltips(page)).rejects.toThrow('freeze()');
  await fixture(page, '<button type="button" title="Ordinary title">Ordinary control</button>');
  const report = await inspectTooltips(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations).toEqual([]);
});

test('delayed focus and hover tooltips dismiss with Escape, restore focus and block writes', async ({
  page,
}) => {
  const isolation = await fixture(
    page,
    `<button id="prior" type="button">Prior focus</button>${markup}`,
    `${behavior(250)}trigger.addEventListener('focus',()=>fetch('/write',{method:'POST'}).catch(()=>{}));`,
  );
  await page.locator('#prior').focus();
  const report = await inspectTooltips(page, { x: 0, y: 0 });
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({
    status: 'observed',
    focused: { visible: true },
    hovered: { visible: true },
    hoverability: { status: 'observed', remainsVisible: true },
    escape: { remainsVisible: false },
  });
  expect(report.coverage.pointerRestoration).toBe('caller-supplied-origin');
  expect(isolation.writes()).toBe(0);
  expect(isolation.guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain('private-tooltip-text');
  await expect(page.locator('#prior')).toBeFocused();
  await expect(page.locator('#hint')).toBeHidden();
});

test('observed hover-only clipped tooltip gives parity and positioning advisories', async ({
  page,
}) => {
  await fixture(
    page,
    markup.replace('left-8', '-left-20'),
    `const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');trigger.addEventListener('mouseenter',()=>hint.hidden=false);trigger.addEventListener('mouseleave',()=>hint.hidden=true);`,
  );
  const report = await inspectTooltips(page);
  expect(report.findings.map(finding => finding.rule)).toEqual(
    expect.arrayContaining(['tooltip-focus-discovery', 'tooltip-viewport-clipping']),
  );
  expect(report.findings.every(finding => finding.severity === 'warning')).toBe(true);
});

test('visible persistent tooltip must dismiss without moving focus and avoid covering trigger', async ({
  page,
}) => {
  await fixture(
    page,
    markup.replace('left-8 top-40', 'left-0 top-0'),
    `const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');trigger.addEventListener('focus',()=>{hint.hidden=false;const r=trigger.getBoundingClientRect();hint.style.left=r.left+'px';hint.style.top=r.top+'px';});trigger.addEventListener('blur',()=>hint.hidden=true);`,
  );
  const report = await inspectTooltips(page);
  expect(report.findings.map(finding => finding.rule)).toEqual(
    expect.arrayContaining(['tooltip-escape-dismissal', 'tooltip-trigger-occlusion']),
  );
});

test('unshown interest hints and already visible hints are explicit unverified or not-probed', async ({
  page,
}) => {
  await fixture(
    page,
    '<button id="interest" type="button" interestfor="interest-hint">Interest</button><div id="interest-hint" role="tooltip" hidden>Unshown</div><button id="existing" type="button" aria-describedby="existing-hint">Existing</button><div id="existing-hint" role="tooltip">Already visible</div>',
  );
  const report = await inspectTooltips(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relationship: 'interestfor',
        status: 'unverified',
        reason: 'not-shown-within-bounded-focus-hover-window',
      }),
      expect.objectContaining({ status: 'not-probed', reason: 'tooltip-already-visible' }),
    ]),
  );
});

test('focus theft into tooltip content is advisory and unrelated active modal prevents probing', async ({
  page,
}) => {
  await fixture(
    page,
    markup.replace('role="tooltip"', 'role="tooltip" tabindex="-1"'),
    `const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');trigger.addEventListener('focus',()=>{hint.hidden=false;hint.focus();});trigger.addEventListener('mouseenter',()=>hint.hidden=false);document.addEventListener('keydown',event=>{if(event.key==='Escape')hint.hidden=true;});`,
  );
  const report = await inspectTooltips(page);
  expect(report.findings.map(finding => finding.rule)).toContain('tooltip-focus-moved');
  await page.evaluate(() => {
    const modal = document.createElement('dialog');
    modal.textContent = 'Active dialog';
    document.body.append(modal);
    modal.showModal();
    document.getElementById('hint')!.hidden = true;
  });
  const withModal = await inspectTooltips(page);
  expect(withModal.findings).toEqual([]);
  expect(withModal.coverage.observations[0]).toMatchObject({
    status: 'not-probed',
    reason: 'another-overlay-open',
  });
  await expect(page.locator('dialog:modal')).toHaveCount(1);
});

test('Escape fade transitions are allowed and body focus is restored', async ({ page }) => {
  await fixture(
    page,
    markup.replace('fixed left-8', 'opacity-100 transition-opacity duration-300 fixed left-8'),
    `const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');const show=()=>{hint.hidden=false;hint.classList.remove('opacity-0');hint.classList.add('opacity-100');};trigger.addEventListener('focus',show);trigger.addEventListener('mouseenter',show);trigger.addEventListener('blur',()=>hint.hidden=true);let closeTimer;trigger.addEventListener('mouseleave',()=>{closeTimer=setTimeout(()=>hint.hidden=true,250);});hint.addEventListener('mouseenter',()=>clearTimeout(closeTimer));hint.addEventListener('mouseleave',()=>hint.hidden=true);document.addEventListener('keydown',event=>{if(event.key==='Escape'){hint.classList.remove('opacity-100');hint.classList.add('opacity-0');}});`,
  );
  const report = await inspectTooltips(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({ escape: { remainsVisible: false } });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('tooltip disappearance while crossing its gap is advisory without activating content', async ({
  page,
}) => {
  await fixture(
    page,
    markup,
    behavior().replace(
      "trigger.addEventListener('mouseleave',()=>{timer=setTimeout(hide,250);});",
      "trigger.addEventListener('mouseleave',hide);",
    ),
  );
  const report = await inspectTooltips(page);
  expect(report.findings.map(finding => finding.rule)).toContain('tooltip-hover-persistence');
  expect(report.coverage.observations[0]).toMatchObject({
    hoverability: { status: 'observed', remainsVisible: false },
  });
  expect(JSON.stringify(report)).not.toContain('private-tooltip-text');
});

test('occluded tooltip destination remains unverified rather than a hover failure', async ({
  page,
}) => {
  await fixture(
    page,
    markup + '<div class="fixed left-8 top-40 z-50 h-40 w-48 bg-white">Cover</div>',
    behavior(),
  );
  const report = await inspectTooltips(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({
    hoverability: { status: 'unverified', reason: 'tooltip-center-outside-viewport-or-occluded' },
  });
});

test('tooltip moving away from the sampled destination does not claim hoverability', async ({
  page,
}) => {
  await fixture(
    page,
    markup,
    "const trigger=document.getElementById('trigger'),hint=document.getElementById('hint');trigger.addEventListener('focus',()=>hint.hidden=false);trigger.addEventListener('blur',()=>hint.hidden=true);trigger.addEventListener('mouseenter',()=>hint.hidden=false);hint.addEventListener('mouseenter',()=>hint.classList.replace('left-8','left-64'));document.addEventListener('keydown',e=>{if(e.key==='Escape')hint.hidden=true;});",
  );
  const report = await inspectTooltips(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({
    hoverability: { status: 'unverified', reason: 'tooltip-moved-away-from-sampled-pointer' },
  });
});
