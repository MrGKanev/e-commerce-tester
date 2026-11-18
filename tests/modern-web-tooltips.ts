import type { Page, ElementHandle } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

type Point = { x: number; y: number };

/** Explicit tooltip relationships only. Focus/hover never activates a link or application command. */
export async function inspectTooltips(page: Page, restorePointer?: Point) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Tooltip probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const add = (
    rule: string,
    guide: string,
    selector: string,
    evidence: Record<string, unknown>,
    recommendation: string,
  ) => findings.push({ rule, guide, selector, evidence, recommendation, severity: 'warning' });
  const settle = (ms: number) =>
    page.evaluate(delay => new Promise<void>(resolve => setTimeout(resolve, delay)), ms);
  const candidates = await page.evaluateHandle(() => {
    const result: Array<{ trigger: HTMLElement; target: HTMLElement; relationship: string }> = [];
    for (const trigger of [
      ...document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]'),
    ].slice(0, 2000)) {
      if (trigger.matches(':disabled,[aria-disabled="true"],[inert],[inert] *')) continue;
      const ids = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      const interest = trigger.getAttribute('interestfor');
      if (interest) ids.unshift(interest);
      for (const id of [...new Set(ids)]) {
        const target = document.getElementById(id);
        if (!(target instanceof HTMLElement)) continue;
        if (
          target.getAttribute('role') !== 'tooltip' &&
          !(interest === id && target.getAttribute('popover') === 'hint')
        )
          continue;
        const rect = trigger.getBoundingClientRect(),
          style = getComputedStyle(trigger);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.visibility !== 'visible' ||
          style.display === 'none' ||
          trigger.closest('[hidden],[inert]')
        )
          continue;
        result.push({
          trigger,
          target,
          relationship: interest === id ? 'interestfor' : 'aria-describedby',
        });
        if (result.length >= 5) return result;
      }
    }
    return result;
  });
  const properties = await candidates.getProperties();
  try {
    for (const [key, candidate] of properties) {
      if (!/^\d+$/.test(key)) continue;
      const trigger = (
        await candidate.getProperty('trigger')
      ).asElement() as ElementHandle<HTMLElement>;
      const target = (
        await candidate.getProperty('target')
      ).asElement() as ElementHandle<HTMLElement>;
      const relationship = (await (
        await candidate.getProperty('relationship')
      ).jsonValue()) as string;
      const state = () =>
        target.evaluate((el, triggerElement) => {
          const rect = el.getBoundingClientRect(),
            style = getComputedStyle(el);
          const visible =
            el.isConnected &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility === 'visible' &&
            style.display !== 'none' &&
            Number(style.opacity) > 0 &&
            !el.closest('[hidden],[inert]');
          const selector = (element: Element): string => {
            if (element.id) return '#' + CSS.escape(element.id);
            const parent = element.parentElement;
            if (!parent) return element.localName;
            const peers = [...parent.children].filter(peer => peer.localName === element.localName);
            return `${selector(parent)} > ${element.localName}:nth-of-type(${peers.indexOf(element) + 1})`;
          };
          const trigger = triggerElement as HTMLElement;
          const tr = trigger.getBoundingClientRect();
          const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
          const popoverOpen =
            el.hasAttribute('popover') && CSS.supports('selector(:popover-open)')
              ? el.matches(':popover-open')
              : false;
          return {
            connected: el.isConnected && trigger.isConnected,
            visible,
            popoverOpen,
            clippedByViewport:
              visible &&
              (rect.left < -2 ||
                rect.top < -2 ||
                rect.right > innerWidth + 2 ||
                rect.bottom > innerHeight + 2),
            triggerOccludedByTooltip: visible && Boolean(hit && (hit === el || el.contains(hit))),
            focusInsideTooltip:
              el === document.activeElement || el.contains(document.activeElement),
            triggerFocused: trigger === document.activeElement,
            interestApiPresent: 'interestForElement' in HTMLButtonElement.prototype,
            popoverApiPresent: 'popover' in HTMLElement.prototype,
            selector: selector(trigger),
            otherOpenOverlay: [
              ...document.querySelectorAll('dialog[open],[aria-modal="true"],[popover]'),
            ].some(
              other =>
                other !== el &&
                ((other instanceof HTMLDialogElement && other.matches(':modal')) ||
                  other.getAttribute('aria-modal') === 'true' ||
                  (other.hasAttribute('popover') &&
                    CSS.supports('selector(:popover-open)') &&
                    other.matches(':popover-open'))),
            ),
          };
        }, trigger);
      try {
        const initial = await state();
        if (initial.visible || initial.otherOpenOverlay) {
          observations.push({
            relationship,
            initial,
            status: 'not-probed',
            reason: initial.visible ? 'tooltip-already-visible' : 'another-overlay-open',
          });
          continue;
        }
        await page.mouse.move(0, 0);
        await trigger.focus();
        // Authors may use a delay. Bounded absence is explicitly unverified, not proof of failure.
        await settle(700);
        const focused = await state();
        if (!focused.connected) throw new Error('Tooltip nodes changed');
        if (focused.visible && focused.focusInsideTooltip)
          add(
            'tooltip-focus-moved',
            'interest-triggered-tooltips',
            focused.selector,
            { relationship, focusMovedIntoHint: true },
            'Do not move focus into supplemental tooltip content on focus/hover alone; preserve the trigger focus.',
          );
        let escape: Record<string, unknown> = { status: 'not-observed' };
        if (focused.visible && !focused.otherOpenOverlay) {
          await page.keyboard.press('Escape');
          // Normal fade-out transitions may outlast an immediate Escape key response.
          await page
            .waitForFunction(
              el => {
                const rect = el.getBoundingClientRect(),
                  style = getComputedStyle(el);
                return (
                  !el.isConnected ||
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.visibility !== 'visible' ||
                  style.display === 'none' ||
                  Number(style.opacity) === 0 ||
                  Boolean(el.closest('[hidden],[inert]'))
                );
              },
              target,
              { timeout: 700 },
            )
            .catch(() => {});
          const dismissed = await state();
          escape = { status: 'observed', remainsVisible: dismissed.visible };
          if (dismissed.visible)
            add(
              'tooltip-escape-dismissal',
              'interest-triggered-tooltips',
              focused.selector,
              { relationship, remainsVisible: true, sampleWindowMs: 700 },
              'Make supplemental hover/focus content dismissible without moving focus, for example with Escape; verify delayed transitions and essential-content alternatives.',
            );
        }
        await trigger.evaluate(el => el.blur());
        await page.mouse.move(0, 0);
        await settle(150);
        await trigger.hover({ timeout: 1500 });
        await settle(700);
        const hovered = await state();
        if (!hovered.connected) throw new Error('Tooltip nodes changed');
        if (hovered.visible && !focused.visible && focused.triggerFocused)
          add(
            'tooltip-focus-discovery',
            'interest-triggered-tooltips',
            hovered.selector,
            { relationship, hoverVisible: true, focusVisible: false, sampleWindowMs: 700 },
            'Expose equivalent supplemental information on keyboard focus; a hover-only tooltip cannot be discovered by keyboard users.',
          );
        for (const [mode, observed] of [
          ['focus', focused],
          ['hover', hovered],
        ] as const) {
          if (observed.clippedByViewport)
            add(
              'tooltip-viewport-clipping',
              'position-aware-tooltips',
              observed.selector,
              { mode, relationship, clippedByViewport: true },
              'Keep visible tooltip content within the viewport using a supported positioning fallback; arrow orientation and nested clipping still require review.',
            );
          if (observed.triggerOccludedByTooltip)
            add(
              'tooltip-trigger-occlusion',
              'position-aware-tooltips',
              observed.selector,
              { mode, relationship, triggerCenterCovered: true },
              'Position or dismiss the tooltip so it does not obscure the focused trigger; this sample checks only the trigger center.',
            );
        }
        let hoverability: Record<string, unknown> = {
          status: 'not-probed',
          reason: 'tooltip-not-visible-on-hover',
        };
        if (hovered.visible && !hovered.otherOpenOverlay) {
          const destination = await target.evaluate(el => {
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2,
              y = r.top + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return {
              x,
              y,
              reachable:
                x > 0 &&
                y > 0 &&
                x < innerWidth &&
                y < innerHeight &&
                Boolean(hit && (hit === el || el.contains(hit))),
            };
          });
          if (destination.reachable) {
            // Move through the gap rather than teleporting or focusing tooltip content.
            await page.mouse.move(destination.x, destination.y, { steps: 12 });
            await settle(700);
            const entered = await state();
            if (!entered.connected) throw new Error('Tooltip nodes changed');
            const pointerOverTarget = await target.evaluate((el, point) => {
              const hit = document.elementFromPoint(point.x, point.y);
              return Boolean(hit && (hit === el || el.contains(hit)));
            }, destination);
            hoverability = {
              status: entered.visible && !pointerOverTarget ? 'unverified' : 'observed',
              reason:
                entered.visible && !pointerOverTarget
                  ? 'tooltip-moved-away-from-sampled-pointer'
                  : null,
              pointerOverTarget,
              remainsVisible: entered.visible,
              sampleWindowMs: 700,
              pathSteps: 12,
            };
            if (!entered.visible)
              add(
                'tooltip-hover-persistence',
                'interest-triggered-tooltips',
                hovered.selector,
                { relationship, remainsVisible: false, sampleWindowMs: 700, pathSteps: 12 },
                'Allow the pointer to enter and remain over supplemental tooltip content; review the sampled gap path and any intentional content invalidation.',
              );
          } else {
            hoverability = {
              status: 'unverified',
              reason: 'tooltip-center-outside-viewport-or-occluded',
            };
          }
        }
        observations.push({
          relationship,
          initial,
          focused,
          hovered,
          hoverability,
          escape,
          status: focused.visible || hovered.visible ? 'observed' : 'unverified',
          reason:
            focused.visible || hovered.visible
              ? null
              : 'not-shown-within-bounded-focus-hover-window',
          touchLongPressVerified: false,
          screenReaderSpeechVerified: false,
          arrowDirectionVerified: false,
        });
      } catch {
        observations.push({
          relationship,
          status: 'unverified',
          reason: 'nodes-changed-or-dependent-work-blocked',
        });
      } finally {
        await trigger
          .evaluate(el => {
            if (el.isConnected) el.blur();
          })
          .catch(() => {});
        await page.mouse.move(0, 0).catch(() => {});
        // Allow authored loss-of-interest delays before the next probe inherits this page.
        await page
          .waitForFunction(
            el => {
              const r = el.getBoundingClientRect(),
                style = getComputedStyle(el);
              return (
                !el.isConnected ||
                r.width <= 0 ||
                r.height <= 0 ||
                style.visibility !== 'visible' ||
                style.display === 'none' ||
                Number(style.opacity) === 0 ||
                Boolean(el.closest('[hidden],[inert]'))
              );
            },
            target,
            { timeout: 700 },
          )
          .catch(() => {});
        const observation = observations.at(-1);
        if (observation?.status === 'observed' || observation?.status === 'unverified') {
          const cleaned = await state().catch(() => null);
          observation.cleanup = {
            status: cleaned?.connected && !cleaned.visible ? 'restored' : 'unverified',
            tooltipRemainsVisible: cleaned?.visible ?? null,
            sampleWindowMs: 700,
          };
        }
      }
    }
  } finally {
    await originalFocus
      .evaluate(el => {
        if (el instanceof HTMLElement && el.isConnected) {
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== el) active.blur();
          el.focus({ preventScroll: true });
        }
      })
      .catch(() => {});
    await originalFocus.dispose();
    await candidates.dispose();
    await page
      .evaluate(
        position => scrollTo({ left: position.x, top: position.y, behavior: 'instant' }),
        originalScroll,
      )
      .catch(() => {});
    await page.mouse.move(restorePointer?.x ?? 0, restorePointer?.y ?? 0).catch(() => {});
  }
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      observations,
      sampleLimit: 5,
      triggerScanLimit: 2000,
      successfulActivationAttempted: false,
      pointerRestoration: restorePointer
        ? 'caller-supplied-origin'
        : 'origin-unavailable-parked-at-viewport-origin',
      touchLongPressVerified: false,
    },
    findings,
  };
}
