import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';
const SHOWN = 1500;

export type Audit = { applicable: boolean; problems: string[] };
const na: Audit = { applicable: false, problems: [] };

/** Serious/critical axe findings for the current DOM state, optionally limited to one subtree. */
export async function blockingAxe(page: Page, within?: Locator): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('iframe').analyze();
  const found: string[] = [];
  for (const violation of result.violations) {
    if (violation.impact !== 'critical' && violation.impact !== 'serious') continue;
    for (const node of violation.nodes) {
      const selector = node.target.length === 1 ? String(node.target[0]) : '';
      const inside =
        !within ||
        (selector &&
          (await within
            .evaluate((root, css) => root.contains(document.querySelector(css)), selector)
            .catch(() => false)));
      if (inside) {
        found.push(`${violation.id}: ${violation.help}`);
        break;
      }
    }
  }
  return found;
}

/**
 * Opens an overlay (menu, search, cart drawer) with the keyboard and checks the open state.
 * Read-only: it only opens and closes UI, it never submits anything.
 */
export async function auditOverlay(page: Page, trigger: Locator): Promise<Audit> {
  const problems: string[] = [];
  const before = page.url();
  const isSummary = await trigger.evaluate(element => element.tagName === 'SUMMARY');
  await trigger.focus();
  await trigger.press('Enter');
  if (page.url() !== before) return na; // A link, not an overlay trigger.

  const overlay = isSummary
    ? trigger.locator('xpath=ancestor::details[1]')
    : page.locator(DIALOG).filter({ visible: true }).first();
  const opened = await overlay
    .waitFor({ state: 'visible', timeout: SHOWN })
    .then(() => true)
    .catch(() => false);
  if (!opened) return na;

  if (!isSummary && (await trigger.getAttribute('aria-expanded')) !== 'true')
    problems.push('Trigger does not expose aria-expanded="true" while the overlay is open');

  const info = await overlay.evaluate(element => {
    const ids = element.getAttribute('aria-labelledby');
    const labelled = ids
      ? ids
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() || '')
          .join('')
      : '';
    return {
      dialog: element.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]'),
      modal: element.matches(':modal') || element.getAttribute('aria-modal') === 'true',
      named: Boolean((element.getAttribute('aria-label') || '').trim() || labelled),
    };
  });
  if (info.dialog && !info.named) problems.push('Dialog has no accessible name');
  if (info.modal) {
    const inside = () => overlay.evaluate(el => el.contains(document.activeElement));
    if (!(await inside())) problems.push('Focus did not move into the modal dialog');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (!(await inside())) {
        problems.push('Tab moved focus out of the modal dialog (no focus containment)');
        break;
      }
    }
  }
  problems.push(...(await blockingAxe(page, overlay)).map(finding => `Open state — ${finding}`));

  await page.keyboard.press('Escape');
  const closed = await overlay
    .waitFor({ state: 'hidden', timeout: SHOWN })
    .then(() => true)
    .catch(() => false);
  if (!closed) problems.push('Escape does not close the overlay');
  else if (!(await trigger.evaluate(element => element === document.activeElement)))
    problems.push('Focus does not return to the trigger after closing');
  return { applicable: true, problems };
}

/** Variant options must be named, grouped and operable by keyboard; the selected state must stay accessible. */
export async function auditVariantPicker(page: Page): Promise<Audit> {
  const problems: string[] = [];
  const radios = page.locator('main input[type="radio"]');
  const count = await radios.count();
  const selects = page.locator(
    'main select[name^="options"], main select[name^="attribute_"], main select[id^="Option"]',
  );
  if (!count && !(await selects.count())) return na;

  if (count) {
    const groups = await radios.evaluateAll(inputs => {
      const byName = new Map<string, HTMLInputElement[]>();
      for (const input of inputs as HTMLInputElement[])
        byName.set(input.name, [...(byName.get(input.name) || []), input]);
      return [...byName].map(([name, members]) => {
        const first = members[0];
        const group = first.closest('fieldset, [role="radiogroup"], [role="group"]');
        const legend = group?.querySelector('legend')?.textContent?.trim();
        const labelled =
          group?.getAttribute('aria-label')?.trim() ||
          (group?.getAttribute('aria-labelledby') &&
            document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent?.trim());
        const unnamed = members.filter(
          m =>
            !m.labels?.length &&
            !m.getAttribute('aria-label') &&
            !m.getAttribute('aria-labelledby'),
        ).length;
        return { name, grouped: Boolean(group && (legend || labelled)), unnamed };
      });
    });
    for (const group of groups) {
      if (!group.grouped)
        problems.push(`Option group "${group.name}" has no fieldset/legend or labelled group`);
      if (group.unnamed)
        problems.push(`${group.unnamed} option(s) in "${group.name}" have no name`);
    }
    const target = radios.locator('xpath=self::*[not(@checked)]').first();
    if (await target.count()) {
      await target.focus();
      const name = await target.getAttribute('name');
      const selectedBefore = await page.evaluate(
        n => document.querySelector<HTMLInputElement>(`input[name="${n}"]:checked`)?.value,
        name,
      );
      await page.keyboard.press('ArrowRight');
      const selectedAfter = await page.evaluate(
        n => document.querySelector<HTMLInputElement>(`input[name="${n}"]:checked`)?.value,
        name,
      );
      if (selectedBefore === selectedAfter)
        problems.push('Options cannot be changed with the arrow keys');
    }
  }
  for (const select of await selects.all()) {
    if ((await select.locator('option').count()) > 1 && (await select.isEnabled()))
      await select.selectOption({ index: 1 });
  }
  problems.push(
    ...(await blockingAxe(page)).map(finding => `After selecting a variant — ${finding}`),
  );
  return { applicable: true, problems };
}
