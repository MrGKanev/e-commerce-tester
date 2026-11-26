import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';

// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/checkbox.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// Preserve native Space behavior; indeterminate/mixed is not a binary reversal.
// Exact-node/context ownership, two-key limit and conditional DOM cleanup are
// repository probe safety policy. Never manufacture custom aria-checked reversal
// or export values/names/labels. DOM cleanup does not certify application reset.
export async function inspectCheckboxes(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Checkbox probes require prepareInteractionProbe(...).freeze() first');
  const observations: Array<Record<string, unknown>> = [];
  const findings: WebFinding[] = [];
  const selector = 'input[type="checkbox"], [role="checkbox"]';
  const controls = (await page.locator(selector).elementHandles()) as ElementHandle<Element>[];
  try {
    for (const [index, control] of controls.slice(0, 5).entries()) {
      const target = `${selector} >> nth=${index}`;
      const observation: Record<string, unknown> = { selector: target, keysSent: 0 };
      const owner = await control.evaluateHandle(el => {
        const native = el instanceof HTMLInputElement && el.type === 'checkbox';
        const parent = el.parentElement;
        const role = el.getAttribute('role');
        const label = el.getAttribute('aria-label'),
          labelled = el.getAttribute('aria-labelledby');
        const originalForm = el instanceof HTMLInputElement ? el.form : null;
        const name = el instanceof HTMLInputElement ? el.name : null;
        const value = el instanceof HTMLInputElement ? el.value : null;
        const defaultChecked = el instanceof HTMLInputElement ? el.defaultChecked : null;
        const read = () => {
          const nativeNow = el instanceof HTMLInputElement && el.type === 'checkbox';
          const aria = el.getAttribute('aria-checked');
          const checked = nativeNow
            ? el.indeterminate
              ? 'mixed'
              : String(el.checked)
            : ['true', 'false', 'mixed'].includes(aria || '')
              ? aria!
              : 'invalid';
          const style = getComputedStyle(el),
            rect = el.getBoundingClientRect();
          let hidden = false;
          for (let p: Element | null = el; p; p = p.parentElement)
            hidden ||= getComputedStyle(p).contentVisibility === 'hidden';
          const overlay =
            Boolean(document.querySelector('dialog[open]')) ||
            [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(dialog => {
              const r = dialog.getBoundingClientRect();
              return (
                !dialog.closest('[hidden],[aria-hidden="true"]') &&
                getComputedStyle(dialog).visibility === 'visible' &&
                r.width > 0 &&
                r.height > 0
              );
            });
          const eligible =
            el instanceof HTMLElement &&
            el.isConnected &&
            el.getRootNode() === document &&
            !el.closest(
              '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[aria-readonly="true"],[contenteditable]:not([contenteditable="false"])',
            ) &&
            !el.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]') &&
            !hidden &&
            !overlay &&
            style.visibility === 'visible' &&
            rect.width > 0 &&
            rect.height > 0 &&
            (nativeNow
              ? [null, 'checkbox', 'switch'].includes(el.getAttribute('role')) &&
                !el.indeterminate &&
                (aria === null || aria === String(el.checked))
              : el.getAttribute('role') === 'checkbox' &&
                !el.matches('input,select,textarea,a[href]') &&
                (!(el instanceof HTMLButtonElement) || el.type === 'button'));
          const stable =
            eligible &&
            nativeNow === native &&
            el.parentElement === parent &&
            el.getAttribute('role') === role &&
            el.getAttribute('aria-label') === label &&
            el.getAttribute('aria-labelledby') === labelled &&
            (!(el instanceof HTMLInputElement) ||
              (el.form === originalForm &&
                el.name === name &&
                el.value === value &&
                el.defaultChecked === defaultChecked));
          return {
            stable,
            checked,
            binary: checked === 'true' || checked === 'false',
            focused: document.activeElement === el,
          };
        };
        const before = read();
        const owned = (expected: string) => {
          const state = read();
          return state.stable && state.binary && state.checked === expected;
        };
        return {
          read,
          before,
          restore: (expected: string, touched: boolean, keysSent: number) => {
            if (!owned(expected))
              return { status: 'not-restored', reason: 'control-or-state-ownership-changed' };
            if (read().checked === before.checked)
              return {
                status: touched && keysSent === 2 ? 'restored' : 'unchanged',
                method: touched && keysSent === 2 ? 'keyboard' : 'none',
              };
            if (!native || !(el instanceof HTMLInputElement))
              return { status: 'not-restored', reason: 'custom-keyboard-reversal-unverified' };
            // One synchronous compare/native-set. Input handlers may introduce new
            // state; do not emit change or override it after that happens.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(
              el,
              before.checked === 'true',
            );
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            if (!owned(before.checked))
              return { status: 'not-restored', reason: 'reset-handler-changed-control' };
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return owned(before.checked)
              ? { status: 'restored', method: 'native-property' }
              : { status: 'not-restored', reason: 'reset-handler-changed-control' };
          },
        };
      });
      let expected = 'invalid',
        touched = false,
        keysSent = 0;
      const state = () => owner.evaluate(value => value.read());
      const assertOwned = async (focus = true) => {
        const current = await state();
        if (
          !current.stable ||
          !current.binary ||
          current.checked !== expected ||
          (focus && !current.focused)
        )
          throw new Error('changed');
      };
      const publicState = (checked: string) => ({ selector: target, checked });
      const press = async () => {
        await assertOwned();
        touched = true;
        keysSent++;
        // Global keyboard never refocuses a replacement or steals authored focus.
        await page.keyboard.press('Space');
        const result = await state();
        if (!result.stable || !result.binary) throw new Error('changed');
        expected = result.checked;
        if (!result.focused) throw new Error('focus changed');
        // Bounded observation allows local deferred handlers. A later different
        // state invalidates ownership; this is not an application timing budget.
        const deadline = Date.now() + 200;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 25));
          await assertOwned();
        }
        return publicState(expected);
      };
      try {
        const before = await owner.evaluate(value => value.before);
        expected = before.checked;
        if (!before.stable || !before.binary) {
          Object.assign(observation, { status: 'not-probed', reason: 'outside-safe-binary-scope' });
          continue;
        }
        observation.before = publicState(expected);
        await control.evaluate(el => {
          if (el instanceof HTMLElement) el.focus({ preventScroll: true });
        });
        await assertOwned();
        const toggled = await press();
        observation.toggled = toggled;
        // No second Space if the first did not move: there is no owned inverse.
        const restored =
          toggled.checked === before.checked ? publicState((await state()).checked) : await press();
        observation.restored = restored;
        observation.status = 'observed';
        if (before.checked === toggled.checked || before.checked !== restored.checked)
          findings.push({
            rule: 'interaction-checkbox-keyboard',
            guide: 'checkbox',
            severity: 'warning',
            selector: target,
            evidence: { before: publicState(before.checked), toggled, restored },
            recommendation:
              'Review Space toggling and reversal in this bounded binary sample while exposing the checked state. Delayed workflows and mixed-state cycles need a separate contract.',
          });
      } catch {
        Object.assign(observation, {
          status: 'unverified',
          reason: 'control-state-or-focus-changed',
        });
      } finally {
        observation.keysSent = keysSent;
        observation.restoration = touched
          ? await owner
              .evaluate(
                (value, args) => value.restore(args.expected, args.touched, args.keysSent),
                { expected, touched, keysSent },
              )
              .catch(() => ({ status: 'not-restored', reason: 'control-unavailable' }))
          : { status: 'unchanged', method: 'none' };
        observations.push(observation);
        await owner.dispose();
      }
    }
  } finally {
    for (const control of controls) await control.dispose();
  }
  return {
    observations,
    findings,
    limit: 5,
    keyLimit: 2,
    settleWindowMs: 200,
    applicationResetVerified: false,
  };
}
