// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// carousel: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/carousel.md
// Only explicitly associated reversible next/previous controls are exercised.
// No slide labels, autoplay semantics, gestures or asynchronous completion are guessed.
import type { Page, ElementHandle } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

/** Optional, explicit slide controls only; fresh quarantined pages own these bounded changes. */
export async function inspectCarousels(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Carousel probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  let canRestore = true;
  const focus = await page.evaluateHandle(() => {
    const original = document.activeElement;
    const chain = (el: Element | null) => {
      const nodes: Element[] = [];
      for (; el; el = el.parentElement) nodes.push(el);
      return nodes;
    };
    const signature = (el: Element) =>
      [
        'id',
        'role',
        'tabindex',
        'type',
        'disabled',
        'hidden',
        'inert',
        'aria-hidden',
        'aria-label',
        'aria-labelledby',
      ].map(name => el.getAttribute(name));
    const ancestors = chain(original);
    const signatures = ancestors.map(signature);
    let expected: Element | null = null;
    let lost = false;
    const onFocus = (event: FocusEvent) => {
      if (expected && event.target !== expected) lost = true;
    };
    const onBlur = (event: FocusEvent) => {
      if (expected && event.target === expected) lost = true;
    };
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    const owned = () => !lost && (!expected || document.activeElement === expected);
    return {
      expectFocus: (el: Element) => {
        expected = el;
      },
      owned,
      restore: () => {
        const current = chain(original);
        if (
          !owned() ||
          !original?.isConnected ||
          current.length !== ancestors.length ||
          !current.every(
            (el, i) =>
              el === ancestors[i] &&
              JSON.stringify(signature(el)) === JSON.stringify(signatures[i]),
          )
        )
          return false;
        if (!expected) return true;
        expected = original;
        if (original instanceof HTMLElement) {
          if (original === document.body && document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          original.focus({ preventScroll: true });
        }
        return owned();
      },
      dispose: () => {
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('focusout', onBlur, true);
      },
    };
  });
  const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const roots = (await page
    .locator('[aria-roledescription="carousel"]')
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  try {
    for (const root of roots.slice(0, 3)) {
      const bundle = await root.evaluateHandle(root => {
        const owned = (el: Element) => el.closest('[aria-roledescription="carousel"]') === root;
        const slides = [
          ...root.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'),
        ].filter(owned);
        const buttons = [
          ...root.querySelectorAll<HTMLButtonElement>('button[type="button"][aria-label]'),
        ].filter(el => owned(el) && !el.closest('[aria-roledescription="slide"]'));
        const nodes = [root, ...slides, ...buttons];
        const parents = nodes.map(el => el.parentElement);
        const signature = (el: Element) =>
          JSON.stringify(
            ['id', 'role', 'aria-roledescription', 'aria-label', 'aria-labelledby'].map(name =>
              el.getAttribute(name),
            ),
          );
        const signatures = nodes.map(signature);
        return {
          contextRetained: () =>
            nodes.every(
              (el, i) =>
                el.isConnected &&
                el.parentElement === parents[i] &&
                signature(el) === signatures[i],
            ),
          root,
          slides,
          next: buttons.filter(el =>
            /^next slide$/i.test(el.getAttribute('aria-label')?.trim() || ''),
          ),
          previous: buttons.filter(el =>
            /^previous slide$/i.test(el.getAttribute('aria-label')?.trim() || ''),
          ),
        };
      });
      const snapshot = () =>
        bundle.evaluate(({ root, slides, next, previous, contextRetained }) => {
          const visible = (el: Element) => {
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el);
            for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
              if (getComputedStyle(ancestor).contentVisibility === 'hidden') return false;
            }
            return (
              !el.closest('[hidden],[inert]') &&
              s.display !== 'none' &&
              s.visibility === 'visible' &&
              Number(s.opacity) > 0 &&
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
          const currentSlides = [...root.querySelectorAll('[aria-roledescription="slide"]')].filter(
            el => el.closest('[aria-roledescription="carousel"]') === root,
          );
          const rendered = slides.map(visible);
          const retained = (buttons: HTMLButtonElement[], direction: string) =>
            buttons.length === 1 &&
            buttons[0].isConnected &&
            buttons[0].type === 'button' &&
            buttons[0].closest('[aria-roledescription="carousel"]') === root &&
            !buttons[0].closest('[aria-roledescription="slide"]') &&
            new RegExp('^' + direction + ' slide$', 'i').test(
              buttons[0].getAttribute('aria-label')?.trim() || '',
            ) &&
            [...root.querySelectorAll('button[type="button"][aria-label]')].filter(
              el =>
                el.closest('[aria-roledescription="carousel"]') === root &&
                !el.closest('[aria-roledescription="slide"]') &&
                new RegExp('^' + direction + ' slide$', 'i').test(
                  el.getAttribute('aria-label')?.trim() || '',
                ),
            ).length === 1;
          const safe = (buttons: HTMLButtonElement[], direction: string) =>
            retained(buttons, direction) &&
            !buttons[0].matches(':disabled,[aria-disabled="true"],[inert],[inert] *') &&
            visible(buttons[0]);
          return {
            connected:
              contextRetained() &&
              root.isConnected &&
              visible(root) &&
              retained(next, 'next') &&
              retained(previous, 'previous') &&
              slides.every(el => el.isConnected) &&
              currentSlides.length === slides.length &&
              currentSlides.every((el, i) => el === slides[i]),
            rootNamed: named(root),
            slideNames: slides.map(named),
            slideRoles: slides.map(el =>
              ['group', 'tabpanel'].includes(el.getAttribute('role') || ''),
            ),
            slideCount: slides.length,
            rendered,
            active: rendered.filter(Boolean).length === 1 ? rendered.indexOf(true) : -1,
            nextSafe: safe(next, 'next'),
            previousSafe: safe(previous, 'previous'),
            nextCount: next.length,
            previousCount: previous.length,
            overlayOpen: [
              ...document.querySelectorAll('dialog[open],[aria-modal="true"],[popover]'),
            ].some(
              el =>
                (el instanceof HTMLDialogElement && el.matches(':modal')) ||
                (el.getAttribute('aria-modal') === 'true' && visible(el)) ||
                (el.hasAttribute('popover') &&
                  CSS.supports('selector(:popover-open)') &&
                  el.matches(':popover-open')),
            ),
          };
        });
      try {
        const initial = await snapshot();
        if (
          !initial.rootNamed ||
          initial.slideNames.some(named => !named) ||
          initial.slideRoles.some(role => !role)
        )
          findings.push({
            rule: 'carousel-semantics',
            guide: 'carousel',
            severity: 'warning',
            selector: '[aria-roledescription="carousel"]',
            evidence: {
              rootNamed: initial.rootNamed,
              slideNames: initial.slideNames,
              slideRoles: initial.slideRoles,
            },
            recommendation:
              'Name the declared carousel and its slide groups. Verify localized position labels and assistive-technology feedback manually.',
          });
        if (
          !initial.connected ||
          initial.slideCount < 2 ||
          initial.active < 0 ||
          initial.overlayOpen ||
          initial.nextCount !== 1 ||
          initial.previousCount !== 1 ||
          (!initial.nextSafe && !initial.previousSafe)
        ) {
          observations.push({
            initial,
            status: 'not-probed',
            reason:
              'requires-single-rendered-slide-and-explicit-safe-slide-controls-without-overlays',
          });
          continue;
        }
        const forward = initial.nextSafe;
        const handle = (
          await (await bundle.getProperty(forward ? 'next' : 'previous')).getProperty('0')
        ).asElement() as ElementHandle<HTMLButtonElement>;
        const inverse = (
          await (await bundle.getProperty(forward ? 'previous' : 'next')).getProperty('0')
        ).asElement() as ElementHandle<HTMLButtonElement> | null;
        await focus.evaluate((state, el) => state.expectFocus(el), handle);
        await handle.focus();
        const beforeActivation = await snapshot();
        if (
          !beforeActivation.connected ||
          beforeActivation.active !== initial.active ||
          !(await focus.evaluate(state => state.owned())) ||
          !(forward ? beforeActivation.nextSafe : beforeActivation.previousSafe) ||
          !(await handle.evaluate(el => el === document.activeElement)) ||
          beforeActivation.overlayOpen
        )
          throw new Error('Carousel control focus unavailable');
        await page.keyboard.press('Enter');
        // A bounded delay permits authored transitions; no display is proof of neither failure nor compliance.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 700)));
        const changed = await snapshot();
        if (
          !changed.connected ||
          changed.active < 0 ||
          changed.active === initial.active ||
          !(await focus.evaluate(state => state.owned()))
        ) {
          observations.push({
            initial,
            changed,
            status: 'unverified',
            reason: 'unchanged-ambiguous-or-replaced-slide-within-700ms',
          });
          canRestore = false;
          break;
        }
        let restoration: Record<string, unknown> = {
          status: 'unverified',
          reason: 'inverse-control-unavailable',
        };
        if (
          inverse &&
          !changed.overlayOpen &&
          (forward ? changed.previousSafe : changed.nextSafe)
        ) {
          await focus.evaluate((state, el) => state.expectFocus(el), inverse);
          await inverse.focus();
          const beforeRestore = await snapshot();
          if (
            !beforeRestore.connected ||
            beforeRestore.active !== changed.active ||
            !(await focus.evaluate(state => state.owned())) ||
            !(forward ? beforeRestore.previousSafe : beforeRestore.nextSafe) ||
            !(await inverse.evaluate(el => el === document.activeElement)) ||
            beforeRestore.overlayOpen
          )
            throw new Error('Carousel inverse focus unavailable');
          await page.keyboard.press('Enter');
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 700)));
          const restored = await snapshot();
          restoration = {
            status:
              restored.connected &&
              !restored.overlayOpen &&
              restored.active === initial.active &&
              (await focus.evaluate(state => state.owned()))
                ? 'restored'
                : 'unverified',
            state: restored,
          };
        }
        observations.push({
          initial,
          changed,
          direction: forward ? 'next' : 'previous',
          status: restoration.status === 'restored' ? 'observed' : 'unverified',
          restoration,
          keyboardActivation: 'Enter',
          sampleWindowMs: 700,
        });
        if (restoration.status !== 'restored') {
          canRestore = false;
          break;
        }
      } catch {
        observations.push({
          status: 'unverified',
          reason: 'nodes-changed-or-dependent-work-blocked',
        });
        canRestore = false;
        break;
      } finally {
        await bundle.dispose();
      }
    }
  } finally {
    try {
      // Cleanup must not overwrite focus or state adopted by the page.
      if (canRestore)
        canRestore = await focus.evaluate(state => state.restore()).catch(() => false);
      if (canRestore)
        await page
          .evaluate(
            position => scrollTo({ left: position.x, top: position.y, behavior: 'instant' }),
            originalScroll,
          )
          .catch(() => {
            canRestore = false;
          });
    } finally {
      await focus.evaluate(state => state.dispose()).catch(() => {});
      await focus.dispose();
    }
  }

  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      observations,
      sampleLimit: 3,
      applicationResetVerified: false,
      stoppedAfterLoss: !canRestore,
      successfulSubmissionAttempted: false,
      autoplayVerified: false,
      gestureVerified: false,
      scrollTrackBehaviorVerified: false,
      controlContract: 'explicit-English-aria-label-next-slide-or-previous-slide-non-submit-button',
      networkDependentStatesUnverified: true,
    },
    findings,
  };
}
