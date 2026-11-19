import type { ElementHandle, Page } from '@playwright/test';
import type { WebFinding } from './modern-web';
import { menuFor, menuState } from './modern-web-menu-navigation';

type Handle = ElementHandle<HTMLElement>;
type Pair = { trigger: Handle; menu: Handle };
const TRIGGERS =
  'button[role="menuitem"][aria-haspopup="menu"],button[role="menuitem"][aria-haspopup="true"]';

/** Two adjacent top-level menus only. No activation, destinations or pointer clicks. */
export async function inspectMenubarSwitching(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Menubar switching probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const hoverSupported = await page.evaluate(
    () => matchMedia('(hover: hover) and (pointer: fine)').matches,
  );
  const roots = (await page
    .locator('[role="menubar"]')
    .filter({ visible: true })
    .elementHandles()) as Handle[];
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  for (const root of roots.slice(0, 5)) {
    const pairs: Pair[] = [];
    const pending: WebFinding[] = [];
    let requests = 0,
      started = false;
    const onRequest = () => requests++;
    const snapshot = () => Promise.all(pairs.map(pair => menuState(pair.trigger, pair.menu)));
    let selector = 'menubar';
    const warn = (rule: string, evidence: Record<string, unknown>, recommendation: string) =>
      pending.push({
        rule,
        guide: 'app-menus',
        severity: 'warning',
        selector,
        evidence,
        recommendation,
      });
    try {
      const rootInfo = await root.evaluate(el => ({
        selector: el.id ? '#' + CSS.escape(el.id) : 'menubar',
        supported:
          el.getAttribute('aria-orientation') !== 'vertical' &&
          !el.hasAttribute('aria-activedescendant'),
        rtl: getComputedStyle(el).direction === 'rtl',
        rendered:
          !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
          (() => {
            for (let node: Element | null = el; node; node = node.parentElement) {
              const s = getComputedStyle(node);
              if (
                s.display === 'none' ||
                s.visibility !== 'visible' ||
                s.contentVisibility === 'hidden'
              )
                return false;
            }
            return true;
          })(),
      }));
      selector = rootInfo.selector;
      if (!rootInfo.supported || !rootInfo.rendered) {
        observations.push({
          selector,
          status: 'not-probed',
          reason: 'vertical-root-focus-or-hidden-scope',
        });
        continue;
      }
      const triggers = (await root.$$(TRIGGERS)) as Handle[];
      const own: Handle[] = [];
      for (const trigger of triggers)
        if (
          await trigger.evaluate(
            (el, bar) =>
              el.closest('[role="menubar"]') === bar &&
              !el.closest('[role="menu"],[focusgroup~="menu"]'),
            root,
          )
        )
          own.push(trigger);
      if (own.length < 2 || own.length > 20) {
        observations.push({
          selector,
          status: 'not-probed',
          reason: 'requires-two-to-twenty-top-level-native-triggers',
          triggerSampleTruncated: own.length > 20,
        });
        continue;
      }
      let identifiable = true;
      for (const trigger of own) {
        const menu = await menuFor(trigger);
        if (!menu) {
          identifiable = false;
          break;
        }
        pairs.push({ trigger, menu });
      }
      if (
        !identifiable ||
        !(await root.evaluate(
          (_, menus) => new Set(menus).size === menus.length,
          pairs.map(pair => pair.menu),
        ))
      ) {
        observations.push({
          selector,
          status: 'not-probed',
          reason: 'ambiguous-or-unidentified-menu-targets',
        });
        continue;
      }
      const initial = await snapshot();
      if (
        initial.some(
          state =>
            !state.connected ||
            !state.safe ||
            !state.associationStable ||
            state.modalOutside ||
            state.visible ||
            state.transitioning,
        )
      ) {
        observations.push({
          selector,
          status: 'not-probed',
          reason: initial.some(state => state.visible)
            ? 'initially-open-menu'
            : 'unsafe-ambiguous-modal-or-transitioning-scope',
          initial,
        });
        continue;
      }
      const stable = async () => {
        const valid = await root.evaluate(
          (bar, args) => {
            const current = [...bar.querySelectorAll(args.query)].filter(
              el =>
                el.closest('[role="menubar"]') === bar &&
                !el.closest('[role="menu"],[focusgroup~="menu"]'),
            );
            return (
              bar.isConnected &&
              bar.getAttribute('role') === 'menubar' &&
              bar.getAttribute('aria-orientation') !== 'vertical' &&
              !bar.hasAttribute('aria-activedescendant') &&
              getComputedStyle(bar).direction === (args.rtl ? 'rtl' : 'ltr') &&
              current.length === args.controls.length &&
              args.controls.every((control, i) => control === current[i])
            );
          },
          { query: TRIGGERS, controls: own, rtl: rootInfo.rtl },
        );
        const states = await snapshot();
        if (
          !valid ||
          states.some(
            state =>
              !state.connected || !state.safe || !state.associationStable || state.modalOutside,
          )
        )
          throw new Error('retained-menubar-changed');
        return states;
      };
      const observe = async (
        predicate: (states: Awaited<ReturnType<typeof snapshot>>) => boolean,
      ) => {
        let states = await stable();
        for (let attempt = 0; attempt < 7 && !predicate(states); attempt++) {
          // eslint-disable-next-line playwright/no-wait-for-timeout -- Bounded observation of local preview handlers; no store latency threshold.
          await page.waitForTimeout(100);
          states = await stable();
        }
        return {
          states,
          matched: predicate(states),
          transitioning: states.some(state => state.transitioning),
        };
      };
      const restoreFocus = async () =>
        originalFocus.evaluate(node => {
          if (node instanceof HTMLElement && node.isConnected) node.focus();
        });
      const cleanup = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const states = await stable();
          if (states.every(state => !state.visible)) return true;
          const owned = await root.evaluate(
            (bar, menus) => {
              const active = document.activeElement;
              return Boolean(
                active && (bar.contains(active) || menus.some(menu => menu.contains(active))),
              );
            },
            pairs.map(pair => pair.menu),
          );
          if (!owned) return false;
          await page.keyboard.press('Escape');
          const closed = await observe(current => current.every(state => !state.visible));
          if (closed.matched) return true;
          if (closed.transitioning) return false;
        }
        return false;
      };
      const enterFirst = async () => {
        await stable();
        await pairs[0].trigger.focus();
        const before = await stable();
        if (!before[0].triggerFocused) throw new Error('trigger-focus-stolen');
        started = true;
        await page.keyboard.press('ArrowDown');
        return observe(states => states[0].visible && states[0].focusInside);
      };
      const expected = (index: number) => (states: Awaited<ReturnType<typeof snapshot>>) =>
        states.every((state, i) => state.visible === (i === index)) && states[index].triggerFocused;
      const expanded = (phase: string, states: Awaited<ReturnType<typeof snapshot>>) => {
        const mismatches = states.filter(
          state => state.expanded !== null && state.expanded !== String(state.visible),
        ).length;
        if (mismatches)
          warn(
            'menubar-switch-expanded-state',
            { phase, mismatches },
            'Keep authored aria-expanded synchronized with each menu while keyboard or pointer switching; implicit native state needs no redundant attribute.',
          );
      };
      page.on('request', onRequest);
      const keyboardEntry = await enterFirst();
      let keyboard: Record<string, unknown> = {
        status: 'unverified',
        reason: 'keyboard-opening-unavailable',
        entry: keyboardEntry,
      };
      if (keyboardEntry.matched && !keyboardEntry.transitioning) {
        const leafFocus = await pairs[0].menu.evaluate(menu => {
          const active = document.activeElement;
          const effective =
            active === menu
              ? document.getElementById(menu.getAttribute('aria-activedescendant') || '')
              : active;
          return Boolean(
            effective &&
            effective.closest('[role="menu"],[focusgroup~="menu"]') === menu &&
            !effective.matches('[aria-haspopup="menu"],[aria-haspopup="true"]'),
          );
        });
        if (leafFocus) {
          await stable();
          await page.keyboard.press(rootInfo.rtl ? 'ArrowLeft' : 'ArrowRight');
          const switched = await observe(expected(1));
          keyboard = {
            entry: keyboardEntry,
            switched,
            status: switched.transitioning ? 'unverified' : 'observed',
          };
          if (!switched.transitioning) {
            if (!switched.matched)
              warn(
                'menubar-keyboard-switch',
                { switched },
                'From a top-level menu item without a child submenu, move the inline-end arrow to the adjacent top-level trigger and preview only its menu.',
              );
            expanded('keyboard', switched.states);
          }
        } else
          keyboard = {
            status: 'not-probed',
            reason: 'entry-item-owns-submenu-or-unrecognized-focus-model',
            entry: keyboardEntry,
          };
      }
      let pointer: Record<string, unknown> = {
        status: 'not-probed',
        reason: 'no-fine-hover-pointer',
      };
      let restoration = await cleanup();
      if (restoration) await restoreFocus();
      if (hoverSupported && restoration && (await stable()).every(state => !state.visible)) {
        await stable();
        // Cold hover first: do not require opening on pointer movement alone.
        started = true;
        const coldOwner = await page.evaluateHandle(() => document.activeElement);
        const alreadyHovered = await pairs[1].trigger.evaluate(el => el.matches(':hover'));
        let sameFocus = false;
        let cold;
        try {
          await pairs[1].trigger.hover({ timeout: 1500 });
          // eslint-disable-next-line playwright/no-wait-for-timeout -- Observe cold hover before opening a menu for the hot-hover sample.
          await page.waitForTimeout(200);
          const observed = await observe(states => states.every(state => !state.visible));
          sameFocus = await coldOwner.evaluate(node => node === document.activeElement);
          cold = { ...observed, sameFocus, alreadyHovered };
        } finally {
          await coldOwner.dispose();
        }
        if (cold.transitioning)
          pointer = { status: 'unverified', reason: 'cold-hover-transition-running', cold };
        else {
          if (!alreadyHovered && (!cold.matched || !sameFocus))
            warn(
              'menubar-hover-closed',
              { cold },
              'With no menu open, hovering a top-level menubar trigger should not open or focus a menu.',
            );
          restoration = await cleanup();
          if (restoration) {
            await restoreFocus();
            const entry = await enterFirst();
            if (entry.matched && !entry.transitioning) {
              await stable();
              await pairs[0].trigger.hover({ timeout: 1500 });
              const source = await observe(
                states => states[0].visible && states.slice(1).every(state => !state.visible),
              );
              if (!source.matched || source.transitioning)
                pointer = {
                  status: 'unverified',
                  reason: 'pointer-source-state-unavailable',
                  cold,
                  entry,
                  source,
                };
              else {
                await pairs[1].trigger.hover({ timeout: 1500 });
                const forward = await observe(expected(1));
                if (!forward.transitioning) {
                  if (!forward.matched)
                    warn(
                      'menubar-hover-switch',
                      { direction: 'forward', forward },
                      "Hovering an adjacent top-level trigger while a menu is open should preview that trigger's menu, close the previous one and keep focus on the trigger.",
                    );
                  expanded('pointer-forward', forward.states);
                }
                await stable();
                await pairs[0].trigger.hover({ timeout: 1500 });
                const backward = await observe(expected(0));
                if (!backward.transitioning) {
                  if (!backward.matched)
                    warn(
                      'menubar-hover-switch',
                      { direction: 'backward', backward },
                      'Support the reverse hover switch without leaving both menus open or moving focus into menu commands.',
                    );
                  expanded('pointer-backward', backward.states);
                }
                pointer = {
                  cold,
                  entry,
                  source,
                  forward,
                  backward,
                  status:
                    alreadyHovered || forward.transitioning || backward.transitioning
                      ? 'unverified'
                      : 'observed',
                };
              }
            } else
              pointer = {
                status: 'unverified',
                reason: 'pointer-opening-unavailable',
                cold,
                entry,
              };
          } else
            pointer = { status: 'unverified', reason: 'cold-hover-restoration-unavailable', cold };
        }
      } else if (hoverSupported)
        pointer = {
          status: 'unverified',
          reason: restoration
            ? 'closed-pointer-start-unavailable'
            : 'keyboard-restoration-unavailable',
        };
      restoration = await cleanup();
      if (restoration) await restoreFocus();
      const final = await stable();
      restoration = restoration && final.every(state => !state.visible && !state.transitioning);
      observations.push({
        selector,
        keyboard,
        pointer,
        restoration: { closed: restoration },
        requests,
        status:
          requests ||
          !restoration ||
          keyboard.status === 'unverified' ||
          pointer.status === 'unverified'
            ? 'unverified'
            : 'observed',
        reason: requests ? 'dependent-work-blocked' : null,
      });
      if (!requests) findings.push(...pending);
    } catch {
      observations.push({
        selector,
        status: 'unverified',
        reason: 'retained-menu-pointer-focus-or-dependent-state-changed',
        requests,
      });
    } finally {
      // Escape only while focus belongs to a still-associated retained menu system.
      if (started && pairs.length) {
        try {
          const states = await snapshot();
          const owned = await root.evaluate(
            (bar, menus) => {
              const active = document.activeElement;
              return Boolean(
                active && (bar.contains(active) || menus.some(menu => menu.contains(active))),
              );
            },
            pairs.map(pair => pair.menu),
          );
          if (
            owned &&
            states.every(
              state =>
                state.connected && state.safe && state.associationStable && !state.modalOutside,
            ) &&
            states.some(state => state.visible)
          )
            await page.keyboard.press('Escape');
        } catch {
          /* Replacement widgets and unrelated overlays are left alone. */
        }
      }
      page.off('request', onRequest);
      for (const pair of pairs) await pair.menu.dispose();
    }
  }
  try {
    await originalFocus.evaluate(node => {
      if (node instanceof HTMLElement && node.isConnected) node.focus();
    });
  } catch {
    /* The original owner may no longer exist. */
  }
  await originalFocus.dispose();
  return {
    observations,
    findings,
    candidateCount: roots.length,
    sampleTruncated: roots.length > 5,
    limit: 5,
    triggerLimit: 20,
    pairSampleSize: 2,
    hoverSupported,
    observationWindowMs: 700,
    commandActivationAttempted: false,
    pointerClicksAttempted: false,
  };
}
