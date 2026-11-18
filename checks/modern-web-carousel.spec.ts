import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectCarousels } from '../tests/modern-web-carousel';

const markup =
  '<button id="prior" type="button">Prior</button><section aria-roledescription="carousel" aria-label="Highlights"><button id="previous" type="button" aria-label="Previous slide">Previous</button><button id="next" type="button" aria-label="Next slide">Next</button><div id="one" role="group" aria-roledescription="slide" aria-label="1 of 2">private-slide-text-one</div><div id="two" role="group" aria-roledescription="slide" aria-label="2 of 2" hidden>private-slide-text-two</div></section>';
const behavior = `const one=document.getElementById('one'),two=document.getElementById('two');const advance=()=>{one.hidden=!one.hidden;two.hidden=!two.hidden;};document.getElementById('next').addEventListener('click',advance);document.getElementById('previous').addEventListener('click',advance);`;
async function fixture(page: import('@playwright/test').Page, body = markup, script = behavior) {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Carousel fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Carousel fixture</h1>${body}</main><script>${script}</script></body></html>`,
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto('http://127.0.0.1:45996/carousel');
  await guard.freeze();
  return { guard, writes: () => writes };
}

test('carousel probes require quarantine and absent optional scope stays empty', async ({
  page,
}) => {
  await page.goto('about:blank');
  await expect(inspectCarousels(page)).rejects.toThrow('freeze()');
  await fixture(page, '<p>No carousel</p>', '');
  expect((await inspectCarousels(page)).coverage.observations).toEqual([]);
});

test('explicit slide controls operate with Enter, restore original slide and focus, and redact text', async ({
  page,
}) => {
  const isolation = await fixture(
    page,
    markup,
    behavior +
      `document.getElementById('next').addEventListener('click',()=>fetch('/write',{method:'POST'}).catch(()=>{}));`,
  );
  await page.locator('#prior').focus();
  const report = await inspectCarousels(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({
    status: 'observed',
    direction: 'next',
    initial: { active: 0 },
    changed: { active: 1 },
    restoration: { status: 'restored', state: { active: 0 } },
  });
  expect(JSON.stringify(report)).not.toContain('private-slide-text');
  expect(isolation.writes()).toBe(0);
  expect(isolation.guard.counts().blockedRequests).toBeGreaterThan(0);
  await expect(page.locator('#prior')).toBeFocused();
  await expect(page.locator('#one')).toBeVisible();
});

test('finite next boundary uses previous and reverses it', async ({ page }) => {
  await fixture(
    page,
    markup.replace('id="next"', 'id="next" disabled'),
    behavior +
      `document.getElementById('previous').addEventListener('click',()=>document.getElementById('next').disabled=false);`,
  );
  const report = await inspectCarousels(page);
  expect(report.coverage.observations[0]).toMatchObject({
    status: 'observed',
    direction: 'previous',
    restoration: { status: 'restored' },
  });
});

test('missing names and slide groups are advisory without leaking labels', async ({ page }) => {
  await fixture(
    page,
    markup.replace('aria-label="Highlights"', '').replace('role="group"', ''),
    behavior,
  );
  const report = await inspectCarousels(page);
  expect(report.findings).toEqual([
    expect.objectContaining({ rule: 'carousel-semantics', severity: 'warning', guide: 'carousel' }),
  ]);
});

test('unchanged and replaced slide states remain unverified', async ({ page }) => {
  await fixture(page, markup, '');
  const unchanged = await inspectCarousels(page);
  expect(unchanged.findings).toEqual([]);
  expect(unchanged.coverage.observations[0]).toMatchObject({ status: 'unverified' });
  await page.evaluate(() =>
    document.getElementById('next')!.addEventListener('click', () => {
      document.getElementById('two')!.outerHTML =
        '<div role="group" aria-roledescription="slide" aria-label="2 of 2">Replacement</div>';
      document.getElementById('one')!.hidden = true;
    }),
  );
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'unverified',
    changed: { connected: false },
  });
});

test('ambiguous visible slides, submitters, duplicate controls and unrelated overlays are not activated', async ({
  page,
}) => {
  await fixture(page, markup.replace(' hidden', ''), behavior);
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.evaluate(() => {
    document.getElementById('two')!.hidden = true;
    for (const el of document.querySelectorAll('section button')) el.setAttribute('type', 'submit');
  });
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('section button')) el.setAttribute('type', 'button');
    const modal = document.createElement('dialog');
    document.body.append(modal);
    modal.showModal();
  });
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'not-probed',
    initial: { overlayOpen: true },
  });
});

test('focus-time reassigned controls are never activated and tabpanel slides are accepted', async ({
  page,
}) => {
  await fixture(
    page,
    markup.replaceAll('role="group"', 'role="tabpanel"'),
    behavior +
      `let activated=false;document.getElementById('next').addEventListener('click',()=>activated=true);document.getElementById('next').addEventListener('focus',event=>{event.target.type='submit';});`,
  );
  const report = await inspectCarousels(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.observations[0]).toMatchObject({ status: 'unverified' });
  expect(await page.evaluate(() => document.getElementById('one')!.hidden)).toBe(false);
});

test('duplicate explicit directions and localized control names are not guessed', async ({
  page,
}) => {
  await fixture(
    page,
    markup.replace(
      '</section>',
      '<button type="button" aria-label="Next slide">Duplicate next</button><button type="button" aria-label="Previous slide">Duplicate previous</button></section>',
    ),
    behavior,
  );
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'not-probed',
  });
  await page.evaluate(() => {
    document
      .querySelectorAll('section button')
      .forEach(el => el.setAttribute('aria-label', 'Следващ слайд'));
  });
  expect((await inspectCarousels(page)).coverage.observations[0]).toMatchObject({
    status: 'not-probed',
  });
});
