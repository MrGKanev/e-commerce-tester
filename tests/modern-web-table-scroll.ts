import type { Page, ElementHandle, JSHandle } from '@playwright/test';
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
  const initialFocusContext = await initialFocus.evaluateHandle(el => ({
    parent: el?.parentNode,
    root: el?.getRootNode(),
  }));
  const owners: JSHandle[] = [];
  let ownedState: (() => Promise<{ eligible: boolean; focused: boolean }>) | undefined;
  let focusRestoration = 'not-needed';
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
  let restoreFocusAllowed = false;
  let stopSampling = false;
  try {
    for (const root of roots.slice(0, 5)) {
      if (stopSampling) break;
      try {
        dependent = false;
        const table = await root.$('table');
        if (!table) continue;
        // Retain context privately: the same live node can be repurposed by a
        // focus/key handler. These are local probe ownership guards, not store
        // authoring rules. See responsive-table and accessibility sources above.
        const owner = await root.evaluateHandle(
          (el, table) => ({
            table,
            parent: el.parentNode,
            tableParent: table.parentNode,
            role: el.getAttribute('role'),
            tabindex: el.getAttribute('tabindex'),
            label: el.getAttribute('aria-label'),
            labelledby: el.getAttribute('aria-labelledby'),
            dir: el.getAttribute('dir'),
            tableRole: table.getAttribute('role'),
          }),
          table,
        );
        owners.push(owner);
        const state = () =>
          root.evaluate((el, owner) => {
            const table = owner.table;
            const owned =
              el.getRootNode() === document &&
              el.parentNode === owner.parent &&
              table.parentNode === owner.tableParent &&
              el.getAttribute('role') === owner.role &&
              el.getAttribute('tabindex') === owner.tabindex &&
              el.getAttribute('aria-label') === owner.label &&
              el.getAttribute('aria-labelledby') === owner.labelledby &&
              el.getAttribute('dir') === owner.dir &&
              table.getAttribute('role') === owner.tableRole;
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            const hidden = [
              ...(function* () {
                for (let p: Element | null = el; p; p = p.parentElement) yield p;
              })(),
            ].some(p => getComputedStyle(p).contentVisibility === 'hidden');
            const eligible =
              owned &&
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
              owned,
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
          }, owner);
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
        let last: Awaited<ReturnType<typeof state>> | undefined;
        const readState = async () => {
          last = await state();
          return last;
        };
        let observation: Record<string, unknown> | undefined;
        const candidateFindings: WebFinding[] = [];
        let touched = false;
        try {
          before = await readState();
          if (!before.eligible) continue;
          observation = { selector: before.selector, status: 'unverified' };
          observations.push(observation);
          const samples: Array<Record<string, unknown>> = [];
          const failures: string[] = [];
          let nativeUnverified = false;
          touched = true;
          restoreFocusAllowed = false;
          focusRestoration = 'not-restored';
          ownedState = state;
          await root.evaluate(el => el.focus({ preventScroll: true }));
          ownedFocus = root;
          let focused = await readState();
          if (!focused.eligible || !focused.focused || focused.animating || dependent) {
            Object.assign(observation, { reason: 'focus-state-or-dependency-changed' });
            continue;
          }
          // Source: CSSOM View scrollLeft can be negative in RTL. Compare actual
          // movement in either direction, never assume an LTR positive coordinate.
          // https://drafts.csswg.org/cssom-view/#dom-element-scrollleft
          for (const key of ['ArrowRight', 'ArrowLeft'] as const) {
            const ready = await readState();
            if (
              !ready.eligible ||
              !ready.focused ||
              ready.animating ||
              dependent ||
              ready.width !== before.width ||
              ready.range !== before.range ||
              ready.direction !== before.direction
            )
              throw new Error('changed');
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
            const start = await readState();
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
            let end = await readState();
            while (Date.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 35));
              end = await readState();
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
          focused = await readState();
          if (dependent || !focused.eligible || !focused.focused) throw new Error('changed');
          Object.assign(observation, {
            status: nativeUnverified ? 'unverified' : 'observed',
            samples,
          });
          if (failures.length)
            candidateFindings.push({
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
          if (!observation) {
            observation = { selector: before?.selector };
            observations.push(observation);
          }
          Object.assign(observation, {
            status: 'unverified',
            reason: 'region-focus-layout-or-dependency-changed',
          });
        } finally {
          // Compare the last observed offsets and retained ownership before
          // cleanup; never overwrite scroll after a reparent, semantic change,
          // focus theft, layout change or dependency. DOM restoration is not
          // application-state reset, sequential-entry or AT certification.
          let restored = false;
          if (before && touched && last) {
            const current = await state().catch(() => null);
            if (
              current?.eligible &&
              current.focused &&
              !current.animating &&
              !dependent &&
              current.x === last.x &&
              current.y === last.y &&
              current.width === before.width &&
              current.range === before.range &&
              current.direction === before.direction
            ) {
              await root
                .evaluate(
                  (el, p) => el.scrollTo({ left: p.x, top: p.y, behavior: 'instant' }),
                  before,
                )
                .catch(() => {});
              // CSSOM View dispatches pending native scroll events during the
              // rendering update, not synchronously inside scrollTo:
              // https://drafts.csswg.org/cssom-view/#scrolling-events
              // Cross two rendering turns so that event handlers, their
              // microtasks and a directly queued animation-frame change can run
              // before we claim restoration or return focus. This bounded local
              // safety policy is not an application-idle/reset guarantee.
              await page.evaluate(
                () =>
                  new Promise<void>(resolve =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                  ),
              );
              const after = await state().catch(() => null);
              restored = Boolean(
                after?.eligible &&
                after.focused &&
                !dependent &&
                !after.animating &&
                after.width === before.width &&
                after.range === before.range &&
                after.direction === before.direction &&
                Math.abs(after.x - before.x) <= 1 &&
                Math.abs(after.y - before.y) <= 1,
              );
            }
          }
          if (observation)
            observation.scrollRestoration = {
              status: restored ? 'restored' : touched ? 'not-restored' : 'not-needed',
              applicationResetVerified: false,
            };
          if (restored) {
            findings.push(...candidateFindings);
            restoreFocusAllowed = true;
          } else if (observation && touched) {
            // Do not focus a later region after losing this context.
            stopSampling = true;
            observation.status = 'unverified';
          }
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
      restoreFocusAllowed &&
      ownedState &&
      (await ownedState()
        .then(s => s.eligible && s.focused)
        .catch(() => false)) &&
      ownedFocus &&
      (await ownedFocus.evaluate(el => document.activeElement === el).catch(() => false))
    )
      focusRestoration = await initialFocus
        .evaluate(
          (el, { context, focus }) => {
            if (
              !(el instanceof HTMLElement) ||
              !el.isConnected ||
              el.parentNode !== context.parent ||
              el.getRootNode() !== context.root ||
              document.activeElement !== focus ||
              el.closest('[hidden],[inert],[aria-hidden="true"]') ||
              el.matches(':disabled')
            )
              return 'not-restored';
            if (el === document.body || el === document.documentElement)
              (document.activeElement as HTMLElement | null)?.blur();
            else el.focus({ preventScroll: true });
            return document.activeElement === el ? 'restored' : 'not-restored';
          },
          { context: initialFocusContext, focus: ownedFocus },
        )
        .catch(() => 'not-restored');
    // Focus uses preventScroll; this probe owns region offsets only. Preserve
    // document scrolling performed by authored handlers instead of resetting it.
    page.context().off('request', activity);
    page.off('websocket', activity);
    await Promise.all(owners.map(owner => owner.dispose()));
    await initialFocusContext.dispose();
    await initialFocus.dispose();
  }
  return {
    observations,
    perPageLimit: 5,
    observationWindowMs: 350,
    sequentialEntryVerified: false,
    retainedContextRequired: true,
    focusRestoration: { status: focusRestoration, applicationResetVerified: false },
    applicationResetVerified: false,
    findings: anyDependency ? [] : findings,
    networkDependent: anyDependency,
  };
}
