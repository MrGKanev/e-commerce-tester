import type { Page, ElementHandle } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

const LIMIT = 5;

/** Bounded keyboard samples on declared widgets; run only on a fresh quarantined page. */
export async function inspectWidgets(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Widget probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const tabs: Array<Record<string, unknown>> = [];
  const accordions: Array<Record<string, unknown>> = [];
  const switches: Array<Record<string, unknown>> = [];
  const sliders: Array<Record<string, unknown>> = [];
  const add = (
    rule: string,
    guide: string,
    selector: string,
    evidence: Record<string, unknown>,
    recommendation: string,
  ) => findings.push({ rule, guide, selector, evidence, recommendation, severity: 'warning' });

  const lists = (await page
    .locator('[role="tablist"], [focusgroup~="tablist"]')
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  for (const list of lists.slice(0, LIMIT)) {
    try {
      const snapshot = () =>
        list.evaluate(root => {
          const visible = (el: Element) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            return (
              !el.closest('[hidden]') &&
              s.display !== 'none' &&
              s.visibility === 'visible' &&
              s.contentVisibility !== 'hidden' &&
              r.width > 0 &&
              r.height > 0
            );
          };
          const named = (el: Element) =>
            Boolean(
              el.getAttribute('aria-label')?.trim() ||
              (el.getAttribute('aria-labelledby') || '')
                .split(/\s+/)
                .some(id => document.getElementById(id)?.textContent?.trim()),
            );
          const items = [
            ...root.querySelectorAll<HTMLElement>(
              '[role="tab"], :scope[focusgroup~="tablist"] > button',
            ),
          ].filter(
            el =>
              el.closest('[role="tablist"], [focusgroup~="tablist"]') === root &&
              visible(el) &&
              !el.matches(':disabled,[aria-disabled="true"]'),
          );
          const panels = items.map(
            el =>
              [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(
                panel =>
                  (panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(el.id) &&
                  Boolean(el.id),
              ) || document.getElementById(el.getAttribute('aria-controls') || ''),
          );
          return {
            selector: root.id ? '#' + CSS.escape(root.id) : 'tablist',
            named: named(root),
            selected: items.map(el => el.getAttribute('aria-selected') === 'true'),
            tabNamed: items.map(el => named(el) || Boolean(el.textContent?.trim())),
            panelNamed: panels.map(panel => Boolean(panel && named(panel))),
            panelRole: panels.map(panel => panel?.getAttribute('role') === 'tabpanel'),
            tabStops: items.map(el => el.tabIndex >= 0),
            rootFocusModel:
              root instanceof HTMLElement &&
              root.tabIndex >= 0 &&
              items.some(
                el => Boolean(el.id) && root.getAttribute('aria-activedescendant') === el.id,
              ),
            active: items.findIndex(
              el =>
                el === document.activeElement ||
                Boolean(el.id && root.getAttribute('aria-activedescendant') === el.id),
            ),
            panelPresent: panels.map(Boolean),
            panelVisible: panels.map(panel => Boolean(panel && visible(panel))),
            nativeFocusgroup:
              root.hasAttribute('focusgroup') && 'focusGroup' in HTMLElement.prototype,
            count: items.length,
            connected: root.isConnected,
          };
        });
      const initial = await snapshot();
      if (
        !initial.named ||
        initial.selected.filter(Boolean).length !== 1 ||
        initial.panelPresent.some(value => !value) ||
        initial.tabNamed.some(value => !value) ||
        initial.panelNamed.some(value => !value) ||
        initial.panelRole.some(value => !value) ||
        initial.selected.some((selected, index) => selected !== initial.panelVisible[index]) ||
        (!initial.nativeFocusgroup &&
          !initial.rootFocusModel &&
          (initial.tabStops.filter(Boolean).length !== 1 ||
            initial.selected.some((selected, index) => selected && !initial.tabStops[index])))
      )
        add(
          'widget-tabs-semantics',
          'tabs',
          initial.selector,
          { initial },
          'Name the tablist, expose exactly one selected tab and matching visible named panel, and provide one keyboard entry stop.',
        );
      if (initial.rootFocusModel) {
        tabs.push({
          initial,
          status: 'not-probed',
          reason: 'root-focus-active-descendant-model',
          keyboardBehaviorUnverified: true,
        });
        continue;
      }
      const collection = await list.evaluateHandle(root => {
        const visible = (el: Element) => {
          const style = getComputedStyle(el),
            rect = el.getBoundingClientRect();
          return (
            !el.closest('[hidden]') &&
            style.display !== 'none' &&
            style.visibility === 'visible' &&
            style.contentVisibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        return [
          ...root.querySelectorAll<HTMLElement>(
            '[role="tab"], :scope[focusgroup~="tablist"] > button',
          ),
        ].filter(
          el =>
            el.closest('[role="tablist"], [focusgroup~="tablist"]') === root &&
            visible(el) &&
            !el.matches(':disabled,[aria-disabled="true"]'),
        );
      });
      const eligible = [];
      const properties = await collection.getProperties();
      for (const [key, handle] of properties) {
        if (/^\d+$/.test(key) && handle.asElement()) eligible.push(handle.asElement()!);
      }
      const safeButtons = await Promise.all(
        eligible.map(el =>
          el.evaluate(node => node instanceof HTMLButtonElement && node.type === 'button'),
        ),
      );
      const selectedIndex = initial.selected.findIndex(Boolean);
      const selected = eligible[selectedIndex];
      if (
        !selected ||
        initial.count < 2 ||
        eligible.length !== initial.count ||
        safeButtons.some(safe => !safe)
      ) {
        tabs.push({
          initial,
          status: 'not-probed',
          reason: 'requires-non-submit-button-tabs-with-multiple-enabled-items',
        });
        continue;
      }
      const targetIndex = (selectedIndex + 1) % eligible.length;
      await selected.focus();
      await selected.press(
        (await list.getAttribute('aria-orientation')) === 'vertical'
          ? 'ArrowDown'
          : (await list.evaluate(el => getComputedStyle(el).direction === 'rtl'))
            ? 'ArrowLeft'
            : 'ArrowRight',
        { timeout: 1500 },
      );
      const moved = await snapshot();
      if (!moved.connected) throw new Error('Tablist replaced');
      if (moved.active !== targetIndex)
        add(
          'widget-tabs-keyboard',
          'tabs',
          initial.selector,
          { initial, moved, expectedIndex: targetIndex },
          'Move focus or active descendant to the adjacent enabled tab with the orientation-appropriate arrow key.',
        );
      // Manual-activation tabs are valid. Never press Enter on an arbitrary link or submitter.
      if (
        moved.active === targetIndex &&
        !moved.selected[targetIndex] &&
        (await eligible[targetIndex].evaluate(el => (el as HTMLButtonElement).type !== 'submit'))
      )
        await eligible[targetIndex].press('Enter', { timeout: 1500 });
      const activated = await snapshot();
      if (
        moved.active === targetIndex &&
        (!activated.selected[targetIndex] ||
          !activated.panelVisible[targetIndex] ||
          activated.selected.filter(Boolean).length !== 1)
      )
        add(
          'widget-tabs-activation',
          'tabs',
          initial.selector,
          { activated, expectedIndex: targetIndex },
          'Synchronize selected state and visible panel after focus-following or explicit keyboard activation.',
        );
      // Restore through the declared tab control; no unrelated action buttons are clicked.
      if (activated.selected[targetIndex] && !activated.selected[selectedIndex]) {
        await selected.focus();
        await selected.press('Enter', { timeout: 1500 });
      }
      tabs.push({ initial, moved, activated, restored: await snapshot(), status: 'observed' });
    } catch {
      tabs.push({ status: 'unverified', reason: 'widget-changed-or-dependent-work-blocked' });
    }
  }

  // Native details are intrinsically disclosures. Custom arbitrary buttons require an opt-in contract.
  const details = (await page
    .locator('details')
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  for (const disclosure of details.slice(0, LIMIT)) {
    const summary = await disclosure.$(':scope > summary:first-child');
    if (!summary) {
      add(
        'widget-accordion-summary',
        'accordion',
        'details',
        { firstChildSummary: false },
        'Place a named summary as the first child of each native disclosure.',
      );
      continue;
    }
    try {
      const initial = await disclosure.evaluate(el => ({
        selector: el.id ? '#' + CSS.escape(el.id) : 'details',
        open: (el as HTMLDetailsElement).open,
        group: (el as HTMLDetailsElement).name,
      }));
      const semantics = await summary.evaluate(el => ({
        named: Boolean(
          (el.getAttribute('aria-label') || el.textContent || '').trim() ||
          (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .some(id => document.getElementById(id)?.textContent?.trim()),
        ),
        nestedHeading: Boolean(el.querySelector('h1,h2,h3,h4,h5,h6')),
        disabled: el.getAttribute('aria-disabled') === 'true',
      }));
      if (!semantics.named || semantics.nestedHeading)
        add(
          'widget-accordion-summary',
          'accordion',
          initial.selector,
          semantics,
          'Give each summary an accessible name; do not put heading semantics inside summary.',
        );
      if (semantics.disabled) {
        accordions.push({
          initial,
          status: 'not-probed',
          reason: 'declared-disabled-or-always-open-policy',
        });
        continue;
      }
      const group = initial.group ? await page.locator('details').elementHandles() : [];
      const groupStates = await Promise.all(
        group.map(async handle => ({
          handle,
          state: await handle.evaluate(el => ({
            name: (el as HTMLDetailsElement).name,
            open: (el as HTMLDetailsElement).open,
          })),
        })),
      );
      await summary.focus();
      await summary.press('Enter', { timeout: 1500 });
      const toggled = await disclosure.evaluate(el => (el as HTMLDetailsElement).open);
      await summary.press('Space', { timeout: 1500 });
      const restored = await disclosure.evaluate(el => (el as HTMLDetailsElement).open);
      if (toggled === initial.open || restored !== initial.open)
        add(
          'widget-accordion-keyboard',
          'accordion',
          initial.selector,
          { initialOpen: initial.open, toggled, restored },
          'Allow Enter and Space to toggle a non-disabled disclosure and retain focus on its summary.',
        );
      for (const { handle, state } of groupStates)
        if (state.name === initial.group)
          await handle.evaluate((el, open) => {
            (el as HTMLDetailsElement).open = open;
          }, state.open);
      accordions.push({ initial, toggled, restored, status: 'observed' });
    } catch {
      accordions.push({ status: 'unverified', reason: 'disclosure-changed' });
    }
  }

  const switchControls = (await page
    .locator(
      'input[type="checkbox"][switch]:not(:disabled), [role="switch"]:not([aria-disabled="true"]):not([aria-readonly="true"])',
    )
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  for (const control of switchControls.slice(0, LIMIT)) {
    try {
      const state = () =>
        control.evaluate(el => ({
          selector: el.id ? '#' + CSS.escape(el.id) : 'switch',
          checked:
            el instanceof HTMLInputElement ? String(el.checked) : el.getAttribute('aria-checked'),
          named: Boolean(
            el.getAttribute('aria-label')?.trim() ||
            (el.getAttribute('aria-labelledby') || '')
              .split(/\s+/)
              .some(id => document.getElementById(id)?.textContent?.trim()) ||
            (el instanceof HTMLInputElement &&
              [...(el.labels || [])].some(label => label.textContent?.trim())) ||
            (el.getAttribute('role') === 'switch' &&
              (() => {
                const copy = el.cloneNode(true) as HTMLElement;
                copy
                  .querySelectorAll('[aria-hidden="true"], [hidden]')
                  .forEach(node => node.remove());
                return Boolean(copy.textContent?.trim());
              })()),
          ),
          safe:
            (!(el instanceof HTMLButtonElement) || el.type === 'button') &&
            (!(el instanceof HTMLInputElement) || el.type === 'checkbox'),
        }));
      const before = await state();
      if (!before.named || !['true', 'false'].includes(before.checked || ''))
        add(
          'widget-switch-semantics',
          'switch',
          before.selector,
          { named: before.named, binaryState: ['true', 'false'].includes(before.checked || '') },
          'Expose a named binary switch state with a label and checked or aria-checked.',
        );
      if (!before.safe) {
        switches.push({ status: 'not-probed', reason: 'submit-button' });
        continue;
      }
      await control.focus();
      await control.press('Space', { timeout: 1500 });
      const toggled = await state();
      await control.press('Space', { timeout: 1500 });
      const restored = await state();
      if (before.checked === toggled.checked || before.checked !== restored.checked)
        add(
          'widget-switch-keyboard',
          'switch',
          before.selector,
          { before: before.checked, toggled: toggled.checked, restored: restored.checked },
          'Support Space toggling and reversal while exposing the checked state.',
        );
      switches.push({ before, toggled, restored, status: 'observed' });
    } catch {
      switches.push({ status: 'unverified', reason: 'switch-changed' });
    }
  }

  const ranges = (await page
    .locator(
      'input[type="range"]:not(:disabled):not([readonly]), [role="slider"]:not([aria-disabled="true"]):not([aria-readonly="true"])',
    )
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  for (const control of ranges.slice(0, LIMIT)) {
    try {
      const state = () =>
        control.evaluate(el => {
          const native = el instanceof HTMLInputElement && el.type === 'range';
          const parse = (value: string | null, fallback: number | null) =>
            value === null || value === ''
              ? fallback
              : Number.isFinite(Number(value))
                ? Number(value)
                : null;
          return {
            selector: el.id ? '#' + CSS.escape(el.id) : 'slider',
            native,
            step: native ? parse(el.getAttribute('step'), 1) : null,
            min: parse(native ? el.getAttribute('min') : el.getAttribute('aria-valuemin'), 0),
            max: parse(native ? el.getAttribute('max') : el.getAttribute('aria-valuemax'), 100),
            value: parse(native ? el.value : el.getAttribute('aria-valuenow'), null),
            orientation: el.getAttribute('aria-orientation') || 'horizontal',
            rtl: getComputedStyle(el).direction === 'rtl',
            named: Boolean(
              el.getAttribute('aria-label')?.trim() ||
              (el.getAttribute('aria-labelledby') || '')
                .split(/\s+/)
                .some(id => document.getElementById(id)?.textContent?.trim()) ||
              (native && [...(el.labels || [])].some(label => label.textContent?.trim())),
            ),
            safe: !el.matches('a[href],button:not([type="button"])'),
          };
        });
      const before = await state();
      if (
        !before.named ||
        before.min === null ||
        before.max === null ||
        before.value === null ||
        before.min > before.max ||
        before.value < before.min ||
        before.value > before.max
      )
        add(
          'widget-slider-semantics',
          'slider',
          before.selector,
          { before },
          'Name the slider and expose finite minimum, maximum and current values within bounds.',
        );
      if (
        !before.safe ||
        before.min === null ||
        before.max === null ||
        before.value === null ||
        before.min >= before.max
      ) {
        sliders.push({
          before,
          status: 'not-probed',
          reason: 'unsupported-bounds-or-action-element',
        });
        continue;
      }
      if (before.native && before.step !== null && before.step > before.max - before.min) {
        sliders.push({ before, status: 'not-probed', reason: 'no-distinct-native-step-in-range' });
        continue;
      }
      const direction = before.value >= before.max ? -1 : 1;
      let key =
        before.orientation === 'vertical'
          ? direction > 0
            ? 'ArrowUp'
            : 'ArrowDown'
          : direction > 0 !== (before.native && before.rtl)
            ? 'ArrowRight'
            : 'ArrowLeft';
      await control.focus();
      await control.press(key, { timeout: 1500 });
      let changed = await state();
      // Engines differ on native RTL arrow direction; sample the opposite arrow at a clamped bound.
      if (changed.value === before.value && before.native) {
        key =
          key === 'ArrowUp'
            ? 'ArrowDown'
            : key === 'ArrowDown'
              ? 'ArrowUp'
              : key === 'ArrowRight'
                ? 'ArrowLeft'
                : 'ArrowRight';
        await control.press(key, { timeout: 1500 });
        changed = await state();
      }
      if (
        changed.value === before.value ||
        changed.value === null ||
        changed.value < before.min ||
        changed.value > before.max
      )
        add(
          'widget-slider-keyboard',
          'slider',
          before.selector,
          { before, changed },
          'Support arrow-key value changes and keep the exposed value inside the slider bounds.',
        );
      // Restore exact native value without emitting a business action; custom widgets get the inverse key.
      if (before.native)
        await control.evaluate((el, value) => {
          (el as HTMLInputElement).value = String(value);
        }, before.value);
      else
        await control.press(
          key === 'ArrowUp'
            ? 'ArrowDown'
            : key === 'ArrowDown'
              ? 'ArrowUp'
              : key === 'ArrowRight'
                ? 'ArrowLeft'
                : 'ArrowRight',
          { timeout: 1500 },
        );
      sliders.push({ before, changed, restored: await state(), status: 'observed' });
    } catch {
      sliders.push({ status: 'unverified', reason: 'slider-changed' });
    }
  }
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      tabs,
      accordions,
      switches,
      sliders,
      perCategoryLimit: LIMIT,
      successfulSubmissionAttempted: false,
      customAccordionActionsAttempted: false,
    },
    findings,
  };
}
