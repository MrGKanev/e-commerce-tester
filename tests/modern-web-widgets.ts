// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// tabs: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/tabs.md
// switch: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/switch.md
// slider: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/slider.md
// Exercise declared retained owners and safe reversible actions, not commands.
// Equivalent native/scripted behavior is accepted; absent modern APIs are not defects.
import { inspectMenubarSwitching } from './modern-web-menubar-switching';
import { inspectMenuNavigation } from './modern-web-menu-navigation';
import { inspectComposites } from './modern-web-composites';
import { inspectCustomAccordions } from './modern-web-accordions';
import { inspectTableScroll } from './modern-web-table-scroll';
import { inspectSwitches } from './modern-web-switches';
import { inspectDetails } from './modern-web-details';
import {
  canContinueWidgetProbe,
  type WidgetProbeContinuation,
} from './modern-web-probe-continuation';
import type { Page, ElementHandle } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

const LIMIT = 5;

/** Bounded keyboard samples on declared widgets; run only on a fresh quarantined page. */
export async function inspectWidgets(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Widget probes require prepareInteractionProbe(...).freeze() first');
  let dependencyObserved = false;
  const observeDependency = () => {
    dependencyObserved = true;
  };
  page.context().on('request', observeDependency);
  page.on('websocket', observeDependency);
  try {
    const render = () =>
      page.evaluate(
        () =>
          new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    const findings: WebFinding[] = [];
    const tabs: Array<Record<string, unknown>> = [];
    const sliders: Array<Record<string, unknown>> = [];
    const add = (
      rule: string,
      guide: string,
      selector: string,
      evidence: Record<string, unknown>,
      recommendation: string,
    ) => findings.push({ rule, guide, selector, evidence, recommendation, severity: 'warning' });

    const stages = [
      'tabs',
      'details',
      'switches',
      'sliders',
      'menuNavigation',
      'menubarSwitching',
      'composites',
      'tableScroll',
      'customAccordions',
    ] as const;
    type Stage = (typeof stages)[number];
    let stoppedAfter: Stage | null = null;
    const stopAfter = (stage: Stage, probe: WidgetProbeContinuation) => {
      if (
        canContinueWidgetProbe({
          ...probe,
          networkDependent: dependencyObserved || probe.networkDependent,
        })
      )
        return false;
      stoppedAfter = stage;
      return true;
    };
    // These are assigned once as each stage runs, after finish() captures them.
    /* eslint-disable prefer-const */
    let detailsProbe: Awaited<ReturnType<typeof inspectDetails>> | undefined;
    let switchProbe: Awaited<ReturnType<typeof inspectSwitches>> | undefined;
    let menuNavigation: Awaited<ReturnType<typeof inspectMenuNavigation>> | undefined;
    let switching: Awaited<ReturnType<typeof inspectMenubarSwitching>> | undefined;
    let composites: Awaited<ReturnType<typeof inspectComposites>> | undefined;
    let customAccordions: Awaited<ReturnType<typeof inspectCustomAccordions>> | undefined;
    let tableScroll: Awaited<ReturnType<typeof inspectTableScroll>> | undefined;
    /* eslint-enable prefer-const */
    // Empty skipped-stage arrays mean no samples were collected, not widget absence.
    // Candidate/support facts are null until the stage runs. Stopping is local audit
    // safety policy, not a storefront failure or a whole-application reset guarantee.
    // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
    const finish = () => {
      const skipped = { status: 'not-probed', reason: 'earlier-probe-context-unverified' };
      const coverageOnly = <T extends { findings: WebFinding[] }>({
        findings: _ignored,
        ...coverage
      }: T) => coverage;
      const { observations: accordions, ...detailsOwnership } = coverageOnly(
        detailsProbe || {
          ...skipped,
          findings: [],
          observations: [] as Array<Record<string, unknown>>,
          continuationSafe: false,
          perPageLimit: 5,
          keyLimit: 2,
          groupMemberLimit: 32,
          documentDetailsLimit: 64,
          ancestorOwnershipLimit: 24,
          attributesPerNodeLimit: 128,
          attributeCodeUnitsPerNodeLimit: 16384,
          renderingOpportunityCount: 2,
          applicationResetVerified: false,
          networkDependent: false,
        },
      );
      const { observations: switches, ...switchOwnership } = coverageOnly(
        switchProbe || {
          ...skipped,
          findings: [],
          observations: [] as Array<Record<string, unknown>>,
          perPageLimit: 5,
          keyLimit: 2,
          ancestorOwnershipLimit: 24,
          attributesPerNodeLimit: 128,
          attributeCodeUnitsPerNodeLimit: 16384,
          renderingOpportunityCount: 2,
          retainedContextRequired: true,
          applicationResetVerified: false,
          networkDependent: false,
        },
      );
      const menuCoverage = coverageOnly(
        menuNavigation || {
          ...skipped,
          observations: [] as Array<Record<string, unknown>>,
          findings: [],
          candidateCount: null,
          sampleTruncated: null,
          limit: 5,
          itemLimit: 20,
          submenuDepth: 1,
          localSettleWindowMs: 200,
          commandActivationAttempted: false,
        },
      );
      const switchingCoverage = coverageOnly(
        switching || {
          ...skipped,
          observations: [] as Array<Record<string, unknown>>,
          findings: [],
          candidateCount: null,
          sampleTruncated: null,
          limit: 5,
          triggerLimit: 20,
          pairSampleSize: 2,
          hoverSupported: null,
          observationWindowMs: 700,
          commandActivationAttempted: false,
          pointerClicksAttempted: false,
        },
      );
      const compositeCoverage = coverageOnly(
        composites || {
          ...skipped,
          menubars: [] as Array<Record<string, unknown>>,
          toolbars: [] as Array<Record<string, unknown>>,
          findings: [],
          candidateCount: null,
          sampleTruncated: null,
          perCategoryLimit: 5,
          keyboardItemLimit: 20,
          localSettleWindowMs: 100,
          commandActivationAttempted: false,
        },
      );
      const accordionCoverage = coverageOnly(
        customAccordions || {
          ...skipped,
          observations: [] as Array<Record<string, unknown>>,
          findings: [],
          activationAttempts: 0,
          candidateCount: null,
          sampleTruncated: null,
          limit: 5,
          localSettleWindowMs: 150,
          siblingRestorationVerified: false,
          nativeCommandRequired: false,
        },
      );
      const tableCoverage = coverageOnly(
        tableScroll || {
          ...skipped,
          observations: [] as Array<Record<string, unknown>>,
          findings: [],
          perPageLimit: 5,
          observationWindowMs: 350,
          sequentialEntryVerified: false,
          retainedContextRequired: true,
          focusRestoration: { status: 'not-needed', applicationResetVerified: false },
          applicationResetVerified: false,
          networkDependent: false,
        },
      );
      return {
        schemaVersion: 1,
        url: safeAuditUrl(page.url()),
        findings,
        coverage: {
          widgetDependenciesObserved: dependencyObserved,
          tabs,
          accordions,
          detailsOwnership,
          switches,
          switchOwnership,
          sliders,
          perCategoryLimit: LIMIT,
          tabKeyboardLimit: 20,
          composites: compositeCoverage,
          menuNavigation: menuCoverage,
          menubarSwitching: switchingCoverage,
          customAccordions: accordionCoverage,
          tableScroll: tableCoverage,
          tabLocalSettleWindowMs: 100,
          successfulSubmissionAttempted: false,
          customAccordionActionsAttempted: (customAccordions?.activationAttempts || 0) > 0,
          continuation: {
            status: stoppedAfter ? 'stopped' : 'completed',
            stoppedAfter,
            skippedStages: stoppedAfter ? stages.slice(stages.indexOf(stoppedAfter) + 1) : [],
            applicationResetVerified: false,
          },
        },
      };
    };

    const lists = (await page
      .locator('[role="tablist"], [focusgroup~="tablist"]')
      .filter({ visible: true })
      .elementHandles()) as ElementHandle<HTMLElement>[];
    for (const list of lists.slice(0, LIMIT)) {
      try {
        const snapshot = () =>
          list.evaluate(root => {
            const visible = (el: Element) => {
              const s = getComputedStyle(el),
                r = el.getBoundingClientRect();
              return (
                !el.closest('[hidden],[inert]') &&
                s.display !== 'none' &&
                s.visibility === 'visible' &&
                s.contentVisibility !== 'hidden' &&
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
            const items = [
              ...root.querySelectorAll<HTMLElement>(
                '[role="tab"], :scope[focusgroup~="tablist"] > button',
              ),
            ].filter(
              el =>
                el.closest('[role="tablist"], [focusgroup~="tablist"]') === root &&
                visible(el) &&
                !el.matches(':disabled,[aria-disabled="true"]'),
            );
            const panels = items.map(
              el =>
                [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(
                  panel =>
                    (panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(el.id) &&
                    Boolean(el.id),
                ) || document.getElementById(el.getAttribute('aria-controls') || ''),
            );
            return {
              selector: root.id ? '#' + CSS.escape(root.id) : 'tablist',
              named: named(root),
              selected: items.map(el => el.getAttribute('aria-selected') === 'true'),
              tabNamed: items.map(el => named(el) || Boolean(el.textContent?.trim())),
              panelNamed: panels.map(panel => Boolean(panel && named(panel))),
              panelRole: panels.map(panel => panel?.getAttribute('role') === 'tabpanel'),
              tabStops: items.map(el => el.tabIndex >= 0),
              rootFocusModel:
                root instanceof HTMLElement &&
                root.tabIndex >= 0 &&
                items.some(
                  el => Boolean(el.id) && root.getAttribute('aria-activedescendant') === el.id,
                ),
              rootFocused: root === document.activeElement,
              active: items.findIndex(
                el =>
                  el === document.activeElement ||
                  Boolean(
                    root === document.activeElement &&
                    el.id &&
                    root.getAttribute('aria-activedescendant') === el.id,
                  ),
              ),
              panelPresent: panels.map(Boolean),
              panelVisible: panels.map(panel => Boolean(panel && visible(panel))),
              nativeFocusgroup:
                root.hasAttribute('focusgroup') && 'focusGroup' in HTMLElement.prototype,
              count: items.length,
              connected: root.isConnected,
            };
          });
        const initial = await snapshot();
        if (
          !initial.named ||
          initial.selected.filter(Boolean).length !== 1 ||
          initial.panelPresent.some(value => !value) ||
          initial.tabNamed.some(value => !value) ||
          initial.panelNamed.some(value => !value) ||
          initial.panelRole.some(value => !value) ||
          initial.selected.some((selected, index) => selected !== initial.panelVisible[index]) ||
          (!initial.nativeFocusgroup &&
            !initial.rootFocusModel &&
            (initial.tabStops.filter(Boolean).length !== 1 ||
              initial.selected.some((selected, index) => selected && !initial.tabStops[index])))
        )
          add(
            'widget-tabs-semantics',
            'tabs',
            initial.selector,
            { initial },
            'Name the tablist, expose exactly one selected tab and matching visible named panel, and provide one keyboard entry stop.',
          );
        const collection = await list.evaluateHandle(root => {
          const visible = (el: Element) => {
            const style = getComputedStyle(el),
              rect = el.getBoundingClientRect();
            return (
              !el.closest('[hidden],[inert]') &&
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              style.contentVisibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          return [
            ...root.querySelectorAll<HTMLElement>(
              '[role="tab"], :scope[focusgroup~="tablist"] > button',
            ),
          ].filter(
            el =>
              el.closest('[role="tablist"], [focusgroup~="tablist"]') === root &&
              visible(el) &&
              !el.matches(':disabled,[aria-disabled="true"]'),
          );
        });
        const eligible: ElementHandle<HTMLElement>[] = [];
        const properties = await collection.getProperties();
        for (const [key, handle] of properties) {
          if (/^\d+$/.test(key) && handle.asElement())
            eligible.push(handle.asElement()! as ElementHandle<HTMLElement>);
        }
        const safeButtons = await Promise.all(
          eligible.map(el =>
            el.evaluate(node => node instanceof HTMLButtonElement && node.type === 'button'),
          ),
        );
        const selectedIndex = initial.selected.findIndex(Boolean);
        const selected = eligible[selectedIndex];
        if (
          !selected ||
          initial.count < 2 ||
          eligible.length !== initial.count ||
          safeButtons.some(safe => !safe) ||
          (initial.rootFocusModel &&
            (await list.evaluate(el => el.matches('a[href],button,input,select,textarea'))))
        ) {
          tabs.push({
            initial,
            status: 'not-probed',
            reason: 'requires-non-submit-button-tabs-with-multiple-enabled-items',
          });
          continue;
        }
        if (initial.count > 20 || initial.selected.filter(Boolean).length !== 1) {
          tabs.push({ initial, status: 'not-probed', reason: 'ambiguous-selection-or-tab-limit' });
          continue;
        }
        const originalPanels = await collection.evaluateHandle(items =>
          items.map(
            el =>
              [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(
                panel =>
                  Boolean(el.id) &&
                  (panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(el.id),
              ) || document.getElementById(el.getAttribute('aria-controls') || ''),
          ),
        );
        // Track authored focus leaving this tab set, including theft followed by
        // an immediate return. This lease is private and never exports node IDs.
        // https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis
        const focusLease = await collection.evaluateHandle((items, root) => {
          let armed = false,
            lost = false;
          const onFocus = (event: FocusEvent) => {
            if (armed && event.target !== root && !items.includes(event.target as HTMLElement))
              lost = true;
          };
          document.addEventListener('focusin', onFocus, true);
          return {
            arm: () => {
              armed = true;
            },
            valid: () => !lost,
            dispose: () => document.removeEventListener('focusin', onFocus, true),
          };
        }, list);
        const assertStable = async () => {
          if (dependencyObserved || !(await focusLease.evaluate(lease => lease.valid())))
            throw new Error('Focus left tab owner');
          const sameItems = await collection.evaluate((items, root) => {
            const current = [
              ...root.querySelectorAll<HTMLElement>(
                '[role="tab"], :scope[focusgroup~="tablist"] > button',
              ),
            ].filter(el => {
              const style = getComputedStyle(el),
                rect = el.getBoundingClientRect();
              return (
                el.closest('[role="tablist"], [focusgroup~="tablist"]') === root &&
                !el.closest('[hidden],[inert]') &&
                style.display !== 'none' &&
                style.visibility === 'visible' &&
                style.contentVisibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0 &&
                !el.matches(':disabled,[aria-disabled="true"]')
              );
            });
            return (
              root.isConnected &&
              items.length === current.length &&
              items.every((el, index) => el === current[index])
            );
          }, list);
          const samePanels = await originalPanels.evaluate(
            (panels, items) =>
              panels.every(
                (panel, index) =>
                  panel ===
                    ([...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(
                      candidate =>
                        Boolean(items[index].id) &&
                        (candidate.getAttribute('aria-labelledby') || '')
                          .split(/\s+/)
                          .includes(items[index].id),
                    ) ||
                      document.getElementById(items[index].getAttribute('aria-controls') || '')) &&
                  (!panel || panel.isConnected),
              ),
            collection,
          );
          const safeItems = await collection.evaluate(items =>
            items.every(el => el instanceof HTMLButtonElement && el.type === 'button'),
          );
          const safeRoot =
            !initial.rootFocusModel ||
            (await list.evaluate(el => !el.matches('a[href],button,input,select,textarea')));
          if (!sameItems || !samePanels || !safeItems || !safeRoot)
            throw new Error('Original tab or panel nodes changed');
        };
        const observed = async () => {
          await assertStable();
          return snapshot();
        };
        const rootModel = initial.rootFocusModel;
        // Enter is delivered to the root only for its declared active-descendant model.
        // Child activation remains restricted to the original non-submit button tabs.
        const receiver = (index: number) => (rootModel ? list : eligible[index]);
        let networkAttempted = false;
        const onRequest = () => {
          networkAttempted = true;
        };
        page.on('request', onRequest);
        const pressKey = async (index: number, key: string) => {
          await assertStable();
          const control = receiver(index);
          await assertStable();
          if (!(await control.evaluate(el => el === document.activeElement)))
            throw new Error('Widget does not own keyboard focus');
          await page.keyboard.press(key);
          // Sample delayed local rendering, without claiming all network or async outcomes.
          await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 100)));
          await assertStable();
          if (networkAttempted || (await snapshot()).active < 0)
            throw new Error('Focus or dependent work changed under quarantine');
        };
        const focusIndex = async (index: number) => {
          await assertStable();
          if (!rootModel) {
            await eligible[index].evaluate(el => el.focus({ preventScroll: true }));
            await assertStable();
            if (!(await eligible[index].evaluate(el => document.activeElement === el)))
              throw new Error('Tab focus changed');
            return;
          }
          await list.evaluate(el => el.focus({ preventScroll: true }));
          await assertStable();
          if (!(await list.evaluate(el => document.activeElement === el)))
            throw new Error('Tab root focus changed');
          for (let step = 0; step < initial.count; step++) {
            const current = await observed();
            if (current.active === index) return;
            if (current.active < 0) throw new Error('Active descendant unavailable');
            await pressKey(current.active, current.active < index ? forward : backward);
          }
          if ((await observed()).active !== index)
            throw new Error('Cannot restore active descendant');
        };
        const vertical = (await list.getAttribute('aria-orientation')) === 'vertical';
        const rtl = await list.evaluate(el => getComputedStyle(el).direction === 'rtl');
        const forward = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
        const backward = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
        const interactionFindings: WebFinding[] = [];
        const warn = (rule: string, evidence: Record<string, unknown>, recommendation: string) =>
          interactionFindings.push({
            rule,
            guide: 'tabs',
            selector: initial.selector,
            evidence,
            recommendation,
            severity: 'warning',
          });
        try {
          await focusLease.evaluate(lease => lease.arm());
          await focusIndex(selectedIndex);
          const direction = selectedIndex === initial.count - 1 ? -1 : 1;
          const targetIndex = selectedIndex + direction;
          await pressKey(selectedIndex, direction > 0 ? forward : backward);
          const moved = await observed();
          if (moved.active !== targetIndex)
            warn(
              'widget-tabs-keyboard',
              { initial, moved, expectedIndex: targetIndex },
              'Move focus or active descendant to the adjacent enabled tab with the orientation-appropriate arrow key.',
            );
          if (moved.active === targetIndex && !moved.selected[targetIndex])
            await pressKey(targetIndex, 'Enter');
          const activated = await observed();
          if (
            moved.active === targetIndex &&
            (!activated.selected[targetIndex] ||
              !activated.panelVisible[targetIndex] ||
              activated.selected.filter(Boolean).length !== 1)
          )
            warn(
              'widget-tabs-activation',
              { activated, expectedIndex: targetIndex },
              'Synchronize selected state and visible panel after focus-following or explicit keyboard activation.',
            );
          const boundaries: Array<Record<string, unknown>> = [];
          // Home/End are optional. Unsupported shortcuts are recorded, never demanded.
          // Only an observed endpoint establishes a boundary; clamped and wrapping arrows are valid.
          for (const [key, endpoint, arrow] of [
            ['Home', 0, backward],
            ['End', initial.count - 1, forward],
          ] as const) {
            const before = await observed();
            if (before.active < 0) break;
            await pressKey(before.active, key);
            const shortcut = await observed();
            if (shortcut.active !== endpoint) {
              boundaries.push({
                key,
                status: 'unverified',
                reason: 'optional-shortcut-not-observed',
                shortcut,
              });
              continue;
            }
            await pressKey(endpoint, arrow);
            const edge = await observed();
            const opposite = endpoint === 0 ? initial.count - 1 : 0;
            const policy =
              edge.active === endpoint
                ? 'clamped'
                : edge.active === opposite
                  ? 'wrapped'
                  : 'unverified';
            boundaries.push({
              key,
              shortcut,
              edge,
              policy,
              status: policy === 'unverified' ? 'unverified' : 'observed',
            });
            // Overflow-menu focus transfer is legitimate; absent/foreign focus is not a failing boundary contract.
            if (edge.active >= 0 && policy === 'unverified')
              warn(
                'widget-tabs-keyboard',
                { key, endpoint, edge, acceptedIndices: [endpoint, opposite] },
                'Keep boundary navigation consistent with the enabled tab order; clamping or wrapping are both valid.',
              );
          }
          await focusIndex(selectedIndex);
          if (!(await observed()).selected[selectedIndex]) await pressKey(selectedIndex, 'Enter');
          const restored = await observed();
          findings.push(...interactionFindings);
          tabs.push({
            initial,
            moved,
            activated,
            boundaries,
            restored,
            status: restored.selected[selectedIndex] ? 'observed' : 'unverified',
            reason: restored.selected[selectedIndex] ? null : 'selection-restoration-unverified',
            rootFocusModel: rootModel,
          });
        } finally {
          // The successful path already restores selection. Failed ownership never
          // authorizes recovery focus or another activation in a finally block.
          await focusLease.evaluate(lease => lease.dispose()).catch(() => {});
          await focusLease.dispose();
          page.off('request', onRequest);
          await originalPanels.dispose();
          await collection.dispose();
        }
      } catch {
        tabs.push({ status: 'unverified', reason: 'widget-changed-or-dependent-work-blocked' });
      }
      if (!canContinueWidgetProbe({ observations: [tabs[tabs.length - 1]] })) break;
    }

    if (stopAfter('tabs', { observations: tabs })) return finish();
    detailsProbe = await inspectDetails(page);
    findings.push(...detailsProbe.findings);
    if (stopAfter('details', detailsProbe)) return finish();
    switchProbe = await inspectSwitches(page);
    findings.push(...switchProbe.findings);
    if (stopAfter('switches', switchProbe)) return finish();

    const ranges = (await page
      .locator(
        'input[type="range"]:not(:disabled):not([readonly]), [role="slider"]:not([aria-disabled="true"]):not([aria-readonly="true"])',
      )
      .filter({ visible: true })
      .elementHandles()) as ElementHandle<HTMLElement>[];
    for (const control of ranges.slice(0, LIMIT)) {
      // https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis
      // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
      // Retained context and no refocus after theft are local probe safety policy, not
      // a requirement that stores use a particular slider API. Private signatures never leave the page.
      const owner = await control
        .evaluateHandle(el => {
          // Local safety bounds: 24 ancestors, 128 attributes/node, and 16384
          // attribute name/value code units per node (before JSON serialization).
          const signature = (node: Element) => {
            if (node.attributes.length > 128) return null;
            let chars = 0;
            const attributes: string[][] = [];
            for (const attribute of node.attributes) {
              if (['aria-valuenow', 'aria-valuetext'].includes(attribute.name)) continue;
              chars += attribute.name.length + attribute.value.length;
              if (chars > 16384) return null;
              attributes.push([attribute.name, attribute.value]);
            }
            return JSON.stringify(attributes.sort());
          };
          const ancestors: Element[] = [];
          let node = el.parentElement;
          for (; node && ancestors.length < 24; node = node.parentElement) ancestors.push(node);
          const signatures = [el, ...ancestors].map(signature);
          const eligible = !node && signatures.every(value => value !== null);
          let focusLost = false;
          const onFocus = (event: FocusEvent) => {
            if (event.target !== el) focusLost = true;
          };
          document.addEventListener('focusin', onFocus, true);
          return {
            el,
            eligible,
            dispose: () => document.removeEventListener('focusin', onFocus, true),
            valid: () => {
              const current: Element[] = [];
              let node = el.parentElement;
              for (; node && current.length < 24; node = node.parentElement) current.push(node);
              return (
                eligible &&
                !focusLost &&
                !node &&
                el.isConnected &&
                document.activeElement === el &&
                current.length === ancestors.length &&
                current.every((node, i) => node === ancestors[i]) &&
                [el, ...current].every((node, i) => signature(node) === signatures[i]) &&
                !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
                !el.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]')
              );
            },
          };
        })
        .catch(() => null);
      if (!owner) {
        sliders.push({ status: 'unverified', reason: 'slider-changed' });
        break;
      }
      let keysSent = 0;
      try {
        if (!(await owner.evaluate(retained => retained.eligible))) {
          sliders.push({ status: 'not-probed', reason: 'slider-ownership-budget' });
          continue;
        }
        const state = () =>
          control.evaluate(el => {
            const native = el instanceof HTMLInputElement && el.type === 'range';
            const parse = (value: string | null, fallback: number | null) =>
              value === null || value === ''
                ? fallback
                : Number.isFinite(Number(value))
                  ? Number(value)
                  : null;
            return {
              selector: el.id ? '#' + CSS.escape(el.id) : 'slider',
              native,
              step: native ? parse(el.getAttribute('step'), 1) : null,
              min: parse(native ? el.getAttribute('min') : el.getAttribute('aria-valuemin'), 0),
              max: parse(native ? el.getAttribute('max') : el.getAttribute('aria-valuemax'), 100),
              value: parse(native ? el.value : el.getAttribute('aria-valuenow'), null),
              orientation: el.getAttribute('aria-orientation') || 'horizontal',
              rtl: getComputedStyle(el).direction === 'rtl',
              named: Boolean(
                el.getAttribute('aria-label')?.trim() ||
                (el.getAttribute('aria-labelledby') || '')
                  .split(/\s+/)
                  .some(id => document.getElementById(id)?.textContent?.trim()) ||
                (native && [...(el.labels || [])].some(label => label.textContent?.trim())),
              ),
              safe: !el.matches('a[href],button:not([type="button"])'),
            };
          });
        const settleKey = async (expectedValue: number | null) => {
          // A trusted input handler can queue a microtask/direct-rAF request or
          // state update. Observe it before inverse keys or compare/write cleanup.
          // https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering
          // This bounded checkpoint is not an application-idle guarantee.
          await render();
          const owned = await owner.evaluate(retained => retained.valid());
          const current = await state();
          return !dependencyObserved && owned && current.value === expectedValue;
        };
        const before = await state();
        if (
          !before.named ||
          before.min === null ||
          before.max === null ||
          before.value === null ||
          before.min > before.max ||
          before.value < before.min ||
          before.value > before.max
        )
          add(
            'widget-slider-semantics',
            'slider',
            before.selector,
            { before },
            'Name the slider and expose finite minimum, maximum and current values within bounds.',
          );
        if (
          !before.safe ||
          before.min === null ||
          before.max === null ||
          before.value === null ||
          before.min >= before.max
        ) {
          sliders.push({
            before,
            status: 'not-probed',
            reason: 'unsupported-bounds-or-action-element',
          });
          continue;
        }
        if (before.native && before.step !== null && before.step > before.max - before.min) {
          sliders.push({
            before,
            status: 'not-probed',
            reason: 'no-distinct-native-step-in-range',
          });
          continue;
        }
        const direction = before.value >= before.max ? -1 : 1;
        let key =
          before.orientation === 'vertical'
            ? direction > 0
              ? 'ArrowUp'
              : 'ArrowDown'
            : direction > 0 !== (before.native && before.rtl)
              ? 'ArrowRight'
              : 'ArrowLeft';
        // One DOM focus call: automation focus helpers can refocus after authored theft.
        if (dependencyObserved) throw new Error('Dependent work observed');
        await control.evaluate(el => el.focus({ preventScroll: true }));
        await render();
        // A focus handler can supply a new value without changing DOM context.
        // This is authored state, not a keyboard sample that cleanup may reverse.
        const focused = await state();
        if (
          dependencyObserved ||
          focused.value !== before.value ||
          !(await owner.evaluate(retained => retained.valid()))
        ) {
          sliders.push({
            before,
            status: 'unverified',
            reason: 'slider-ownership-lost',
            cleanup: { status: 'not-attempted', applicationResetVerified: false },
            keysSent,
          });
          break;
        }
        // keyboard.press does not silently focus a retained node after authored focus movement.
        if (dependencyObserved) throw new Error('Dependent work observed');
        keysSent++;
        await page.keyboard.press(key);
        let changed = await state();
        if (!(await settleKey(changed.value))) {
          sliders.push({
            before,
            changed,
            status: 'unverified',
            reason: 'slider-ownership-lost',
            cleanup: { status: 'not-attempted', applicationResetVerified: false },
            keysSent,
          });
          break;
        }
        // Engines differ on native RTL arrow direction; sample the opposite arrow at a clamped bound.
        if (changed.value === before.value && before.native) {
          key =
            key === 'ArrowUp'
              ? 'ArrowDown'
              : key === 'ArrowDown'
                ? 'ArrowUp'
                : key === 'ArrowRight'
                  ? 'ArrowLeft'
                  : 'ArrowRight';
          keysSent++;
          await page.keyboard.press(key);
          changed = await state();
        }
        if (!(await settleKey(changed.value))) {
          sliders.push({
            before,
            changed,
            status: 'unverified',
            reason: 'slider-ownership-lost',
            cleanup: { status: 'not-attempted', applicationResetVerified: false },
            keysSent,
          });
          break;
        }
        const keyboardFailed =
          changed.value === before.value ||
          changed.value === null ||
          changed.value < before.min ||
          changed.value > before.max;
        // Compare-before-restore atomically with retained ownership; do not emit business events.
        if (dependencyObserved) throw new Error('Dependent work observed');
        let cleanupAttempted = false;
        if (before.native) {
          cleanupAttempted = await owner.evaluate(
            (retained, values) => {
              if (
                !retained.valid() ||
                Number((retained.el as HTMLInputElement).value) !== values.changed
              )
                return false;
              (retained.el as HTMLInputElement).value = String(values.initial);
              return true;
            },
            { changed: changed.value, initial: before.value },
          );
        } else if (
          await owner.evaluate(
            (retained, value) =>
              retained.valid() && Number(retained.el.getAttribute('aria-valuenow')) === value,
            changed.value,
          )
        ) {
          cleanupAttempted = true;
          keysSent++;
          await page.keyboard.press(
            key === 'ArrowUp'
              ? 'ArrowDown'
              : key === 'ArrowDown'
                ? 'ArrowUp'
                : key === 'ArrowRight'
                  ? 'ArrowLeft'
                  : 'ArrowRight',
          );
        }
        await render();
        const restored = await state();
        const owned = (await owner.evaluate(retained => retained.valid())) && !dependencyObserved;
        const cleanup = {
          applicationResetVerified: false,
          status:
            cleanupAttempted && owned && restored.value === before.value
              ? 'restored'
              : 'unverified',
        };
        // Loss during inverse cleanup invalidates provisional keyboard evidence too.
        if (owned && cleanup.status === 'restored' && keyboardFailed)
          add(
            'widget-slider-keyboard',
            'slider',
            before.selector,
            { before, changed },
            'Support arrow-key value changes and keep the exposed value inside the slider bounds.',
          );
        sliders.push({
          before,
          changed,
          restored,
          cleanup,
          keysSent,
          status: owned && cleanup.status === 'restored' ? 'observed' : 'unverified',
        });
        if (!owned || cleanup.status !== 'restored') break;
      } catch {
        sliders.push({ status: 'unverified', reason: 'slider-changed', keysSent });
        break;
      } finally {
        await owner.evaluate(retained => retained.dispose()).catch(() => {});
        await owner.dispose();
      }
    }
    if (stopAfter('sliders', { observations: sliders })) return finish();
    menuNavigation = await inspectMenuNavigation(page);
    findings.push(...menuNavigation.findings);
    if (stopAfter('menuNavigation', menuNavigation)) return finish();
    switching = await inspectMenubarSwitching(page);
    findings.push(...switching.findings);
    if (stopAfter('menubarSwitching', switching)) return finish();
    composites = await inspectComposites(page);
    findings.push(...composites.findings);
    if (stopAfter('composites', { observations: [...composites.menubars, ...composites.toolbars] }))
      return finish();
    // Sample table reachability before the optional authored accordion actions:
    // a quarantined action makes later probes unsafe, not a broken table verdict.
    tableScroll = await inspectTableScroll(page);
    findings.push(...tableScroll.findings);
    if (stopAfter('tableScroll', tableScroll)) return finish();
    customAccordions = await inspectCustomAccordions(page);
    findings.push(...customAccordions.findings);
    stopAfter('customAccordions', customAccordions);
    return finish();
  } finally {
    page.context().off('request', observeDependency);
    page.off('websocket', observeDependency);
  }
}
