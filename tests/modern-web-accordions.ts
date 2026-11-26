// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// accordion: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/accordion.md
// Toggle only retained heading-owned safe native buttons under quarantine.
// Check authored expanded/visible/focus state and restore; do not submit forms.
import type { ElementHandle, Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

/** Only heading-owned explicit disclosure buttons with an adjacent panel are identifiable. */
export async function inspectCustomAccordions(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Accordion probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const candidates = (await page
    .locator(
      'h1 > button[aria-expanded],h2 > button[aria-expanded],h3 > button[aria-expanded],h4 > button[aria-expanded],h5 > button[aria-expanded],h6 > button[aria-expanded]',
    )
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLButtonElement>[];
  let activationAttempts = 0;
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  for (const button of candidates.slice(0, 5)) {
    let dependentRequests = 0;
    const onRequest = () => dependentRequests++;
    let panel: ElementHandle<HTMLElement> | null = null;
    try {
      const target = await button.evaluateHandle(el =>
        el.parentElement?.nextElementSibling?.matches('div,section,article,ul,ol,dl,p')
          ? el.parentElement.nextElementSibling
          : null,
      );
      panel = target.asElement() as ElementHandle<HTMLElement> | null;
      if (!panel) {
        await target.dispose();
        observations.push({ status: 'not-probed', reason: 'no-adjacent-panel' });
        continue;
      }
      const state = () =>
        button.evaluate((el, content) => {
          const associationValid = ['aria-controls', 'commandfor'].every(attribute => {
            if (!el.hasAttribute(attribute)) return true;
            const ids = (el.getAttribute(attribute) || '').split(/\s+/).filter(Boolean);
            return (
              ids.length === 1 &&
              document.getElementById(ids[0]) === content &&
              document.querySelectorAll('#' + CSS.escape(ids[0])).length === 1
            );
          });
          const rendered = (node: Element) => {
            for (let current: Element | null = node; current; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (
                current.matches('[hidden],[inert],[aria-hidden="true"]') ||
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                style.contentVisibility === 'hidden'
              )
                return false;
            }
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const heading = el.parentElement;
          const contentName = (node: Node): boolean => {
            if (node instanceof Element) {
              const style = getComputedStyle(node);
              if (
                node.matches('[hidden],[aria-hidden="true"]') ||
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                style.contentVisibility === 'hidden'
              )
                return false;
              if (node instanceof HTMLImageElement && node.alt.trim()) return true;
            }
            return node.nodeType === Node.TEXT_NODE
              ? Boolean(node.textContent?.trim())
              : [...node.childNodes].some(contentName);
          };
          const references = (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .map(id => document.getElementById(id))
            .filter((target): target is HTMLElement => Boolean(target));
          const named = references.length
            ? references.some(target => target.textContent?.trim())
            : Boolean(el.getAttribute('aria-label')?.trim()) ||
              contentName(el) ||
              Boolean(el.title.trim());
          return {
            selector: el.id ? '#' + CSS.escape(el.id) : 'heading > button[aria-expanded]',
            connected:
              el.isConnected && content.isConnected && heading?.nextElementSibling === content,
            safe:
              el.type === 'button' &&
              !el.disabled &&
              !el.matches('[aria-disabled="true"],[aria-haspopup],[popovertarget]') &&
              (!el.hasAttribute('command') || el.getAttribute('command') === '--toggle') &&
              rendered(el),
            named,
            expanded: el.getAttribute('aria-expanded'),
            transitioning: content
              .getAnimations({ subtree: true })
              .some(animation => animation.playState === 'running'),
            panelVisible: rendered(content),
            associationValid,
            focused: document.activeElement === el,
            modalOutside: [...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(
              modal => rendered(modal) && !modal.contains(el),
            ),
          };
        }, panel!);
      const initial = await state();
      if (!initial.associationValid) {
        observations.push({ initial, status: 'not-probed', reason: 'ambiguous-panel-association' });
        continue;
      }
      if (
        !initial.named ||
        !['true', 'false'].includes(initial.expanded || '') ||
        (!initial.transitioning && (initial.expanded === 'true') !== initial.panelVisible)
      )
        findings.push({
          rule: 'widget-custom-accordion-semantics',
          guide: 'accordion',
          severity: 'warning',
          selector: initial.selector,
          evidence: {
            named: initial.named,
            expandedStateValid: ['true', 'false'].includes(initial.expanded || ''),
            expandedMatchesPanel: (initial.expanded === 'true') === initial.panelVisible,
          },
          recommendation:
            'Name each heading disclosure and synchronize its aria-expanded state with its adjacent panel; aria-controls is optional.',
        });
      if (!initial.safe || initial.modalOutside || initial.transitioning) {
        observations.push({
          initial,
          status: 'not-probed',
          reason: initial.modalOutside
            ? 'active-modal-outside-widget'
            : initial.transitioning
              ? 'transition-still-running'
              : 'disabled-submitter-or-popup-trigger',
        });
        continue;
      }
      const stable = async () => {
        const current = await state();
        if (
          !current.connected ||
          !current.safe ||
          !current.associationValid ||
          current.modalOutside
        )
          throw new Error('accordion-changed');
        return current;
      };
      const press = async (key: string) => {
        await stable();
        if (!(await state()).focused) throw new Error('focus-left-disclosure');
        activationAttempts++;
        await button.press(key, { timeout: 1500 });
        // eslint-disable-next-line playwright/no-wait-for-timeout -- Bounded state sample; longer transitions remain explicitly unverified.
        await page.waitForTimeout(150);
        return stable();
      };
      page.on('request', onRequest);
      await button.focus();
      await stable();
      const toggled = await press('Enter');
      // Do not close an always-open item after it becomes aria-disabled.
      const restored = await press('Space');
      const behaviorValid =
        toggled.focused &&
        restored.focused &&
        toggled.expanded !== initial.expanded &&
        toggled.panelVisible !== initial.panelVisible &&
        (toggled.expanded === 'true') === toggled.panelVisible &&
        restored.expanded === initial.expanded &&
        restored.panelVisible === initial.panelVisible;
      const transitioning = toggled.transitioning || restored.transitioning;
      if (!dependentRequests && !transitioning && !behaviorValid)
        findings.push({
          rule: 'widget-custom-accordion-keyboard',
          guide: 'accordion',
          severity: 'warning',
          selector: initial.selector,
          evidence: { initial, toggled, restored },
          recommendation:
            'Support Enter and Space disclosure activation, synchronize the panel and expanded state, and retain focus on the trigger.',
        });
      observations.push({
        initial,
        toggled,
        restored,
        status: dependentRequests || transitioning ? 'unverified' : 'observed',
        dependentRequests,
        reason: dependentRequests
          ? 'dependent-work-blocked'
          : transitioning
            ? 'transition-still-running'
            : null,
        siblingRestorationVerified: false,
      });
    } catch {
      observations.push({
        status: 'unverified',
        reason: 'disclosure-changed-focus-left-or-dependent-work-blocked',
        dependentRequests,
      });
    } finally {
      page.off('request', onRequest);
      await panel?.dispose();
    }
  }
  try {
    await originalFocus.evaluate(node => {
      if (node instanceof HTMLElement && node.isConnected) node.focus();
    });
  } catch {
    /* The page owns replacement nodes. */
  }
  await originalFocus.dispose();
  return {
    observations,
    activationAttempts,
    findings,
    candidateCount: candidates.length,
    sampleTruncated: candidates.length > 5,
    limit: 5,
    localSettleWindowMs: 150,
    siblingRestorationVerified: false,
    nativeCommandRequired: false,
  };
}
