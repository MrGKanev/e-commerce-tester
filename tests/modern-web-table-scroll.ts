import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';

/** Source: GoogleChrome responsive-table, Markup and Layout:
 * https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
 * Test the promised keyboard scroll behavior, not mandatory tabindex/API adoption.
 * Only explicit focusable regions owning one native table are exercised: arbitrary
 * scrollers, grids and native implicit-focus policy remain outside this contract.
 */
export async function inspectTableScroll(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Table scroll probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const initialFocus = await page.evaluateHandle(() => document.activeElement);
  const initialScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  let dependent = false,
    anyDependency = false;
  const activity = () => {
    dependent = true;
    anyDependency = true;
  };
  page.context().on('request', activity);
  page.on('websocket', activity);
  const roots = (await page
    .locator('div[role="region"][tabindex],section[role="region"][tabindex]')
    .elementHandles()) as ElementHandle<HTMLElement>[];
  let ownedFocus: ElementHandle<HTMLElement> | undefined;
  try {
    for (const root of roots.slice(0, 5)) {
      try {
        dependent = false;
        const table = await root.$('table');
        if (!table) continue;
        const state = () =>
          root.evaluate((el, table) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            const hidden = [
              ...(function* () {
                for (let p: Element | null = el; p; p = p.parentElement) yield p;
              })(),
            ].some(p => getComputedStyle(p).contentVisibility === 'hidden');
            const eligible =
              el.isConnected &&
              table.isConnected &&
              el.contains(table) &&
              el.querySelectorAll('table').length === 1 &&
              el.tabIndex >= 0 &&
              el.getAttribute('role') === 'region' &&
              !el.closest(
                '[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])',
              ) &&
              !document.querySelector(
                'dialog[open],[role="dialog"]:not([hidden]),[role="alertdialog"]:not([hidden])',
              ) &&
              !table.matches('[role="none"],[role="presentation"],[role="grid"]') &&
              ['auto', 'scroll'].includes(s.overflowX) &&
              s.visibility === 'visible' &&
              s.display !== 'none' &&
              !hidden &&
              s.writingMode === 'horizontal-tb' &&
              r.width > 0 &&
              r.height > 0 &&
              el.scrollWidth - el.clientWidth > 8;
            return {
              eligible,
              focused: document.activeElement === el,
              x: el.scrollLeft,
              y: el.scrollTop,
              width: el.clientWidth,
              range: el.scrollWidth - el.clientWidth,
              direction: s.direction,
              selector: `role=region >> nth=${[...document.querySelectorAll('[role="region"]')].indexOf(el)}`,
              animating: el
                .getAnimations({ subtree: true })
                .some(animation => animation.playState === 'running'),
            };
          }, table);
        // Observe only trusted keys on the retained region, after authored handlers.
        // If native scrolling does not respond but no cancellation is observed, browser
        // input policy remains unverified instead of inventing a store failure.
        const keyboard = await root.evaluateHandle(el => {
          const evidence = { seen: false, cancelled: false };
          const listen = (event: KeyboardEvent) => {
            if (
              event.isTrusted &&
              event.target === el &&
              ['ArrowRight', 'ArrowLeft'].includes(event.key)
            ) {
              evidence.seen = true;
              evidence.cancelled = event.defaultPrevented;
            }
          };
          window.addEventListener('keydown', listen);
          return { evidence, dispose: () => window.removeEventListener('keydown', listen) };
        });
        let before;
        let touched = false;
        try {
          before = await state();
          if (!before.eligible) continue;
          const samples: Array<Record<string, unknown>> = [];
          const failures: string[] = [];
          let nativeUnverified = false;
          touched = true;
          await root.evaluate(el => el.focus({ preventScroll: true }));
          ownedFocus = root;
          let focused = await state();
          if (!focused.eligible || !focused.focused || focused.animating || dependent) {
            observations.push({
              selector: before.selector,
              status: 'unverified',
              reason: 'focus-state-or-dependency-changed',
            });
            continue;
          }
          // Source: CSSOM View scrollLeft can be negative in RTL. Compare actual
          // movement in either direction, never assume an LTR positive coordinate.
          // https://drafts.csswg.org/cssom-view/#dom-element-scrollleft
          for (const key of ['ArrowRight', 'ArrowLeft'] as const) {
            if (!(await state()).focused) throw new Error('focus-changed');
            await root.evaluate(el =>
              el.scrollTo({ left: 0, top: el.scrollTop, behavior: 'instant' }),
            );
            // Commit focus/instant reset before asking the compositor to process a
            // keyboard scroll; otherwise WebKit can consume the first arrow at reset.
            await page.evaluate(
              () =>
                new Promise<void>(resolve =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
            );
            const start = await state();
            if (!start.eligible || !start.focused || start.animating || dependent)
              throw new Error('changed');
            // Use the global keyboard after checking the retained owner: locator.press
            // would refocus a replaced element and hide focus theft by the site.
            await keyboard.evaluate(s => {
              s.evidence.seen = false;
              s.evidence.cancelled = false;
            });
            await page.keyboard.press(key, { delay: 60 });
            const deadline = Date.now() + 350;
            let end = await state();
            while (Date.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 35));
              end = await state();
              if (!end.eligible || !end.focused || end.animating || dependent) break;
            }
            if (
              !end.eligible ||
              !end.focused ||
              end.animating ||
              dependent ||
              end.width !== start.width ||
              end.range !== start.range ||
              end.direction !== start.direction
            )
              throw new Error('changed');
            const canMove = start.direction === 'rtl' ? key === 'ArrowLeft' : key === 'ArrowRight';
            const moved = Math.abs(end.x - start.x) > 1;
            const keyEvidence = await keyboard.evaluate(s => s.evidence);
            samples.push({ key, canMove, moved, delta: end.x - start.x, ...keyEvidence });
            if (canMove && !moved) {
              if (keyEvidence.seen && keyEvidence.cancelled) failures.push('table-scroll-keyboard');
              else nativeUnverified = true;
            }
          }
          focused = await state();
          if (dependent || !focused.eligible || !focused.focused) throw new Error('changed');
          observations.push({
            selector: before.selector,
            status: nativeUnverified ? 'unverified' : 'observed',
            samples,
          });
          if (failures.length)
            findings.push({
              rule: 'table-scroll-keyboard',
              guide: 'responsive-table',
              severity: 'warning',
              selector: before.selector,
              evidence: {
                keyboardMovementObserved: false,
                authoredKeyCancellationObserved: true,
                direction: before.direction,
                observationWindowMs: 350,
              },
              recommendation:
                'Review arrow-key scrolling of this explicitly focusable overflowing table region. Keep its data reachable with a keyboard; this bounded sample does not certify all input methods or assistive technology.',
            });
        } catch {
          observations.push({
            selector: before?.selector,
            status: 'unverified',
            reason: 'region-focus-layout-or-dependency-changed',
          });
        } finally {
          if (before && touched && (await table.evaluate(el => el.isConnected).catch(() => false)))
            await root
              .evaluate((el, p) => {
                if (el.isConnected) el.scrollTo({ left: p.x, top: p.y, behavior: 'instant' });
              }, before)
              .catch(() => {});
          await keyboard.evaluate(s => s.dispose()).catch(() => {});
          await keyboard.dispose();
          await table.dispose();
        }
      } catch {
        observations.push({ status: 'unverified', reason: 'candidate-changed-before-probe' });
      }
    }
  } finally {
    // Source: accessibility, Keyboard and Focus Management. Preserve the retained
    // owner; never focus a replacement matched by an old selector during cleanup.
    // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
    if (
      ownedFocus &&
      (await ownedFocus.evaluate(el => document.activeElement === el).catch(() => false))
    )
      await initialFocus
        .evaluate(el => {
          if (el instanceof HTMLElement && el.isConnected) {
            if (el === document.body || el === document.documentElement)
              (document.activeElement as HTMLElement | null)?.blur();
            else el.focus({ preventScroll: true });
          }
        })
        .catch(() => {});
    await page
      .evaluate(p => scrollTo({ left: p.x, top: p.y, behavior: 'instant' }), initialScroll)
      .catch(() => {});
    page.context().off('request', activity);
    page.off('websocket', activity);
    await initialFocus.dispose();
  }
  return {
    observations,
    perPageLimit: 5,
    observationWindowMs: 350,
    sequentialEntryVerified: false,
    findings: anyDependency ? [] : findings,
    networkDependent: anyDependency,
  };
}
