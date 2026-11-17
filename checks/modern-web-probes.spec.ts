import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectModernWeb } from '../tests/modern-web';
import { inspectPresentation } from '../tests/modern-web-presentation';
import { prepareInteractionProbe, inspectInteractions } from '../tests/modern-web-interactions';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const fixture = (body: string, script = '') =>
  `<!doctype html><html lang="en"><head><title>Probe fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900 dark:bg-slate-950 dark:text-white"><main><h1>Store fixture</h1>${body}</main><script>${script}</script></body></html>`;
const url = 'http://127.0.0.1:45996/probes';

test('guarded field/checkbox probes distinguish bad states and block writes', async ({ page }) => {
  let serverWrites = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') serverWrites++;
    return route.fulfill({
      contentType: 'text/html',
      body: fixture(
        `
      <label for="email">Email</label><input id="email" required type="email" aria-invalid="true">
      <label for="prefilled">Existing</label><input id="prefilled" required value="private-existing-value">
      <span id="custom" role="checkbox" aria-label="Option" aria-checked="false" tabindex="0">Option</span>`,
        `document.getElementById('email').addEventListener('input',()=>{fetch('/save',{method:'POST',body:'probe'}).catch(()=>{});fetch('/unsafe-get?change=1').catch(()=>{});});`,
      ),
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await expect(inspectInteractions(page)).rejects.toThrow(/require/);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining([
      'interaction-premature-error',
      'interaction-error-description',
      'interaction-stale-invalid',
      'interaction-checkbox-keyboard',
    ]),
  );
  expect(report.coverage.fields.some(field => field.status === 'not-probed')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private-existing-value');
  expect(serverWrites).toBe(0);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
});

test('correct field feedback clears and native checkboxes toggle and restore', async ({ page }) => {
  await page.context().route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(
        `
    <label for="email">Email</label><input id="email" required type="email" aria-invalid="false"><p id="error" hidden>Email is required or invalid.</p>
    <label><input id="option" type="checkbox">Option</label>`,
        `const field=document.getElementById('email'),error=document.getElementById('error');const sync=()=>{const invalid=!field.validity.valid;field.setAttribute('aria-invalid',String(invalid));error.hidden=!invalid;if(invalid)field.setAttribute('aria-describedby','error');else field.removeAttribute('aria-describedby');};field.addEventListener('blur',sync);field.addEventListener('invalid',sync);field.addEventListener('input',()=>{if(field.validity.valid)sync();});`,
      ),
    }),
  );
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.fields[0]).toMatchObject({
    status: 'observed',
    rejected: { valid: false, described: true },
    corrected: { valid: true, ariaInvalid: 'false' },
  });
  expect(report.coverage.checkboxes).toHaveLength(1);
  await expect(page.locator('#option')).not.toBeChecked();
  expect(guard.counts().blockedRequests).toBe(0);
});

test('presentation detects reflow/text clipping and unnamed icon controls, then restores state', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <div class="w-[600px]">Wide content</div>
    <p id="clipped" class="h-[20px] w-[200px] overflow-hidden text-base leading-none">Readable text</p>
    <button type="button"><svg aria-hidden="true" class="size-4"><path d="M0 0L10 10"></path></svg></button>`),
    }),
  );
  await page.goto(url);
  const viewport = page.viewportSize();
  await inspectModernWeb(page);
  const passiveBefore = await page.evaluate(() =>
    (
      window as unknown as {
        __storeVitals: { peek: () => { activeObservers: number; metrics: unknown } };
      }
    ).__storeVitals.peek(),
  );
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const report = await inspectPresentation(page);
  const passiveAfter = await page.evaluate(() =>
    (
      window as unknown as {
        __storeVitals: { peek: () => { activeObservers: number; metrics: unknown } };
      }
    ).__storeVitals.peek(),
  );
  expect(passiveAfter.activeObservers).toBe(0);
  expect(passiveAfter.metrics).toEqual(passiveBefore.metrics);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining([
      'presentation-reflow',
      'presentation-text-resilience',
      'presentation-button-name',
    ]),
  );
  expect(page.viewportSize()).toEqual(viewport);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    before,
  );
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('style')].some(style =>
        style.textContent?.includes('letter-spacing:.12em!important'),
      ),
    ),
  ).toBe(false);
  expect(
    report.coverage.states.some(
      state => state.name === 'forced-colors' && typeof state.supported === 'boolean',
    ),
  ).toBe(true);
});

test('security/autofill/structure findings omit sensitive URL and field values', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <form method="post"><label>Account<input type="email"></label><label>Password<input type="password" autocomplete="current-password"></label></form>
    <nav aria-label="Breadcrumbs"><a href="/">Home</a></nav>
    <nav aria-label="Primary"><a href="/a" aria-current="page">A</a><a href="/b" aria-current="page">B</a></nav>
    <a href="/product"><button type="button">Nested action</button></a><progress></progress>`),
    }),
  );
  await page.goto('https://fixture.test/?password=private-url-value');
  const report = await inspectModernWeb(page, {});
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining([
      'form-username-autofill',
      'breadcrumb-current',
      'nav-current-duplicate',
      'nested-interactive',
      'progress-name',
      'privacy-url-parameters',
      'security-nosniff',
      'security-csp',
      'security-framing',
      'security-hsts',
    ]),
  );
  expect(JSON.stringify(report)).not.toContain('private-url-value');
});

test('valid framing/header and structure alternatives avoid extra warnings', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <form method="post"><label>Account<input type="email" autocomplete="username"></label><label>Password<input type="password" autocomplete="current-password"></label></form>
    <nav aria-label="Breadcrumbs"><a href="/">Home</a><span aria-current="page">Here</span></nav>
    <progress aria-label="Loading"></progress>`),
    }),
  );
  await page.goto('https://fixture.test/');
  const report = await inspectModernWeb(page, {
    'x-content-type-options': 'nosniff',
    'content-security-policy': "frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000',
  });
  expect(report.findings).toEqual([]);
});

test('rerendered controls cannot redirect a probe into prefilled replacement data', async ({
  page,
}) => {
  await page.context().route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(
        '<label for="initial">Email</label><input id="initial" required type="email"><label for="existing">Existing</label><input id="existing" required value="keep-existing">',
        `document.getElementById('initial').oninput=event=>{const replacement=document.createElement('input');replacement.id='replacement';replacement.required=true;replacement.value='keep-replacement';event.target.replaceWith(replacement);};`,
      ),
    }),
  );
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.coverage.fields.some(field => field.status === 'unverified')).toBe(true);
  await expect(page.locator('#replacement')).toHaveValue('keep-replacement');
  await expect(page.locator('#existing')).toHaveValue('keep-existing');
  expect(JSON.stringify(report)).not.toContain('keep-existing');
});

test('passive metrics finish before inspector DOM work can contaminate attribution', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({ contentType: 'text/html', body: fixture('<p>Observer boundary</p>') }),
  );
  await page.goto(url);
  await page.evaluate(() => {
    const scope = window as unknown as {
      __storeVitals: { peek: () => { activeObservers: number } };
      __observerCapture?: number;
    };
    const images = document.images;
    Object.defineProperty(document, 'images', {
      configurable: true,
      get: () => {
        scope.__observerCapture = scope.__storeVitals.peek().activeObservers;
        return images;
      },
    });
  });
  await inspectModernWeb(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { __observerCapture?: number }).__observerCapture,
    ),
  ).toBe(0);
});
