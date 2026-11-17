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
    checkboxes: Array<Record<string, unknown>> = [];
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
      formLimit: 5,
      checkboxLimit: 5,
      successfulSubmissionAttempted: false,
    },
    findings,
  };
}
