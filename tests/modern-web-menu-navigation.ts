// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// menu: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/menu.md
// Follow only a uniquely associated retained hierarchy, reversing inline keys in RTL.
// Ambiguous portals/unsafe buttons are excluded; commands and links are never activated.
import type { ElementHandle, JSHandle, Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

type MenuHandle = ElementHandle<HTMLElement>;

export async function menuState(trigger: MenuHandle, menu: MenuHandle) {
  return trigger.evaluate((button, target) => {
    const rendered = (node: Element) => {
      for (let el: Element | null = node; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (
          el.matches('[hidden],[inert],[aria-hidden="true"]') ||
          style.display === 'none' ||
          style.visibility !== 'visible' ||
          style.contentVisibility === 'hidden'
        )
          return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const refs = ['aria-controls', 'commandfor', 'popovertarget'].filter(attr =>
      button.hasAttribute(attr),
    );
    const associationStable =
      refs.every(attr => {
        const ids = (button.getAttribute(attr) || '').trim().split(/\s+/).filter(Boolean);
        if (ids.length !== 1) return false;
        const node = document.getElementById(ids[0]);
        return Boolean(
          node &&
          document.querySelectorAll('#' + CSS.escape(ids[0])).length === 1 &&
          (node === target || node.querySelector('[role="menu"],[focusgroup~="menu"]') === target),
        );
      }) &&
      (refs.length > 0 ||
        button.nextElementSibling === target ||
        button.nextElementSibling?.querySelector('[role="menu"],[focusgroup~="menu"]') === target);
    const active = document.activeElement;
    const descendant =
      active === target
        ? document.getElementById(target.getAttribute('aria-activedescendant') || '')
        : null;
    const effective = descendant && target.contains(descendant) ? descendant : active;
    const owner = button.closest('[role="menubar"]');
    const systemFocus = Boolean(
      active && (active === button || target.contains(active) || owner?.contains(active)),
    );
    return {
      selector: button.id ? '#' + CSS.escape(button.id) : 'button[aria-haspopup="menu"]',
      connected: button.isConnected && target.isConnected,
      associationStable,
      safe:
        button instanceof HTMLButtonElement &&
        button.type === 'button' &&
        !button.disabled &&
        !button.matches('[aria-disabled="true"]') &&
        ['menu', 'true'].includes(button.getAttribute('aria-haspopup') || '') &&
        (!button.hasAttribute('command') ||
          ['toggle-popover', 'show-popover'].includes(button.getAttribute('command') || '')) &&
        button.getAttribute('popovertargetaction') !== 'hide' &&
        rendered(button),
      visible: rendered(target),
      expanded: button.getAttribute('aria-expanded'),
      triggerFocused: active === button,
      focusInside: Boolean(effective && target.contains(effective) && effective !== target),
      effectiveFocusVisible: Boolean(
        effective && effective !== document.body && rendered(effective),
      ),
      systemFocus,
      unsupportedFocus: active instanceof HTMLIFrameElement || Boolean(active?.shadowRoot),
      browserFocus:
        !active ||
        active === document.body ||
        active === document.documentElement ||
        !document.hasFocus(),
      named: Boolean(
        target.getAttribute('aria-label')?.trim() ||
        (target.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .some(id => document.getElementById(id)?.textContent?.trim()),
      ),
      transitioning: target
        .getAnimations({ subtree: true })
        .some(animation => animation.playState === 'running'),
      rtl: getComputedStyle(target).direction === 'rtl',
      modalOutside: [...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(
        modal => rendered(modal) && !modal.contains(button),
      ),
      nativeFocusgroup: target.hasAttribute('focusgroup') && 'focusGroup' in HTMLElement.prototype,
    };
  }, menu);
}

export async function menuFor(trigger: MenuHandle) {
  const handle = await trigger.evaluateHandle(button => {
    const refs = ['aria-controls', 'commandfor', 'popovertarget']
      .map(attr => button.getAttribute(attr))
      .filter(Boolean);
    const target = refs.length ? document.getElementById(refs[0]!) : button.nextElementSibling;
    if (!target) return null;
    return target.matches('[role="menu"],[focusgroup~="menu"]')
      ? target
      : target.querySelector('[role="menu"],[focusgroup~="menu"]');
  });
  const element = handle.asElement() as MenuHandle | null;
  if (!element) await handle.dispose();
  return element;
}

async function retainItems(menu: MenuHandle) {
  return menu.evaluateHandle(root =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button,a[href],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
      ),
    ]
      .filter(item => {
        const style = getComputedStyle(item),
          rect = item.getBoundingClientRect();
        return (
          item.closest('[role="menu"],[focusgroup~="menu"]') === root &&
          !item.matches(':disabled,[aria-disabled="true"]') &&
          !item.closest('[hidden],[inert],[aria-hidden="true"]') &&
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          style.contentVisibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .slice(0, 21),
  );
}

/** Navigation only. No Enter, Space, clicks, checkable commands or destination links are activated. */
export async function inspectMenuNavigation(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Menu navigation probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const candidates = (await page
    .locator('button[aria-haspopup="menu"],button[aria-haspopup="true"]')
    .filter({ visible: true })
    .elementHandles()) as MenuHandle[];
  const roots: MenuHandle[] = [];
  for (const trigger of candidates)
    if (!(await trigger.evaluate(button => button.closest('[role="menu"],[focusgroup~="menu"]'))))
      roots.push(trigger);
  const originalFocus = await page.evaluateHandle(() => document.activeElement);
  for (const trigger of roots.slice(0, 5)) {
    let menu: MenuHandle | null = null,
      child: MenuHandle | null = null,
      nested: MenuHandle | null = null;
    let collection: JSHandle<HTMLElement[]> | undefined;
    let requests = 0;
    const onRequest = () => requests++;
    const pending: WebFinding[] = [];
    const warn = (
      rule: string,
      selector: string,
      evidence: Record<string, unknown>,
      recommendation: string,
    ) =>
      pending.push({
        rule,
        guide: 'menu',
        severity: 'warning',
        selector,
        evidence,
        recommendation,
      });
    let started = false;
    try {
      if (
        await trigger.evaluate(
          button =>
            button.closest('[role="menubar"]')?.getAttribute('aria-orientation') === 'vertical',
        )
      ) {
        observations.push({
          status: 'not-probed',
          reason: 'vertical-menubar-entry-contract-unverified',
        });
        continue;
      }
      menu = await menuFor(trigger);
      if (!menu) {
        observations.push({ status: 'not-probed', reason: 'no-identifiable-menu-target' });
        continue;
      }
      const initial = await menuState(trigger, menu);
      if (!initial.safe || !initial.associationStable || initial.modalOutside || initial.visible) {
        observations.push({
          initial,
          status: 'not-probed',
          reason: initial.visible
            ? 'initially-open-menu'
            : initial.modalOutside
              ? 'active-modal-outside-menu'
              : 'unsafe-or-ambiguous-trigger',
        });
        continue;
      }
      const stable = async () => {
        const state = await menuState(trigger, menu!);
        if (!state.connected || !state.associationStable || !state.safe || state.modalOutside)
          throw new Error('menu-changed');
        return state;
      };
      const settle = async () => {
        // eslint-disable-next-line playwright/no-wait-for-timeout -- Bounded author-handler/transition observation; async work is not certified.
        await page.waitForTimeout(200);
      };
      const enter = async () => {
        await stable();
        await trigger.focus();
        await stable();
        if (!(await menuState(trigger, menu!)).triggerFocused)
          throw new Error('trigger-focus-stolen');
        await page.keyboard.press('ArrowDown');
        started = true;
        await settle();
        return stable();
      };
      page.on('request', onRequest);
      const entered = await enter();
      if (entered.unsupportedFocus) throw new Error('unsupported-focus-surface');
      if (entered.transitioning) throw new Error('menu-transition-running');
      if (!entered.visible || !entered.focusInside) {
        warn(
          'menu-keyboard-entry',
          initial.selector,
          { entered },
          'Let ArrowDown on an explicitly associated menu trigger open its menu and move keyboard focus into an enabled item.',
        );
        observations.push({
          initial,
          entered,
          status: requests ? 'unverified' : 'observed',
          requests,
          reason: requests ? 'dependent-work-blocked' : null,
        });
        if (!requests) findings.push(...pending);
        continue;
      }
      if (!entered.named || (entered.expanded !== null && entered.expanded !== 'true'))
        warn(
          'menu-open-semantics',
          initial.selector,
          {
            named: entered.named,
            explicitExpandedMatchesOpen: entered.expanded === null || entered.expanded === 'true',
          },
          'Name the menu and synchronize any explicit aria-expanded with its open state; native implicit expanded semantics need no redundant attribute.',
        );
      collection = await retainItems(menu);
      const itemCount = await collection.evaluate(items => items.length);
      if (itemCount > 20 || !itemCount) {
        observations.push({
          initial,
          entered,
          status: 'not-probed',
          reason: 'menu-item-limit-or-empty-sample',
          itemSampleTruncated: itemCount > 20,
        });
        continue;
      }
      const exactItems = async () => {
        const valid = await collection!.evaluate((items, root) => {
          const current = [
            ...root.querySelectorAll<HTMLElement>(
              'button,a[href],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
            ),
          ]
            .filter(item => {
              const rect = item.getBoundingClientRect(),
                style = getComputedStyle(item);
              return (
                item.closest('[role="menu"],[focusgroup~="menu"]') === root &&
                !item.matches(':disabled,[aria-disabled="true"]') &&
                !item.closest('[hidden],[inert],[aria-hidden="true"]') &&
                style.display !== 'none' &&
                style.visibility === 'visible' &&
                style.contentVisibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
              );
            })
            .slice(0, 21);
          return (
            items.length === current.length &&
            items.every((item, i) => item === current[i] && item.isConnected)
          );
        }, menu!);
        if (!valid) throw new Error('menu-items-changed');
        await stable();
      };
      const nestedHandle = await collection.evaluateHandle(
        items =>
          items.find(
            item =>
              item instanceof HTMLButtonElement &&
              ['menu', 'true'].includes(item.getAttribute('aria-haspopup') || ''),
          ) || null,
      );
      nested = nestedHandle.asElement() as MenuHandle | null;
      const submenus: Array<Record<string, unknown>> = [];
      if (nested) {
        child = await menuFor(nested);
        if (!child)
          submenus.push({ status: 'not-probed', reason: 'no-identifiable-submenu-target' });
        else if (!(await menu.evaluate((parent, target) => parent.contains(target), child)))
          submenus.push({ status: 'not-probed', reason: 'portal-submenu-ownership-unverified' });
        else {
          const before = await menuState(nested, child);
          if (
            !before.connected ||
            !before.associationStable ||
            !before.safe ||
            before.visible ||
            before.modalOutside
          )
            submenus.push({
              status: 'not-probed',
              reason: 'unsafe-ambiguous-or-initially-open-submenu',
            });
          else {
            for (const closeKey of ['Escape', before.rtl ? 'ArrowRight' : 'ArrowLeft']) {
              await exactItems();
              const prepared = await menuState(nested, child);
              if (!prepared.connected || !prepared.associationStable || !prepared.safe)
                throw new Error('submenu-trigger-changed');
              await nested.focus();
              const focused = await menuState(nested, child);
              if (
                !focused.triggerFocused ||
                !focused.connected ||
                !focused.associationStable ||
                !focused.safe
              )
                throw new Error('submenu-focus-changed');
              await page.keyboard.press(before.rtl ? 'ArrowLeft' : 'ArrowRight');
              await settle();
              await exactItems();
              const opened = await menuState(nested, child);
              if (
                !opened.connected ||
                !opened.associationStable ||
                !opened.safe ||
                opened.transitioning
              )
                throw new Error('submenu-changed');
              if (!opened.visible || !opened.focusInside) {
                warn(
                  'menu-submenu-entry',
                  initial.selector,
                  { opened, closeKey },
                  'Allow the inline-end arrow to enter the declared submenu without activating a command.',
                );
                submenus.push({ opened, status: 'observed', closeKey, closeAttempted: false });
                break;
              }
              if (!opened.named || (opened.expanded !== null && opened.expanded !== 'true'))
                warn(
                  'menu-submenu-semantics',
                  initial.selector,
                  {
                    named: opened.named,
                    explicitExpandedMatchesOpen:
                      opened.expanded === null || opened.expanded === 'true',
                  },
                  'Name the submenu and keep any authored expanded state synchronized with its visibility.',
                );
              // This is the real focused owner; do not refocus the trigger to send dismissal.
              await page.keyboard.press(closeKey);
              await settle();
              const closed = await menuState(nested, child),
                parent = await stable();
              if (!closed.connected || !closed.associationStable || closed.transitioning)
                throw new Error('submenu-dismissal-changed');
              if (
                closed.visible ||
                !closed.triggerFocused ||
                !parent.visible ||
                (closed.expanded !== null && closed.expanded !== 'false')
              )
                warn(
                  'menu-submenu-dismiss',
                  initial.selector,
                  { closeKey, closed, parentVisible: parent.visible },
                  'Close only the current submenu with Escape or the inline-start arrow, retain the parent menu and restore focus to the submenu trigger.',
                );
              submenus.push({
                opened,
                closed,
                parentVisible: parent.visible,
                closeKey,
                status: 'observed',
              });
              if (!parent.visible) break;
            }
          }
        }
      } else await nestedHandle.dispose();
      let rootDismiss: Record<string, unknown> = { status: 'unverified' };
      let tabExit: Record<string, unknown> = { status: 'unverified' };
      if ((await stable()).visible) {
        // Avoid global Escape if focus has left the retained menu hierarchy.
        await exactItems();
        const beforeClose = await stable();
        if (!beforeClose.focusInside) throw new Error('focus-left-menu');
        await page.keyboard.press('Escape');
        await settle();
        const closed = await stable();
        if (closed.transitioning) throw new Error('root-close-transition');
        rootDismiss = { closed, status: 'observed' };
        if (
          closed.visible ||
          !closed.triggerFocused ||
          (closed.expanded !== null && closed.expanded !== 'false')
        )
          warn(
            'menu-dismiss-focus',
            initial.selector,
            { closed },
            'Escape should close the top-level menu and restore keyboard focus to its trigger.',
          );
        if (!closed.visible) {
          const steps: Array<Record<string, unknown>> = [];
          for (const key of ['Tab', 'Shift+Tab']) {
            const reopened = await enter();
            if (!reopened.visible || !reopened.focusInside || reopened.transitioning) {
              steps.push({ key, status: 'unverified', reason: 'reentry-unavailable' });
              break;
            }
            await exactItems();
            await page.keyboard.press(key);
            await settle();
            const exited = await stable();
            if (exited.transitioning) {
              steps.push({ key, status: 'unverified', reason: 'close-transition-running' });
              break;
            }
            steps.push({
              key,
              exited,
              status: exited.browserFocus || exited.unsupportedFocus ? 'unverified' : 'observed',
            });
            tabExit = {
              steps,
              exited,
              status: steps.some(step => step.status === 'unverified') ? 'unverified' : 'observed',
            };
            if (
              exited.visible ||
              (!exited.browserFocus &&
                !exited.unsupportedFocus &&
                (exited.systemFocus || !exited.effectiveFocusVisible))
            )
              warn(
                'menu-tab-exit',
                initial.selector,
                { key, exited },
                'Tab and Shift+Tab should leave and close the menu system without stepping through commands or stranding focus in hidden content.',
              );
            if (exited.visible) break;
          }
        }
      }
      observations.push({
        initial,
        entered,
        itemCount,
        submenus,
        rootDismiss,
        tabExit,
        status: requests ? 'unverified' : 'observed',
        requests,
        reason: requests ? 'dependent-work-blocked' : null,
      });
      if (!requests) findings.push(...pending);
    } catch {
      observations.push({
        status: 'unverified',
        reason: 'retained-menu-focus-or-local-state-changed',
        requests,
      });
    } finally {
      // Best effort keyboard cleanup only inside the retained, still-associated hierarchy.
      if (started && menu) {
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const state = await menuState(trigger, menu);
            if (
              !state.connected ||
              !state.associationStable ||
              !state.safe ||
              !state.visible ||
              !state.focusInside ||
              state.modalOutside
            )
              break;
            await page.keyboard.press('Escape');
          }
        } catch {
          /* Never invoke replacement nodes or close an unrelated overlay. */
        }
      }
      page.off('request', onRequest);
      await collection?.dispose();
      await nested?.dispose();
      await child?.dispose();
      await menu?.dispose();
    }
  }
  try {
    await originalFocus.evaluate(node => {
      if (node instanceof HTMLElement && node.isConnected) node.focus();
    });
  } catch {
    /* The original owner may have been removed. */
  }
  await originalFocus.dispose();
  return {
    observations,
    findings,
    candidateCount: roots.length,
    sampleTruncated: roots.length > 5,
    limit: 5,
    itemLimit: 20,
    submenuDepth: 1,
    localSettleWindowMs: 200,
    commandActivationAttempted: false,
  };
}
