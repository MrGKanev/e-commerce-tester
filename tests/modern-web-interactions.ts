// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// forms: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// checkbox: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/checkbox.md
// required-field-feedback: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/required-field-feedback.md
// Freeze network and prevent submission before bounded invalid/corrected/reversal
// samples. Never attempt successful business submissions or export entered values.
import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';
import { safeAuditUrl } from './modern-web';
import { inspectCheckboxes } from './modern-web-checkboxes';
import {
  inspectFieldContent,
  inspectHorizontalFieldContent,
  inspectRtlFieldContent,
  inspectBidiFieldContent,
  inspectInputFieldContent,
} from './modern-web-field-content';

/** Install before navigation. Freeze network and prevent submissions before exercising controls. */
export async function prepareInteractionProbe(page: Page) {
  let frozen = false,
    blockedRequests = 0,
    blockedSockets = 0;
  await page.context().route('**/*', route => {
    if (!frozen) return route.fallback();
    blockedRequests++;
    return route.abort('blockedbyclient');
  });
  await page.context().routeWebSocket('**', async socket => {
    blockedSockets++;
    await socket.close();
  });
  await page.addInitScript(() => {
    document.addEventListener(
      'submit',
      event => {
        if ((window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
  return {
    async freeze() {
      frozen = true;
      await page.evaluate(() => {
        (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe = true;
      });
    },
    counts: () => ({ blockedRequests, blockedSockets }),
  };
}

/** Destructive/real-value submission is never attempted. A fresh test page owns these changes. */
export async function inspectInteractions(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Interaction probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const fields: Array<Record<string, unknown>> = [],
    checkboxes: Array<Record<string, unknown>> = [],
    selects: Array<Record<string, unknown>> = [];
  const add = (
    rule: string,
    guide: string,
    selector: string,
    evidence: Record<string, unknown>,
    recommendation: string,
  ) => findings.push({ rule, guide, severity: 'warning', selector, evidence, recommendation });
  const controls = page
    .locator(
      'input:required:not([disabled]):not([readonly]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea:required:not([disabled]):not([readonly])',
    )
    .filter({ visible: true });
  for (const candidate of (await controls.elementHandles()).slice(0, 5)) {
    // Retain this exact node: rerendering must not redirect a probe into a prefilled replacement.
    const control = candidate as ElementHandle<HTMLInputElement | HTMLTextAreaElement> | null;
    if (!control) continue;
    const state = () =>
      control.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => ({
        selector: el.id ? '#' + CSS.escape(el.id) : el.localName + '[required]',
        type: el instanceof HTMLInputElement ? el.type : 'textarea',
        valid: el.validity.valid,
        ariaInvalid: el.getAttribute('aria-invalid'),
        userInvalid: el.matches(':user-invalid'),
        empty: !el.value,
        described: ['aria-describedby', 'aria-errormessage'].some(attr =>
          (el.getAttribute(attr) || '')
            .split(/\s+/)
            .some(id => document.getElementById(id)?.textContent?.trim()),
        ),
      }));
    const initial = await state();
    // Preserve existing customer data; only probe empty text/email/password fields.
    if (
      !initial.empty ||
      !['text', 'email', 'password', 'textarea', 'search', 'tel', 'url'].includes(initial.type)
    ) {
      fields.push({
        selector: initial.selector,
        status: 'not-probed',
        reason: 'prefilled-or-unsupported-control',
      });
      await control.dispose();
      continue;
    }
    // Source: forms guide above, sections 4 and 10: observe input/blur feedback
    // without recording values. Ownership is our safety contract, not a guide rule.
    // A retained node alone is insufficient: input/blur handlers can replace its
    // value, disable it or detach it. Stop rather than overwrite that new state.
    let ownedValue = '';
    const findingStart = findings.length;
    const assertOwned = async () => {
      const owned = await control.evaluate(
        (el, expected) =>
          el.isConnected &&
          !el.matches(':disabled, [aria-disabled="true"]') &&
          !el.readOnly &&
          el.value === expected &&
          !el.closest('[inert], [aria-hidden="true"]'),
        ownedValue,
      );
      if (!owned) throw new Error('Required field ownership changed');
    };
    const fillOwned = async (value: string) => {
      await assertOwned();
      ownedValue = value;
      await control.fill(value, { timeout: 1500 });
      await assertOwned();
    };
    const observation: Record<string, unknown> = { selector: initial.selector };
    try {
      await assertOwned();
      if (initial.ariaInvalid === 'true' && !initial.userInvalid)
        add(
          'interaction-premature-error',
          'required-field-feedback',
          initial.selector,
          { initial },
          'Review an error state exposed before interaction; distinguish server errors from premature required-field feedback.',
        );
      await fillOwned(initial.type === 'email' ? 'not-an-email' : 'x');
      await fillOwned('');
      await control.press('Tab', { timeout: 1500 });
      await assertOwned();
      const blurred = await state();
      if (blurred.userInvalid && blurred.ariaInvalid !== 'true')
        add(
          'interaction-invalid-aria',
          'validate-input-after-interaction',
          initial.selector,
          { blurred },
          'Synchronize the interacted invalid state with accessible error feedback.',
        );
      await control.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => el.reportValidity());
      await assertOwned();
      const rejected = await state();
      if (!rejected.valid && rejected.ariaInvalid === 'true' && !rejected.described)
        add(
          'interaction-error-description',
          'forms',
          initial.selector,
          { rejected },
          'Link an explicit invalid state to useful error text; native validation alone does not explain custom errors.',
        );
      await fillOwned(
        initial.type === 'email'
          ? 'probe@example.test'
          : initial.type === 'url'
            ? 'https://example.test'
            : 'probe',
      );
      await control.press('Tab', { timeout: 1500 });
      await assertOwned();
      const corrected = await state();
      if (corrected.valid && corrected.ariaInvalid === 'true')
        add(
          'interaction-stale-invalid',
          'validate-input-after-interaction',
          initial.selector,
          { corrected },
          'Clear stale aria-invalid after the field becomes valid.',
        );
      Object.assign(observation, {
        status: corrected.valid ? 'observed' : 'correction-unverified',
        initial,
        blurred,
        rejected,
        corrected,
      });
    } catch {
      findings.splice(findingStart);
      Object.assign(observation, {
        status: 'unverified',
        reason: 'control-changed-or-blocked-dependent-work',
      });
    } finally {
      // Cleanup is one synchronous compare-and-clear on the retained node. Never
      // re-resolve its selector or clear a value supplied by an authored handler.
      // Native setter + input lets controlled/auto-growing fields observe reset;
      // it does not certify application-level restoration or a successful reset.
      observation.restoration = await control
        .evaluate((el, expected) => {
          if (!el.isConnected) return { status: 'not-restored', reason: 'detached-control' };
          if (
            el.value !== expected ||
            el.matches(':disabled, [aria-disabled="true"]') ||
            el.readOnly ||
            el.closest('[inert], [aria-hidden="true"]')
          )
            return { status: 'not-restored', reason: 'control-ownership-changed' };
          if (!expected) return { status: 'unchanged' };
          const prototype =
            el instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          return el.isConnected && el.value === ''
            ? { status: 'restored' }
            : { status: 'not-restored', reason: 'reset-handler-changed-control' };
        }, ownedValue)
        .catch(() => ({ status: 'not-restored', reason: 'control-unavailable' }));
      fields.push(observation);
      await control.dispose();
    }
  }
  const selectControls = page
    .locator(
      'select:required:enabled:not([multiple]):not([aria-disabled="true"]):not([inert], [inert] *)',
    )
    .filter({ visible: true });
  for (const candidate of (await selectControls.elementHandles()).slice(0, 5)) {
    const control = candidate as ElementHandle<HTMLSelectElement> | null;
    if (!control) continue;
    const state = () =>
      control.evaluate(el => ({
        selector: el.id ? '#' + CSS.escape(el.id) : 'select[required]',
        empty: !el.value,
        valid: el.validity.valid,
        userInvalid: el.matches(':user-invalid'),
        ariaInvalid: el.getAttribute('aria-invalid'),
        selectedIndex: el.selectedIndex,
        displaySize: el.size,
        described: ['aria-describedby', 'aria-errormessage'].some(attr =>
          (el.getAttribute(attr) || '')
            .split(/\s+/)
            .some(id => document.getElementById(id)?.textContent?.trim()),
        ),
      }));
    const initial = await state();
    if (initial.displaySize > 1) {
      selects.push({ selector: initial.selector, status: 'not-probed', reason: 'listbox-select' });
      await control.dispose();
      continue;
    }
    if (!initial.empty) {
      selects.push({
        selector: initial.selector,
        status: 'not-probed',
        reason: 'prefilled-select',
      });
      await control.dispose();
      continue;
    }
    // Sources: select-menu-interaction and forms; observe invalid/change/blur
    // feedback, not successful submissions or real OS picker/AT operation.
    // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/select-menu-interaction.md
    // A retained select alone is insufficient: option identity/order/value or the
    // selection can change in authored handlers. Compare exact owners before
    // actions and atomically before cleanup; never restore a stale numeric index.
    // This 512-option ownership cap is repository safety policy, not a store rule.
    // Private signatures stay inside this page handle. Restoration records only
    // DOM selection, not validation UI, dirty flags or application reset state.
    const ownership = await control.evaluateHandle(el => {
      const limited = el.options.length > 512;
      const options = limited ? [] : [...el.options];
      const signatures = options.map(option => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
        hidden: option.hidden,
        defaultSelected: option.defaultSelected,
        parent: option.parentElement,
        groupDisabled: option.closest('optgroup')?.disabled ?? false,
        groupHidden: option.closest('optgroup')?.hidden ?? false,
      }));
      const original: HTMLOptionElement | null = el.selectedOptions[0] || null;
      let expected: HTMLOptionElement | null = original;
      let touched = false;
      const candidate =
        options.find(
          option =>
            Boolean(option.value) &&
            !option.disabled &&
            !option.closest('optgroup[disabled],[hidden],[inert],[aria-hidden="true"]'),
        ) || null;
      const stable = () =>
        !limited &&
        el.isConnected &&
        el.getRootNode() === document &&
        el.required &&
        !el.multiple &&
        el.size <= 1 &&
        !el.matches(':disabled,[aria-disabled="true"]') &&
        !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
        // Source: https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-showmodal
        // Native modal inertness need not appear as an inert attribute. Hidden
        // ARIA dialog templates are not open overlays merely because of a role.
        !document.querySelector('dialog[open]') &&
        ![...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(dialog => {
          const rect = dialog.getBoundingClientRect(),
            style = getComputedStyle(dialog);
          return (
            !dialog.closest('[hidden],[aria-hidden="true"]') &&
            style.visibility === 'visible' &&
            rect.width > 0 &&
            rect.height > 0
          );
        }) &&
        options.length === el.options.length &&
        options.every((option, index) => {
          const before = signatures[index];
          return (
            el.options[index] === option &&
            option.value === before.value &&
            option.label === before.label &&
            option.disabled === before.disabled &&
            option.hidden === before.hidden &&
            option.defaultSelected === before.defaultSelected &&
            option.parentElement === before.parent &&
            (option.closest('optgroup')?.disabled ?? false) === before.groupDisabled &&
            (option.closest('optgroup')?.hidden ?? false) === before.groupHidden
          );
        });
      const selected = (option: HTMLOptionElement | null) =>
        el.selectedOptions.length === (option ? 1 : 0) &&
        (el.selectedOptions[0] || null) === option;
      const owned = () => stable() && selected(expected);
      return {
        candidate,
        limited,
        owned: (requireFocus: boolean) =>
          owned() && (!requireFocus || document.activeElement === el),
        choose: () => {
          if (!owned()) return false;
          expected = candidate;
          touched = true;
          return true;
        },
        restore: () => {
          if (!owned())
            return { status: 'not-restored', reason: 'selection-or-options-ownership-changed' };
          if (!touched) return { status: 'unchanged' };
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex')!.set!.call(
            el,
            original ? options.indexOf(original) : -1,
          );
          const restored = () => stable() && selected(original);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          // Do not emit another event after an input handler supplies new state.
          if (!restored())
            return { status: 'not-restored', reason: 'reset-handler-changed-control' };
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return restored()
            ? { status: 'restored' }
            : { status: 'not-restored', reason: 'reset-handler-changed-control' };
        },
      };
    });
    const option = (await ownership.getProperty('candidate')).asElement();
    if (!option) {
      selects.push({
        selector: initial.selector,
        status: 'unverified',
        reason: (await ownership.evaluate(value => value.limited))
          ? 'option-ownership-limit'
          : 'no-enabled-nonempty-option',
      });
      await ownership.dispose();
      await control.dispose();
      continue;
    }
    const findingStart = findings.length;
    const observation: Record<string, unknown> = { selector: initial.selector };
    const assertOwned = async (requireFocus = false) => {
      if (
        !(await ownership.evaluate(
          (value, requireFocus) => value.owned(requireFocus),
          requireFocus,
        ))
      )
        throw new Error('Select selection or option ownership changed');
    };
    // Only booleans/timing are retained: a global live-region change is not proof of speech or causality.
    const announcements = await control.evaluateHandle(() => {
      const started = performance.now();
      const changes: Array<{ elapsedMs: number; politeness: string; textPresent: boolean }> = [];
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const target =
            record.target instanceof Element ? record.target : record.target.parentElement;
          const region = target?.closest('[aria-live], [role="status"], [role="alert"]');
          if (!region || changes.length >= 20) continue;
          const politeness =
            region.getAttribute('aria-live') ||
            (region.getAttribute('role') === 'alert' ? 'assertive' : 'polite');
          if (!['polite', 'assertive'].includes(politeness)) continue;
          changes.push({
            elapsedMs: Math.round(performance.now() - started),
            politeness: politeness === 'assertive' ? 'assertive' : 'polite',
            textPresent: Boolean(region.textContent?.trim()),
          });
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      return { changes, stop: () => observer.disconnect() };
    });
    try {
      await assertOwned();
      if (initial.ariaInvalid === 'true' && !initial.userInvalid)
        add(
          'select-premature-error',
          'select-menu-interaction',
          initial.selector,
          { initial },
          'Review an explicit invalid state before selection; distinguish server validation from premature required-select feedback.',
        );
      await control.focus();
      await assertOwned(true);
      await control.evaluate(el => el.reportValidity());
      // Allow bounded delayed polite announcements without collecting their text.
      await control.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
      await assertOwned(true);
      const rejected = await state();
      if (rejected.valid)
        add(
          'select-placeholder-valid',
          'select-menu-interaction',
          initial.selector,
          { rejected },
          'Verify that the empty placeholder in this mandatory select is rejected by native constraints.',
        );
      if (!rejected.valid && rejected.ariaInvalid === 'true' && !rejected.described)
        add(
          'select-error-description',
          'accessible-error-announcement',
          initial.selector,
          { rejected },
          'Associate useful error text with an explicitly invalid select.',
        );
      await assertOwned(true);
      if (!(await ownership.evaluate(value => value.choose()))) throw new Error('Select changed');
      await control.selectOption(option, { timeout: 1500 });
      await assertOwned(true);
      // Global keyboard preserves authored focus theft instead of refocusing it.
      await page.keyboard.press('Tab');
      await assertOwned();
      const corrected = await state();
      if (corrected.valid && corrected.ariaInvalid === 'true')
        add(
          'select-stale-invalid',
          'select-menu-interaction',
          initial.selector,
          { corrected },
          'Clear stale aria-invalid after a real option satisfies the required select.',
        );
      Object.assign(observation, {
        status: corrected.valid ? 'observed' : 'correction-unverified',
        initial,
        rejected,
        corrected,
        liveRegionObservations: await announcements.evaluate(value => value.changes),
        announcementWindowMs: 600,
        speechVerified: false,
        announcementCausalityVerified: false,
      });
    } catch {
      findings.splice(findingStart);
      Object.assign(observation, {
        status: 'unverified',
        reason: 'control-changed-or-blocked-dependent-work',
      });
    } finally {
      await announcements.evaluate(value => value.stop()).catch(() => {});
      await announcements.dispose();
      observation.restoration = await ownership
        .evaluate(value => value.restore())
        .catch(() => ({ status: 'not-restored', reason: 'control-unavailable' }));
      selects.push(observation);
      await option.dispose();
      await ownership.dispose();
      await control.dispose();
    }
  }

  const checkboxProbe = await inspectCheckboxes(page);
  checkboxes.push(...checkboxProbe.observations);
  findings.push(...checkboxProbe.findings);
  const fieldContent = await inspectFieldContent(page);
  findings.push(...fieldContent.findings);
  const horizontalFieldContent = await inspectHorizontalFieldContent(page);
  findings.push(...horizontalFieldContent.findings);
  const rtlFieldContent = await inspectRtlFieldContent(page);
  const bidiFieldContent = await inspectBidiFieldContent(page);
  const inputFieldContent = await inspectInputFieldContent(page);
  findings.push(
    ...rtlFieldContent.findings,
    ...bidiFieldContent.findings,
    ...inputFieldContent.findings,
  );
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      fields,
      fieldContent,
      horizontalFieldContent,
      rtlFieldContent,
      bidiFieldContent,
      inputFieldContent,
      checkboxes,
      selects,
      selectLimit: 5,
      selectOptionOwnershipLimit: 512,
      formLimit: 5,
      checkboxLimit: checkboxProbe.limit,
      checkboxKeyLimit: checkboxProbe.keyLimit,
      checkboxSettleWindowMs: checkboxProbe.settleWindowMs,
      checkboxApplicationResetVerified: false,
      successfulSubmissionAttempted: false,
    },
    findings,
  };
}
