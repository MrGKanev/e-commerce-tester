// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// Input/blur/invalid feedback is observable; preserving authored values and retained
// nodes is the repository's probe safety contract. These fixtures never submit.
import { test, expect } from '../tests/fixtures';
import { inspectInteractions, prepareInteractionProbe } from '../tests/modern-web-interactions';

for (const scenario of [
  'ordinary',
  'prefilled',
  'input-value',
  'blur-value',
  'invalid-value',
  'replacement',
  'disabled',
  'readonly',
  'fieldset',
  'inert',
  'corrected-value',
  'reset-handler',
  'textarea',
]) {
  test(`required field ownership: ${scenario}`, async ({ page }) => {
    let writes = 0;
    await page.context().route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><title>Owned field fixture</title><body>
        <form><fieldset><label for="field">Message</label>${
          scenario === 'textarea'
            ? '<textarea id="field" required></textarea>'
            : `<input id="field" required ${scenario === 'prefilled' ? 'value="private-authored-value"' : scenario === 'input-value' ? 'aria-invalid="true"' : ''}>`
        }
        <button type="button">Next</button></fieldset></form>
        <script>
          const field = document.getElementById('field');
          window.originalField = field;
          window.changes = 0;
          const scenario = ${JSON.stringify(scenario)};
          field.addEventListener('input', () => {
            window.changes++;
            if (scenario === 'input-value') field.value = 'private-authored-value';
            if (scenario === 'disabled') field.disabled = true;
            if (scenario === 'readonly') field.readOnly = true;
            if (scenario === 'fieldset') field.closest('fieldset').disabled = true;
            if (scenario === 'inert') field.closest('fieldset').inert = true;
            if (scenario === 'corrected-value' && field.value === 'probe') field.value = 'private-authored-value';
            if (scenario === 'replacement') {
              const next = field.cloneNode(); next.value = 'private-authored-value'; field.replaceWith(next);
            }
            if (scenario === 'reset-handler' && window.changes === 4) field.value = 'private-authored-value';
            fetch('/write', {method:'POST'}).catch(() => {});
          });
          if (scenario === 'blur-value') field.addEventListener('blur', () => field.value = 'private-authored-value');
          if (scenario === 'invalid-value') field.addEventListener('invalid', () => field.value = 'private-authored-value');
        </script></body></html>`,
      });
    });
    const guard = await prepareInteractionProbe(page);
    await page.goto('http://127.0.0.1:45996/field-ownership');
    await guard.freeze();
    const report = await inspectInteractions(page);
    const entry = report.coverage.fields[0];
    expect(writes).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-authored-value');
    if (['ordinary', 'textarea'].includes(scenario)) {
      expect(entry).toMatchObject({ status: 'observed', restoration: { status: 'restored' } });
      await expect(page.locator('#field')).toHaveValue('');
      expect(guard.counts().blockedRequests).toBeGreaterThan(0);
    } else if (scenario === 'prefilled') {
      expect(entry).toMatchObject({ status: 'not-probed' });
      expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(0);
      await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else if (scenario === 'reset-handler') {
      expect(entry).toMatchObject({
        restoration: { status: 'not-restored', reason: 'reset-handler-changed-control' },
      });
      await expect(page.locator('#field')).toHaveValue('private-authored-value');
    } else {
      expect(entry).toMatchObject({
        status: 'unverified',
        restoration: { status: 'not-restored' },
      });
      expect(report.findings).toEqual([]);
      if (!['disabled', 'readonly', 'fieldset', 'inert'].includes(scenario))
        await expect(page.locator('#field')).toHaveValue('private-authored-value');
      if (scenario === 'replacement') {
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { originalField: HTMLInputElement }).originalField.isConnected,
          ),
        ).toBe(false);
      }
      expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(
        scenario === 'corrected-value'
          ? 3
          : scenario === 'blur-value' || scenario === 'invalid-value'
            ? 2
            : 1,
      );
    }
  });
}
