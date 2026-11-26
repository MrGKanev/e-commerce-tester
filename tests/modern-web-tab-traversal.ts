// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// app-menus: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/app-menus.md
// toolbar: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/toolbar.md
// Use actual sequential Tab/inverse reentry, no injected focus stops/tabindex changes.
// Unknown browser/OS entry policy remains unverified instead of a false store warning.
import type { ElementHandle, Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

/** Real sequential keys; no injected tab stops or synthetic focus targets. */
export async function inspectCompositeTabs(
  page: Page,
  root: ElementHandle<HTMLElement>,
  items: ElementHandle<HTMLElement>[],
  kind: 'menubar' | 'toolbar',
  selector: string,
  stable: () => Promise<unknown>,
  focusEntry: () => Promise<void>,
) {
  const findings: WebFinding[] = [];
  const steps: Array<Record<string, unknown>> = [];
  const entryFindings: WebFinding[] = [];
  let sequentialEntryObserved = false;
  let requests = 0;
  const onRequest = () => requests++;
  const focusState = () =>
    root.evaluate((el, controls) => {
      const active = document.activeElement;
      let rendered = active instanceof HTMLElement && active !== document.body;
      for (let node = active; node instanceof Element; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          node.matches('[hidden],[inert],[aria-hidden="true"]') ||
          style.display === 'none' ||
          style.visibility !== 'visible' ||
          style.contentVisibility === 'hidden'
        )
          rendered = false;
      }
      const rect = active?.getBoundingClientRect();
      return {
        inside: Boolean(active && el.contains(active)),
        entryControl: active === el || controls.some(control => control === active),
        outsideRendered:
          rendered && Boolean(rect && rect.width > 0 && rect.height > 0) && !el.contains(active),
        browserOrDocumentFocus:
          !active ||
          active === document.body ||
          active === document.documentElement ||
          !document.hasFocus(),
        unsupportedSurface: active instanceof HTMLIFrameElement || Boolean(active?.shadowRoot),
      };
    }, items);
  page.on('request', onRequest);
  try {
    for (const [key, inverse] of [
      ['Tab', 'Shift+Tab'],
      ['Shift+Tab', 'Tab'],
    ] as const) {
      await focusEntry();
      await stable();
      const before = await focusState();
      if (!before.entryControl) throw new Error('entry-focus-unavailable');
      await page.keyboard.press(key);
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Bounded local focus/close observation, not a readiness delay.
      await page.waitForTimeout(100);
      await stable();
      const outside = await focusState();
      if (outside.browserOrDocumentFocus || outside.unsupportedSurface) {
        steps.push({
          key,
          outside,
          status: 'unverified',
          reason: 'browser-chrome-document-or-unsupported-focus-surface',
        });
        continue;
      }
      if (outside.inside || !outside.outsideRendered) {
        findings.push({
          rule: `widget-${kind}-tab-exit`,
          guide: kind === 'menubar' ? 'app-menus' : 'toolbar',
          severity: 'warning',
          selector,
          evidence: { key, outside },
          recommendation:
            'Let Tab and Shift+Tab leave the composite in one step, without stopping on another command or hidden content.',
        });
        steps.push({ key, outside, status: 'observed', reentryAttempted: false });
        continue;
      }
      // Keep the actual outside owner. Replacing it or moving focus while waiting
      // invalidates the return sample; never refocus a selector to manufacture entry.
      const owner = await page.evaluateHandle(() => document.activeElement);
      try {
        await stable();
        if (!(await owner.evaluate(node => node?.isConnected && node === document.activeElement)))
          throw new Error('outside-focus-changed');
        await page.keyboard.press(inverse);
        // eslint-disable-next-line playwright/no-wait-for-timeout -- Observe the inverse sequential focus step.
        await page.waitForTimeout(100);
        await stable();
        const returned = await focusState();
        if (returned.entryControl && !returned.browserOrDocumentFocus)
          sequentialEntryObserved = true;
        if (
          !returned.browserOrDocumentFocus &&
          !returned.unsupportedSurface &&
          !returned.entryControl
        )
          entryFindings.push({
            rule: `widget-${kind}-tab-entry`,
            guide: kind === 'menubar' ? 'app-menus' : 'toolbar',
            severity: 'warning',
            selector,
            evidence: { key, inverse, returned },
            recommendation:
              'Return sequential keyboard focus to the composite root or one of its top-level controls, rather than skipping the widget or landing in menu content.',
          });
        steps.push({
          key,
          inverse,
          outside,
          returned,
          status:
            returned.browserOrDocumentFocus || returned.unsupportedSurface
              ? 'unverified'
              : 'observed',
        });
      } finally {
        await owner.dispose();
      }
    }
    // Without an observed sequential entry from either side, native browser/OS
    // keyboard policy can explain a skipped button widget. Do not blame the store.
    if (sequentialEntryObserved) findings.push(...entryFindings);
    else if (entryFindings.length) {
      for (const step of steps) {
        if (step.returned) {
          step.status = 'unverified';
          step.reason = 'sequential-entry-policy-unverified';
        }
      }
    }
    await focusEntry();
    await stable();
    return {
      status:
        requests || steps.some(step => step.status === 'unverified') ? 'unverified' : 'observed',
      steps,
      sequentialEntryObserved,
      requests,
      findings: requests ? [] : findings,
      reason: requests ? 'dependent-work-blocked' : null,
    };
  } catch {
    return {
      status: 'unverified',
      reason: 'focus-owner-or-widget-changed',
      steps,
      requests,
      findings: [],
    };
  } finally {
    page.off('request', onRequest);
  }
}
