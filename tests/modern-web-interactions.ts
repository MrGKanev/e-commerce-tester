import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';
import { safeAuditUrl } from './modern-web';

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
  for (let index = 0; index < Math.min(await controls.count(), 5); index++) {
    // Retain this exact node: rerendering must not redirect a probe into a prefilled replacement.
    const control = (await controls.nth(index).elementHandle()) as ElementHandle<
      HTMLInputElement | HTMLTextAreaElement
    > | null;
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
      continue;
    }
    try {
      if (initial.ariaInvalid === 'true' && !initial.userInvalid)
        add(
          'interaction-premature-error',
          'required-field-feedback',
          initial.selector,
          { initial },
          'Review an error state exposed before interaction; distinguish server errors from premature required-field feedback.',
        );
      await control.fill(initial.type === 'email' ? 'not-an-email' : 'x', { timeout: 1500 });
      await control.fill('', { timeout: 1500 });
      await control.press('Tab', { timeout: 1500 });
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
      const rejected = await state();
      if (!rejected.valid && rejected.ariaInvalid === 'true' && !rejected.described)
        add(
          'interaction-error-description',
          'forms',
          initial.selector,
          { rejected },
          'Link an explicit invalid state to useful error text; native validation alone does not explain custom errors.',
        );
      await control.fill(
        initial.type === 'email'
          ? 'probe@example.test'
          : initial.type === 'url'
            ? 'https://example.test'
            : 'probe',
        { timeout: 1500 },
      );
      await control.press('Tab', { timeout: 1500 });
      const corrected = await state();
      if (corrected.valid && corrected.ariaInvalid === 'true')
        add(
          'interaction-stale-invalid',
          'validate-input-after-interaction',
          initial.selector,
          { corrected },
          'Clear stale aria-invalid after the field becomes valid.',
        );
      fields.push({
        selector: initial.selector,
        status: corrected.valid ? 'observed' : 'correction-unverified',
        initial,
        blurred,
        rejected,
        corrected,
      });
      await control.fill('', { timeout: 1500 });
    } catch {
      fields.push({
        selector: initial.selector,
        status: 'unverified',
        reason: 'control-changed-or-blocked-dependent-work',
      });
    }
  }
  const selectControls = page
    .locator(
      'select:required:enabled:not([multiple]):not([aria-disabled="true"]):not([inert], [inert] *)',
    )
    .filter({ visible: true });
  for (let index = 0; index < Math.min(await selectControls.count(), 5); index++) {
    const control = (await selectControls
      .nth(index)
      .elementHandle()) as ElementHandle<HTMLSelectElement> | null;
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
      continue;
    }
    if (!initial.empty) {
      selects.push({
        selector: initial.selector,
        status: 'not-probed',
        reason: 'prefilled-select',
      });
      continue;
    }
    const optionIndex = await control.evaluate(el =>
      [...el.options].findIndex(
        option =>
          Boolean(option.value) && !option.disabled && !option.closest('optgroup[disabled]'),
      ),
    );
    if (optionIndex < 0) {
      selects.push({
        selector: initial.selector,
        status: 'unverified',
        reason: 'no-enabled-nonempty-option',
      });
      continue;
    }
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
      if (initial.ariaInvalid === 'true' && !initial.userInvalid)
        add(
          'select-premature-error',
          'select-menu-interaction',
          initial.selector,
          { initial },
          'Review an explicit invalid state before selection; distinguish server validation from premature required-select feedback.',
        );
      await control.focus();
      await control.evaluate(el => el.reportValidity());
      // Allow bounded delayed polite announcements without collecting their text.
      await control.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
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
      await control.selectOption({ index: optionIndex }, { timeout: 1500 });
      await control.press('Tab', { timeout: 1500 });
      const corrected = await state();
      if (corrected.valid && corrected.ariaInvalid === 'true')
        add(
          'select-stale-invalid',
          'select-menu-interaction',
          initial.selector,
          { corrected },
          'Clear stale aria-invalid after a real option satisfies the required select.',
        );
      selects.push({
        selector: initial.selector,
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
      selects.push({
        selector: initial.selector,
        status: 'unverified',
        reason: 'control-changed-or-blocked-dependent-work',
      });
    } finally {
      await announcements.evaluate(value => value.stop()).catch(() => {});
      await announcements.dispose();
      // Restore this node only. Never select into a replacement node that may contain customer data.
      await control
        .evaluate((el, selectedIndex) => {
          if (!el.isConnected) return;
          el.selectedIndex = selectedIndex;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, initial.selectedIndex)
        .catch(() => {});
    }
  }
  const checks = page
    .locator(
      'input[type="checkbox"]:not([disabled]), [role="checkbox"]:not([aria-disabled="true"]):not([aria-readonly="true"])',
    )
    .filter({ visible: true });
  for (let index = 0; index < Math.min(await checks.count(), 5); index++) {
    const control = await checks.nth(index).elementHandle();
    if (!control) continue;
    try {
      const state = () =>
        control.evaluate(el => ({
          selector: el.id ? '#' + CSS.escape(el.id) : 'checkbox',
          checked:
            el instanceof HTMLInputElement ? String(el.checked) : el.getAttribute('aria-checked'),
        }));
      const before = await state();
      await control.focus();
      await control.press('Space', { timeout: 1500 });
      const toggled = await state();
      await control.press('Space', { timeout: 1500 });
      const restored = await state();
      if (before.checked === toggled.checked || before.checked !== restored.checked)
        add(
          'interaction-checkbox-keyboard',
          'checkbox',
          before.selector,
          { before, toggled, restored },
          'Support Space toggling and reversal while exposing the checked state.',
        );
      checkboxes.push({ before, toggled, restored });
    } catch {
      checkboxes.push({ status: 'unverified', reason: 'control-changed' });
    }
  }
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      fields,
      checkboxes,
      selects,
      selectLimit: 5,
      formLimit: 5,
      checkboxLimit: 5,
      successfulSubmissionAttempted: false,
    },
    findings,
  };
}
