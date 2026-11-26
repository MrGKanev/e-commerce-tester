// Sources: https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-showmodal
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/select-menu-interaction.md
// Native modality is an inertness boundary; a CSS-hidden ARIA template alone
// must not disable unrelated select observations. No dialog is activated here.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectInteractions, prepareInteractionProbe } from '../tests/modern-web-interactions';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const visible of [false, true]) {
  test(`select ownership respects ${visible ? 'visible' : 'hidden'} ARIA dialog scope`, async ({
    page,
  }) => {
    const guard = await prepareInteractionProbe(page);
    await page.setContent(
      `<style>${css}</style><label for="field">Country</label><select id="field" required><option value="" disabled selected>Choose</option><option value="private-choice">First</option></select><div role="dialog" class="${visible ? 'block' : 'hidden'}">Local overlay</div><div role="alertdialog" aria-hidden="true">Inactive template</div><button type="button">Next</button>`,
    );
    await guard.freeze();
    const report = await inspectInteractions(page);
    expect(report.coverage.selects[0]).toMatchObject(
      visible
        ? { status: 'unverified', restoration: { status: 'not-restored' } }
        : { status: 'observed', restoration: { status: 'restored' } },
    );
    await expect(page.locator('#field')).toHaveValue('');
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('private-choice');
  });
}
