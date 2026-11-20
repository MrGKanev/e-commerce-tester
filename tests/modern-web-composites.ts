// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// app-menus: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/app-menus.md
// toolbar: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/toolbar.md
// Focus-only arrow samples accept roving/root-focus/native focusgroup contracts.
// Never invoke commands or change business values to test keyboard navigation.
import { inspectCompositeTabs } from './modern-web-tab-traversal';
import type { ElementHandle, JSHandle, Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

const ROOT = '[role="menubar"],[role="toolbar"]';
const ITEM =
  'button,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],a[href],input,select,textarea,[role="button"]';
const LIMIT = 5;
const ITEM_LIMIT = 20;

/** Focus-only samples: never invoke toolbar actions, menu commands or submenu entry keys. */
export async function inspectComposites(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Composite probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const menubars: Array<Record<string, unknown>> = [];
  const toolbars: Array<Record<string, unknown>> = [];
  const roots = (await page
    .locator(ROOT)
    .filter({ visible: true })
    .elementHandles()) as ElementHandle<HTMLElement>[];
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  for (const kind of ['menubar', 'toolbar'] as const) {
    const matching = [];
    for (const root of roots) if ((await root.getAttribute('role')) === kind) matching.push(root);
    const observations = kind === 'menubar' ? menubars : toolbars;
    for (const root of matching.slice(0, LIMIT)) {
      let collection: JSHandle<HTMLElement[]> | undefined;
      const pending: WebFinding[] = [];
      let dependentRequests = 0;
      const onRequest = () => dependentRequests++;
      const guide = kind === 'menubar' ? 'app-menus' : 'toolbar';
      const warn = (
        suffix: string,
        selector: string,
        evidence: Record<string, unknown>,
        recommendation: string,
      ) =>
        pending.push({
          rule: `widget-${kind}-${suffix}`,
          guide,
          selector,
          evidence,
          recommendation,
          severity: 'warning',
        });
      try {
        collection = await root.evaluateHandle((el, query) => {
          const rendered = (node: Element) => {
            for (let current: Element | null = node; current; current = current.parentElement) {
              const s = getComputedStyle(current);
              if (
                current.matches('[hidden],[inert],[aria-hidden="true"]') ||
                s.visibility !== 'visible' ||
                s.contentVisibility === 'hidden' ||
                s.display === 'none'
              )
                return false;
            }
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          return [...el.querySelectorAll<HTMLElement>(query)]
            .filter(node => {
              if (
                node.closest('[role="menubar"],[role="toolbar"]') !== el ||
                !rendered(node) ||
                node.matches(':disabled')
              )
                return false;
              // Nested menus own their commands; a role=group wrapper does not.
              const menu = node.closest('[role="menu"],[focusgroup~="menu"]');
              if (menu && el.contains(menu)) return false;
              return !node.parentElement?.closest(
                'button,a[href],input,select,textarea,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
              );
            })
            .slice(0, 21);
        }, ITEM);
        const items: ElementHandle<HTMLElement>[] = [];
        for (const [key, value] of await collection.getProperties())
          if (/^\d+$/.test(key) && value.asElement())
            items.push(value.asElement()! as ElementHandle<HTMLElement>);
        const snapshot = () =>
          collection!.evaluate((nodes, el) => {
            const items = nodes as HTMLElement[];
            const named = (node: Element): boolean => {
              const references = (node.getAttribute('aria-labelledby') || '')
                .split(/\s+/)
                .map(id => document.getElementById(id))
                .filter((target): target is HTMLElement => Boolean(target));
              if (references.length) return references.some(target => target.textContent?.trim());
              if (node.getAttribute('aria-label')?.trim()) return true;
              if (node.getAttribute('title')?.trim()) return true;
              if (
                (node instanceof HTMLInputElement ||
                  node instanceof HTMLSelectElement ||
                  node instanceof HTMLTextAreaElement) &&
                [...(node.labels || [])].some(label => label.textContent?.trim())
              )
                return true;
              const text = (current: Node): boolean => {
                if (current instanceof Element) {
                  const style = getComputedStyle(current);
                  if (
                    current.matches('[hidden],[aria-hidden="true"]') ||
                    style.display === 'none' ||
                    style.visibility !== 'visible' ||
                    style.contentVisibility === 'hidden'
                  )
                    return false;
                  if (current instanceof HTMLImageElement && current.alt.trim()) return true;
                }
                return current.nodeType === Node.TEXT_NODE
                  ? Boolean(current.textContent?.trim())
                  : [...current.childNodes].some(text);
              };
              return text(node);
            };
            const activeId = el.getAttribute('aria-activedescendant');
            const rootModel =
              el.tabIndex >= 0 && Boolean(activeId && items.some(item => item.id === activeId));
            return {
              selector: el.id ? '#' + CSS.escape(el.id) : el.getAttribute('role')!,
              named: Boolean(
                el.getAttribute('aria-label')?.trim() ||
                (el.getAttribute('aria-labelledby') || '')
                  .split(/\s+/)
                  .some(id => document.getElementById(id)?.textContent?.trim()) ||
                el.getAttribute('title')?.trim(),
              ),
              rendered: (() => {
                for (
                  let ancestor: Element | null = el;
                  ancestor;
                  ancestor = ancestor.parentElement
                ) {
                  const style = getComputedStyle(ancestor);
                  if (
                    ancestor.matches('[hidden],[inert],[aria-hidden="true"]') ||
                    style.display === 'none' ||
                    style.visibility !== 'visible' ||
                    style.contentVisibility === 'hidden'
                  )
                    return false;
                }
                return true;
              })(),
              role: el.getAttribute('role'),
              activeDescendantValid: !activeId || items.some(item => item.id === activeId),
              count: items.length,
              itemSampleTruncated: items.length > 20,
              names: items.map(named),
              itemRolesValid: items.map(
                item =>
                  el.getAttribute('role') !== 'menubar' ||
                  ['menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(
                    item.getAttribute('role') || '',
                  ),
              ),
              safe: items.every(
                item =>
                  (item instanceof HTMLButtonElement && item.type === 'button') ||
                  (['menuitem', 'menuitemcheckbox', 'menuitemradio', 'button'].includes(
                    item.getAttribute('role') || '',
                  ) &&
                    !item.matches('a[href],input,select,textarea,button') &&
                    !item.querySelector('a[href],button,input,select,textarea')),
              ),
              entryStops:
                items.filter(item => item.tabIndex >= 0).length + Number(el.tabIndex >= 0),
              rootModel,
              active: items.findIndex(
                item =>
                  item === document.activeElement ||
                  (document.activeElement === el && Boolean(item.id) && item.id === activeId),
              ),
              vertical: el.getAttribute('aria-orientation') === 'vertical',
              rtl: getComputedStyle(el).direction === 'rtl',
              nativeFocusgroup:
                el.hasAttribute('focusgroup') && 'focusGroup' in HTMLElement.prototype,
              expanded: items.map(item => item.getAttribute('aria-expanded') === 'true'),
              connected:
                el.isConnected && items.every(item => item.isConnected && el.contains(item)),
              modalOutside: [...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(
                modal => {
                  const r = modal.getBoundingClientRect();
                  return r.width > 0 && r.height > 0 && !modal.contains(el);
                },
              ),
            };
          }, root as ElementHandle<HTMLElement>);
        const initial = await snapshot();
        if (!initial.rendered) {
          observations.push({ status: 'not-probed', reason: 'hidden-or-inert-scope' });
          continue;
        }
        if (
          !initial.activeDescendantValid ||
          !initial.named ||
          initial.names.some(value => !value) ||
          initial.itemRolesValid.some(value => !value) ||
          (!initial.nativeFocusgroup && initial.entryStops !== 1)
        )
          warn(
            'semantics',
            initial.selector,
            {
              named: initial.named,
              activeDescendantValid: initial.activeDescendantValid,
              unnamedItems: initial.names.filter(value => !value).length,
              invalidItemRoles: initial.itemRolesValid.filter(value => !value).length,
              entryStops: initial.entryStops,
              nativeFocusgroup: initial.nativeFocusgroup,
            },
            'Name the declared composite and its controls, expose appropriate item roles and one keyboard entry stop; keep ordinary navigation links outside this contract.',
          );
        findings.push(...pending.splice(0));
        if (
          !initial.safe ||
          initial.count < 2 ||
          initial.count > ITEM_LIMIT ||
          initial.modalOutside
        ) {
          observations.push({
            initial,
            status: 'not-probed',
            reason: initial.modalOutside
              ? 'active-modal-outside-widget'
              : !initial.safe
                ? 'action-or-value-control'
                : 'item-count-outside-keyboard-sample',
          });
          continue;
        }
        const stable = async () => {
          // Identity is checked in-page, not by selector re-resolution. A replacement is unverified.
          const valid = await collection!.evaluate(
            (nodes, args) => {
              const items = nodes as HTMLElement[];
              const own = [...args.root.querySelectorAll<HTMLElement>(args.query)]
                .filter(node => {
                  const r = node.getBoundingClientRect();
                  const menu = node.closest('[role="menu"],[focusgroup~="menu"]');
                  for (
                    let current: Element | null = node;
                    current;
                    current = current.parentElement
                  ) {
                    const style = getComputedStyle(current);
                    if (
                      current.matches('[hidden],[inert],[aria-hidden="true"]') ||
                      style.display === 'none' ||
                      style.visibility !== 'visible' ||
                      style.contentVisibility === 'hidden'
                    )
                      return false;
                  }
                  return (
                    node.closest('[role="menubar"],[role="toolbar"]') === args.root &&
                    !(menu && args.root.contains(menu)) &&
                    !node.matches(':disabled') &&
                    !node.closest('[hidden],[inert],[aria-hidden="true"]') &&
                    r.width > 0 &&
                    r.height > 0 &&
                    !node.parentElement?.closest(
                      'button,a[href],input,select,textarea,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
                    )
                  );
                })
                .slice(0, 21);
              return (
                args.root.isConnected &&
                items.length === own.length &&
                items.every(
                  (item, i) => item === own[i] && getComputedStyle(item).visibility === 'visible',
                )
              );
            },
            { root, query: ITEM },
          );
          const state = await snapshot();
          if (
            !valid ||
            !state.connected ||
            !state.rendered ||
            state.role !== initial.role ||
            !state.safe ||
            state.modalOutside ||
            state.vertical !== initial.vertical ||
            state.rtl !== initial.rtl ||
            state.rootModel !== initial.rootModel
          )
            throw new Error('composite-changed');
          return state;
        };
        const focus = async (index: number) => {
          await stable();
          if (initial.rootModel) {
            // Do not rewrite the author's active descendant to manufacture keyboard success.
            await root.focus();
          } else await items[index].focus();
          await stable();
        };
        const press = async (key: string) => {
          const state = await stable();
          if (state.active < 0) throw new Error('focus-left-composite');
          await (initial.rootModel ? root : items[state.active]).press(key, { timeout: 1500 });
          // eslint-disable-next-line playwright/no-wait-for-timeout -- Bounded observation window for local author handlers, not a readiness wait.
          await page.waitForTimeout(100);
          return stable();
        };
        page.on('request', onRequest);
        const entry = Math.max(
          0,
          await collection!.evaluate(nodes =>
            (nodes as HTMLElement[]).findIndex(node => node.tabIndex >= 0),
          ),
        );
        // Root focus models select the active item after focusing the root.
        await focus(Math.max(0, entry));
        const focused = await stable();
        if (focused.active < 0) throw new Error('entry-focus-unavailable');
        const forward = initial.vertical ? 'ArrowDown' : initial.rtl ? 'ArrowLeft' : 'ArrowRight';
        const backward = initial.vertical ? 'ArrowUp' : initial.rtl ? 'ArrowRight' : 'ArrowLeft';
        const direction = focused.active === initial.count - 1 ? -1 : 1;
        const moved = await press(direction > 0 ? forward : backward);
        if (moved.active !== focused.active + direction)
          warn(
            'keyboard',
            initial.selector,
            {
              beforeIndex: focused.active,
              afterIndex: moved.active,
              expectedIndex: focused.active + direction,
            },
            'Move focus or the active descendant to the adjacent control with the orientation-appropriate arrow key.',
          );
        const boundaries: Array<Record<string, unknown>> = [];
        // Directly focus endpoints for roving models. Root-focus models use optional Home/End;
        // unsupported shortcuts stay unverified. No Home/End on menubars: those enter menus.
        for (const [endpoint, key] of [
          [0, backward],
          [initial.count - 1, forward],
        ] as const) {
          if (initial.rootModel) {
            if (kind === 'menubar') continue;
            const shortcut = await press(endpoint === 0 ? 'Home' : 'End');
            if (shortcut.active !== endpoint) {
              boundaries.push({
                endpoint,
                status: 'unverified',
                reason: 'optional-shortcut-not-observed',
              });
              continue;
            }
          } else await focus(endpoint);
          const edge = await press(key);
          const opposite = endpoint === 0 ? initial.count - 1 : 0;
          const policy =
            edge.active === endpoint
              ? 'clamped'
              : edge.active === opposite
                ? 'wrapped'
                : 'unverified';
          boundaries.push({ endpoint, active: edge.active, policy });
          if (policy === 'unverified')
            warn(
              'boundary',
              initial.selector,
              { endpoint, active: edge.active },
              'Keep boundary focus on the endpoint or wrap to the opposite endpoint without skipping controls or losing focus.',
            );
        }
        if (!initial.rootModel) await focus(focused.active);
        else {
          // Reverse bounded arrows to restore the original descendant, without action keys.
          for (let attempt = 0; attempt < ITEM_LIMIT; attempt++) {
            const now = await stable();
            if (now.active === focused.active) break;
            const next = await press(now.active > focused.active ? backward : forward);
            if (next.active === now.active) break;
          }
        }
        const restored = await stable();
        const tabTraversal = await inspectCompositeTabs(
          page,
          root,
          items,
          kind,
          initial.selector,
          stable,
          async () => {
            if (initial.rootModel) await root.focus();
            else {
              // Arrow-boundary sampling may leave the authored tab stop on another
              // control. Test sequential exit from that entry, not a forced -1 item.
              const currentEntry = await collection!.evaluate(nodes =>
                nodes.findIndex(node => node.tabIndex >= 0),
              );
              await focus(currentEntry < 0 ? focused.active : currentEntry);
            }
          },
        );
        pending.push(...tabTraversal.findings);
        const { findings: _tabFindings, ...tabEvidence } = tabTraversal;
        void _tabFindings;
        // Preview menus may open on focus. Returning focus lets authored blur cleanup
        // restore the initial closed state, without invoking a command or Escape policy.
        await originalFocus.evaluate(node => {
          if (node instanceof HTMLElement && node.isConnected) node.focus();
        });
        // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow focus-preview cleanup before recording restoration.
        await page.waitForTimeout(100);
        const afterFocusReturn = await stable();
        const stateRestored =
          restored.active === focused.active &&
          afterFocusReturn.expanded.every((value, i) => value === initial.expanded[i]);
        observations.push({
          initial,
          focused,
          moved,
          boundaries,
          restored,
          tabTraversal: tabEvidence,
          afterFocusReturn,
          status: dependentRequests || !stateRestored ? 'unverified' : 'observed',
          reason: dependentRequests
            ? 'dependent-work-blocked'
            : stateRestored
              ? null
              : 'open-or-focus-state-restoration-unverified',
          dependentRequests,
        });
        if (!dependentRequests) findings.push(...pending);
      } catch {
        observations.push({
          status: 'unverified',
          reason: 'widget-changed-focus-left-or-dependent-work-blocked',
          dependentRequests,
        });
      } finally {
        page.off('request', onRequest);
        await collection?.dispose();
      }
    }
  }
  try {
    await originalFocus.evaluate(node => {
      if (node instanceof HTMLElement && node.isConnected) node.focus();
    });
  } catch {
    /* A page rerender may remove the original focus owner. */
  }
  await originalFocus.dispose();
  return {
    candidateCount: roots.length,
    sampleTruncated: roots.length > menubars.length + toolbars.length,
    menubars,
    toolbars,
    findings,
    perCategoryLimit: LIMIT,
    keyboardItemLimit: ITEM_LIMIT,
    localSettleWindowMs: 100,
    commandActivationAttempted: false,
  };
}
