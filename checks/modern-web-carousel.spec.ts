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

test('explicit slide controls operate with Enter, restore original slide and focus, and redact text @modern-smoke', async ({
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

test('missing inverse control prevents changing the slide', async ({ page }) => {
  await fixture(page);
  await page.locator('#previous').evaluate(el => el.remove());
  const report = await inspectCarousels(page);
  expect(report.coverage.observations[0]).toMatchObject({ status: 'not-probed' });
  await expect(page.locator('#one')).toBeVisible();
});

test('focus-time inverse submitter mutation prevents forward activation', async ({ page }) => {
  await fixture(
    page,
    markup,
    behavior +
      "document.getElementById('next').addEventListener('focus',()=>document.getElementById('previous').type='submit');",
  );
  const report = await inspectCarousels(page);
  expect(report.coverage.observations[0]).toMatchObject({ status: 'unverified' });
  await expect(page.locator('#one')).toBeVisible();
});

test('content-visibility hidden ancestors do not establish an active slide', async ({ page }) => {
  await fixture(page);
  await page.locator('section').evaluate(el => {
    const wrapper = document.createElement('div');
    el.append(wrapper);
    wrapper.append(document.getElementById('one')!, document.getElementById('two')!);
    wrapper.style.contentVisibility = 'hidden';
  });
  const report = await inspectCarousels(page);
  expect(report.coverage.observations[0]).toMatchObject({
    status: 'not-probed',
    initial: { active: -1 },
  });
  expect(await page.locator('#one').getAttribute('hidden')).toBeNull();
});

for (const scenario of [
  {
    name: 'focus changes slide',
    event: 'focus',
    target: 'next',
    change: 'one.hidden=true;two.hidden=false;',
    active: 'two',
    clicks: [],
  },
  {
    name: 'focus leaves and immediately returns',
    event: 'focus',
    target: 'next',
    change: "document.getElementById('authored').focus();document.getElementById('next').focus();",
    active: 'one',
    clicks: [],
  },
  {
    name: 'focus blurs and immediately returns',
    event: 'focus',
    target: 'next',
    change: "document.getElementById('next').blur();document.getElementById('next').focus();",
    active: 'one',
    clicks: [],
  },
  {
    name: 'focus moves to authored control',
    event: 'focus',
    target: 'next',
    change: "document.getElementById('authored').focus();",
    active: 'one',
    clicks: [],
  },
  {
    name: 'activation moves focus',
    event: 'click',
    target: 'next',
    change: "document.getElementById('authored').focus();",
    active: 'two',
    clicks: ['next'],
  },
  {
    name: 'inverse focus changes slide',
    event: 'focus',
    target: 'previous',
    change: 'one.hidden=false;two.hidden=true;',
    active: 'one',
    clicks: ['next'],
  },
  {
    name: 'inverse activation moves focus',
    event: 'click',
    target: 'previous',
    change: "document.getElementById('authored').focus();",
    active: 'one',
    clicks: ['next', 'previous'],
  },
  {
    name: 'focus reparents root',
    event: 'focus',
    target: 'next',
    change:
      "const wrapper=document.createElement('div');document.querySelector('main').append(wrapper);wrapper.append(document.querySelector('section'));",
    active: 'one',
    clicks: [],
  },
  {
    name: 'focus reparents slide',
    event: 'focus',
    target: 'next',
    change:
      "const wrapper=document.createElement('div');document.querySelector('section').append(wrapper);wrapper.append(one);",
    active: 'one',
    clicks: [],
  },
  {
    name: 'focus changes carousel identity',
    event: 'focus',
    target: 'next',
    change: "document.querySelector('section').setAttribute('aria-label','private-new-owner');",
    active: 'one',
    clicks: [],
  },
]) {
  test(`carousel retains authored state and stops later roots: ${scenario.name}`, async ({
    page,
  }) => {
    await fixture(
      page,
      markup +
        '<button id="authored" type="button">Authored focus</button>' +
        markup.replaceAll('id="', 'id="later-'),
      behavior +
        `
        window.activations=[];window.laterFocus=0;
        document.getElementById('later-next').addEventListener('focus',()=>window.laterFocus++);
        document.addEventListener('click',event=>{if(['next','previous'].includes(event.target.id))window.activations.push(event.target.id);});
        document.getElementById('${scenario.target}').addEventListener('${scenario.event}',()=>{${scenario.change}},{once:true});
      `,
    );
    await page.locator('#prior').focus();
    const report = await inspectCarousels(page);
    expect(report.coverage.observations).toHaveLength(1);
    expect(report.coverage.observations[0]).toMatchObject({ status: 'unverified' });
    await expect(page.locator('#' + scenario.active)).toBeVisible();
    await expect(page.locator('#prior')).not.toBeFocused();
    expect(
      await page.evaluate(() => (window as unknown as { activations: string[] }).activations),
    ).toEqual(scenario.clicks);
    expect(
      await page.evaluate(() => (window as unknown as { laterFocus: number }).laterFocus),
    ).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-new-owner');
    expect(report.findings).toEqual([]);
    if (scenario.name === 'focus moves to authored control')
      await expect(page.locator('#authored')).toBeFocused();
  });
}

test('carousel continues to later retained roots and restores the original focus', async ({
  page,
}) => {
  await fixture(
    page,
    markup + markup.replaceAll('id="', 'id="later-'),
    behavior + `{${behavior.replaceAll("getElementById('", "getElementById('later-")}}`,
  );
  await page.locator('#prior').focus();
  const report = await inspectCarousels(page);
  expect(report.coverage.observations).toHaveLength(2);
  for (const observation of report.coverage.observations)
    expect(observation).toMatchObject({ status: 'observed', restoration: { status: 'restored' } });
  expect(report.coverage.stoppedAfterLoss).toBe(false);
  await expect(page.locator('#one')).toBeVisible();
  await expect(page.locator('#later-one')).toBeVisible();
  await expect(page.locator('#prior')).toBeFocused();
});

test('carousel cleanup does not refocus an original target with changed semantics', async ({
  page,
}) => {
  await fixture(
    page,
    markup,
    behavior +
      "document.getElementById('next').addEventListener('click',()=>document.getElementById('prior').setAttribute('aria-label','private-authored-purpose'));",
  );
  await page.locator('#prior').focus();
  const report = await inspectCarousels(page);
  expect(report.coverage.observations[0]).toMatchObject({ restoration: { status: 'restored' } });
  expect(report.coverage.stoppedAfterLoss).toBe(true);
  await expect(page.locator('#prior')).not.toBeFocused();
  await expect(page.locator('#prior')).toHaveAttribute('aria-label', 'private-authored-purpose');
  expect(JSON.stringify(report)).not.toContain('private-authored-purpose');
});
