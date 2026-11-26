import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe, inspectInteractions } from '../tests/modern-web-interactions';
import { inspectFormPurposes } from '../tests/modern-web-forms';

const url = 'http://127.0.0.1:45996/forms';
const fixture = (body: string, script = '') =>
  `<!doctype html><html lang="en"><head><title>Form fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Form fixture</h1>${body}</main><script>${script}</script></body></html>`;

test('canonical address and new-password hints expose semantic gaps without collecting values', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <form><label>Address<input id="address" name="shipping_address_1" autocomplete="off" value="private-address"></label>
    <label>Postal code<input id="postal" name="postcode" autocomplete="address-level1"></label>
    <label>Account email<input id="email" type="email" autocomplete="email" spellcheck="true" value="private-email"></label>
    <label>New password<input id="password" type="password" autocomplete="new-password" value="private-password"></label></form>
    <label>Standalone password<input type="password" autocomplete="new-password"></label>`),
    }),
  );
  await page.goto(url);
  const report = await inspectFormPurposes(page);
  expect(report.findings.map(f => f.rule)).toEqual(
    expect.arrayContaining([
      'address-autocomplete-purpose',
      'signup-autofill-structure',
      'signup-username-autofill',
      'signup-identifier-spellcheck',
    ]),
  );
  expect(report.coverage).toMatchObject({
    addressControls: 2,
    newPasswordControls: 2,
    autofillBehaviorVerified: false,
  });
  expect(report.findings.every(f => f.severity === 'warning')).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/private-address|private-email|private-password/);
});

test('sectioned address purposes and new-password account identifiers are accepted', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <form><label>Address<input name="billing[address_1]" autocomplete="section-home billing address-line1"></label>
    <label>Country<select name="country" autocomplete="shipping country"><option value="">Choose</option></select></label>
    <label>Postal code<input name="postal_code" autocomplete="shipping postal-code"></label>
    <label>Account email<input name="email" type="email" autocomplete="section-register username webauthn" spellcheck="false"></label>
    <label>New password<input name="password" type="password" autocomplete="section-register new-password"></label></form>
    <input hidden name="city"><input disabled name="address1">`),
    }),
  );
  await page.goto(url);
  const report = await inspectFormPurposes(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.addressControls).toBe(3);
});

test('absent form features do not create compliance claims or findings', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ contentType: 'text/html', body: fixture('<p>Informational page</p>') }),
  );
  await page.goto(url);
  const report = await inspectFormPurposes(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({
    addressControls: 0,
    newPasswordControls: 0,
    autofillBehaviorVerified: false,
  });
});

test('required select rejects placeholder, clears error, observes delayed announcements and restores selection', async ({
  page,
}) => {
  let writes = 0;
  await page.context().route('**/*', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({
      contentType: 'text/html',
      body: fixture(
        `
      <form><label for="country">Country</label><select id="country" required aria-invalid="false"><option value="" disabled selected>Choose</option><option value="bg">Bulgaria</option></select><p id="error" hidden>Choose a country</p><div id="announcer" aria-live="polite"></div></form>`,
        `const field=document.getElementById('country');
       const sync=()=>{const invalid=!field.validity.valid;field.setAttribute('aria-invalid',String(invalid));document.getElementById('error').hidden=!invalid;if(invalid){field.setAttribute('aria-describedby','error');setTimeout(()=>document.getElementById('announcer').textContent='private-announcement',100);}else field.removeAttribute('aria-describedby');};
       field.addEventListener('invalid',sync);field.addEventListener('change',()=>{sync();fetch('/write',{method:'POST'}).catch(()=>{});});`,
      ),
    });
  });
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.selects[0]).toMatchObject({
    status: 'observed',
    rejected: { valid: false, described: true },
    corrected: { valid: true, ariaInvalid: 'false' },
    speechVerified: false,
  });
  expect(report.coverage.selects[0].liveRegionObservations).toEqual(
    expect.arrayContaining([expect.objectContaining({ politeness: 'polite', textPresent: true })]),
  );
  await expect(page.locator('#country')).toHaveValue('');
  expect(writes).toBe(0);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain('private-announcement');
});

test('select custom feedback defects stay advisory and prefilled selections remain untouched', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <select id="bad" required aria-label="Country" aria-invalid="true"><option value="">Choose</option><option value="bg">Bulgaria</option></select>
    <select id="prefilled" required aria-label="Saved"><option value="">Choose</option><option value="private-choice" selected>Saved</option></select>
    <select id="listbox" size="2" required aria-label="List"><option value="">Empty entry</option><option value="b">Entry</option></select>`),
    }),
  );
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.findings.map(f => f.rule)).toEqual(
    expect.arrayContaining([
      'select-premature-error',
      'select-error-description',
      'select-stale-invalid',
    ]),
  );
  expect(report.coverage.selects[1]).toMatchObject({
    status: 'not-probed',
    reason: 'prefilled-select',
  });
  await expect(page.locator('#prefilled')).toHaveValue('private-choice');
  expect(JSON.stringify(report)).not.toContain('private-choice');
  expect(report.coverage.selects[2]).toMatchObject({
    status: 'not-probed',
    reason: 'listbox-select',
  });
});

test('select rerenders do not redirect probing into prefilled replacement data', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(
        `
    <select id="country" required aria-label="Country"><option value="">Choose</option><option value="bg">Bulgaria</option></select>`,
        `document.getElementById('country').addEventListener('invalid',event=>{event.target.outerHTML='<select id="country" required><option value="private-replacement" selected>Saved</option></select>';});`,
      ),
    }),
  );
  const guard = await prepareInteractionProbe(page);
  await page.goto(url);
  await guard.freeze();
  const report = await inspectInteractions(page);
  expect(report.coverage.selects[0]).toMatchObject({ status: 'unverified' });
  await expect(page.locator('#country')).toHaveValue('private-replacement');
  expect(JSON.stringify(report)).not.toContain('private-replacement');
});
