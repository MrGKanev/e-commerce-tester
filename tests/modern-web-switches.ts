import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';

// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/switch.md
// Read native checked state, not the submitted value; checkbox/scripted fallbacks
// remain valid without requiring switch API support or a polyfill on the store.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
// https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis
// Retained identity, private bounded signatures, focus-loss latching and stopping
// later samples are local audit safety policy. They do not certify application reset.
export async function inspectSwitches(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Switch probes require prepareInteractionProbe(...).freeze() first');
  const selector = 'input[type="checkbox"][switch], [role="switch"]';
  const locator = page.locator(selector);
  const controls: ElementHandle<Element>[] = [];
  for (let index = 0, count = Math.min(await locator.count(), 5); index < count; index++) {
    const control = await locator.nth(index).elementHandle();
    if (control) controls.push(control);
  }
  const owners = await Promise.all(
    controls.map(control =>
      control
        .evaluateHandle(el => {
          const native = el instanceof HTMLInputElement && el.type === 'checkbox';
          // Local snapshot limits: 24 ancestors, 128 attributes per node and
          // 16384 attribute name/value code units per node before serialization.
          const signature = (node: Element) => {
            if (node.attributes.length > 128) return null;
            let chars = 0;
            const values: string[][] = [];
            for (const attribute of node.attributes) {
              if (node === el && attribute.name === 'aria-checked') continue;
              chars += attribute.name.length + attribute.value.length;
              if (chars > 16384) return null;
              values.push([attribute.name, attribute.value]);
            }
            return JSON.stringify(values.sort());
          };
          const ancestry = () => {
            const nodes: Element[] = [];
            let node = el.parentElement;
            for (; node && nodes.length < 24; node = node.parentElement) nodes.push(node);
            return { nodes, limited: Boolean(node) };
          };
          const original = ancestry();
          const signatures = [el, ...original.nodes].map(signature);
          const budget = !original.limited && signatures.every(value => value !== null);
          const originalForm = el instanceof HTMLInputElement ? el.form : null;
          const originalValue = el instanceof HTMLInputElement ? el.value : null;
          const originalDefault = el instanceof HTMLInputElement ? el.defaultChecked : null;
          let armed = false,
            focusLost = false;
          const onFocus = (event: FocusEvent) => {
            if (armed && event.target !== el) focusLost = true;
          };
          document.addEventListener('focusin', onFocus, true);
          const read = () => {
            const current = ancestry();
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
            const safe = nativeNow
              ? [null, 'checkbox', 'switch'].includes(el.getAttribute('role')) &&
                (aria === null || aria === checked)
              : el.getAttribute('role') === 'switch' &&
                !el.matches('input,select,textarea,a[href]') &&
                (!(el instanceof HTMLButtonElement) || el.type === 'button');
            const overlays = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
            const overlay =
              Boolean(document.querySelector('dialog[open]')) ||
              overlays.length > 64 ||
              overlays.some(dialog => {
                const box = dialog.getBoundingClientRect();
                return (
                  !dialog.closest('[hidden],[aria-hidden="true"]') &&
                  getComputedStyle(dialog).visibility === 'visible' &&
                  box.width > 0 &&
                  box.height > 0
                );
              });
            const scope =
              el instanceof HTMLElement &&
              el.isConnected &&
              el.getRootNode() === document &&
              !el.closest(
                '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[aria-readonly="true"],[contenteditable]:not([contenteditable="false"])',
              ) &&
              !el.matches(':disabled,[readonly]') &&
              !overlay &&
              safe &&
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              rect.width > 0 &&
              rect.height > 0 &&
              ![el, ...current.nodes].some(
                node => getComputedStyle(node).contentVisibility === 'hidden',
              );
            const stable =
              budget &&
              !current.limited &&
              scope &&
              nativeNow === native &&
              current.nodes.length === original.nodes.length &&
              current.nodes.every((node, index) => node === original.nodes[index]) &&
              [el, ...current.nodes].every(
                (node, index) => signature(node) === signatures[index],
              ) &&
              (!(el instanceof HTMLInputElement) ||
                (el.form === originalForm &&
                  el.value === originalValue &&
                  el.defaultChecked === originalDefault));
            let namingLimited = false;
            const textNamed = (node: Element) => {
              const text = node.textContent || '';
              if (text.length > 8192) {
                namingLimited = true;
                return false;
              }
              return Boolean(text.trim());
            };
            const named = Boolean(
              el.getAttribute('aria-label')?.trim() ||
              (el.getAttribute('aria-labelledby') || '').split(/\s+/).some(id => {
                const label = document.getElementById(id);
                return label && textNamed(label);
              }) ||
              (nativeNow && [...(el.labels || [])].some(textNamed)) ||
              (!nativeNow &&
                (() => {
                  // Bound cloning to a small text-only/content-label sample. Hidden text
                  // cannot manufacture the custom switch's detectable content name.
                  if (
                    el.querySelectorAll('*').length > 128 ||
                    (el.textContent || '').length > 8192
                  ) {
                    namingLimited = true;
                    return false;
                  }
                  const copy = el.cloneNode(true) as Element;
                  copy
                    .querySelectorAll('[hidden],[aria-hidden="true"]')
                    .forEach(node => node.remove());
                  return textNamed(copy);
                })()),
            );
            return {
              stable,
              scope,
              native: nativeNow,
              nativeMixed: nativeNow && el.indeterminate,
              checked,
              binary: checked === 'true' || checked === 'false',
              focused: document.activeElement === el,
              focusLost,
              named,
              // A local work limit cannot establish a missing accessible name.
              // A definite name from another supported source still wins.
              namingUnverified: namingLimited && !named,
              safe,
              submitter: el.matches(
                'input[type="submit"],input[type="image"],button:not([type="button"])',
              ),
            };
          };
          const before = read();
          const owned = (expected: string) => {
            const state = read();
            return (
              state.stable &&
              state.binary &&
              state.checked === expected &&
              state.focused &&
              !state.focusLost
            );
          };
          return {
            budget,
            before,
            read,
            focus: () => {
              const current = read();
              if (
                !current.stable ||
                !current.binary ||
                current.checked !== before.checked ||
                focusLost
              )
                return false;
              armed = true;
              if (el instanceof HTMLElement) el.focus({ preventScroll: true });
              return true;
            },
            restore: (expected: string, keys: number) => {
              if (!owned(expected))
                return {
                  status: 'not-restored',
                  method: 'none',
                  reason: 'control-or-state-ownership-changed',
                };
              if (expected === before.checked)
                return {
                  status: keys === 2 ? 'restored' : 'unchanged',
                  method: keys === 2 ? 'keyboard' : 'none',
                };
              if (!native || !(el instanceof HTMLInputElement))
                return {
                  status: 'not-restored',
                  method: 'none',
                  reason: 'custom-keyboard-reversal-unverified',
                };
              // https://html.spec.whatwg.org/multipage/input.html#dom-input-checked
              // Conditional DOM-only cleanup does not replay business events or claim
              // application reset. Never overwrite state after ownership/focus loss.
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(
                el,
                before.checked === 'true',
              );
              return owned(before.checked)
                ? { status: 'restored', method: 'native-property' }
                : {
                    status: 'not-restored',
                    method: 'none',
                    reason: 'reset-handler-changed-control',
                  };
            },
            dispose: () => document.removeEventListener('focusin', onFocus, true),
          };
        })
        .catch(() => null),
    ),
  );
  const observations: Array<Record<string, unknown>> = [];
  const findings: WebFinding[] = [];
  let dependent = false;
  const activity = () => {
    dependent = true;
  };
  page.context().on('request', activity);
  page.on('websocket', activity);
  try {
    for (const [index, owner] of owners.entries()) {
      const target = `${selector} >> nth=${index}`;
      const observation: Record<string, unknown> = { selector: target, keysSent: 0 };
      observations.push(observation);
      if (!owner) {
        Object.assign(observation, {
          status: 'unverified',
          reason: 'control-state-or-focus-changed',
        });
        break;
      }
      let expected = 'invalid',
        keys = 0;
      const state = () => owner.evaluate(value => value.read());
      const publicState = (value: Awaited<ReturnType<typeof state>>) => ({
        selector: target,
        checked: value.checked,
        named: value.named,
        safe: value.safe,
        native: value.native,
      });
      const assertOwned = async (requireFocus = true) => {
        const current = await state();
        if (
          dependent ||
          !current.stable ||
          !current.binary ||
          (requireFocus && !current.focused) ||
          current.focusLost ||
          current.checked !== expected
        )
          throw new Error('changed');
        return current;
      };
      const press = async () => {
        await assertOwned();
        keys++;
        await page.keyboard.press('Space');
        const after = await state();
        if (dependent || !after.stable || !after.binary || !after.focused || after.focusLost)
          throw new Error('changed');
        expected = after.checked;
        // CSSOM/HTML rendering opportunities allow immediately queued local work
        // before another action; not a promise of arbitrary application idleness.
        // https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        return publicState(await assertOwned());
      };
      try {
        if (!(await owner.evaluate(value => value.budget))) {
          Object.assign(observation, { status: 'not-probed', reason: 'switch-ownership-budget' });
          continue;
        }
        const before = await owner.evaluate(value => value.before);
        expected = before.checked;
        observation.before = publicState(before);
        const current = await state();
        if (
          before.scope &&
          before.stable &&
          (!current.stable || current.checked !== expected || dependent)
        )
          throw new Error('changed');
        if (before.namingUnverified) {
          Object.assign(observation, { status: 'not-probed', reason: 'switch-naming-budget' });
          continue;
        }
        if (before.scope && !before.nativeMixed && (!before.named || !before.binary))
          findings.push({
            rule: 'widget-switch-semantics',
            guide: 'switch',
            severity: 'warning',
            selector: target,
            evidence: { named: before.named, binaryState: before.binary },
            recommendation:
              'Expose a named binary switch state with a label and checked or aria-checked.',
          });
        if (!before.scope || !before.stable || !before.binary) {
          Object.assign(observation, {
            status: 'not-probed',
            reason: before.submitter ? 'submit-button' : 'outside-safe-binary-scope',
          });
          continue;
        }
        await assertOwned(false);
        if (!(await owner.evaluate(value => value.focus()))) throw new Error('changed');
        await assertOwned();
        const toggled = await press();
        observation.toggled = toggled;
        const restored =
          toggled.checked === before.checked ? publicState(await assertOwned()) : await press();
        observation.restored = restored;
        const failed = before.checked === toggled.checked || before.checked !== restored.checked;
        const restoration = await owner.evaluate(
          (value, args) => value.restore(args.expected, args.keys),
          { expected, keys },
        );
        observation.restoration = { ...restoration, applicationResetVerified: false };
        if (restoration.status === 'restored') expected = before.checked;
        await assertOwned();
        observation.status = 'observed';
        if (failed)
          findings.push({
            rule: 'widget-switch-keyboard',
            guide: 'switch',
            severity: 'warning',
            selector: target,
            evidence: {
              before: before.checked,
              toggled: toggled.checked,
              restored: restored.checked,
            },
            recommendation:
              'Support Space toggling and reversal while exposing the checked state; DOM cleanup alone does not verify application reset.',
          });
        if (restoration.status === 'not-restored') break;
      } catch {
        Object.assign(observation, {
          status: 'unverified',
          reason: dependent ? 'dependent-work-blocked' : 'control-state-or-focus-changed',
          restoration: { status: 'not-restored', method: 'none', applicationResetVerified: false },
        });
        break;
      } finally {
        observation.keysSent = keys;
        observation.restoration ||= {
          status: 'unchanged',
          method: 'none',
          applicationResetVerified: false,
        };
      }
    }
  } finally {
    page.context().off('request', activity);
    page.off('websocket', activity);
    for (const owner of owners) {
      if (owner) {
        await owner.evaluate(value => value.dispose()).catch(() => {});
        await owner.dispose();
      }
    }
    for (const control of controls) await control.dispose();
  }
  return {
    observations,
    findings,
    perPageLimit: 5,
    keyLimit: 2,
    ancestorOwnershipLimit: 24,
    attributesPerNodeLimit: 128,
    attributeCodeUnitsPerNodeLimit: 16384,
    renderingOpportunityCount: 2,
    retainedContextRequired: true,
    applicationResetVerified: false,
    networkDependent: dependent,
  };
}
