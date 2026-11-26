import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';

// Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/accordion.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
// Native summary activation supplies Enter/Space behavior; no new API or custom
// arrow-key policy is demanded. Retained nodes, local bounds and stop-after-loss
// are audit safety policy, not restrictions on merchant disclosure implementations.
export async function inspectDetails(page: Page) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Details probes require prepareInteractionProbe(...).freeze() first');
  const controls: ElementHandle<Element>[] = [];
  const locator = page.locator('details');
  for (let i = 0, count = Math.min(await locator.count(), 5); i < count; i++) {
    const control = await locator.nth(i).elementHandle();
    if (control) controls.push(control);
  }
  // Capture every candidate before the first action, so earlier handlers cannot
  // silently repurpose a later retained node and make it a new probe target.
  const owners = await Promise.all(
    controls.map(control =>
      control
        .evaluateHandle(element => {
          const el = element as HTMLDetailsElement;
          const native = el instanceof HTMLDetailsElement;
          const summary =
            el.firstElementChild instanceof HTMLElement &&
            el.firstElementChild.tagName === 'SUMMARY'
              ? el.firstElementChild
              : null;
          const name = el.getAttribute('name');
          const grouped = Boolean(name);
          const documentDetails = document.querySelectorAll('details');
          const documentLimited = grouped && documentDetails.length > 64;
          const members =
            grouped && !documentLimited
              ? [...documentDetails].filter(node => node.getAttribute('name') === name)
              : [el];
          const groupLimited = members.length > 32;
          const retainedMembers = groupLimited ? [] : members;
          const memberSet = new Set<Element>(retainedMembers);
          const ancestry = (node: Element) => {
            const nodes: Element[] = [];
            let current = node.parentElement;
            for (; current && nodes.length < 24; current = current.parentElement)
              nodes.push(current);
            return { nodes, limited: Boolean(current) };
          };
          const signature = (node: Element) => {
            if (node.attributes.length > 128) return null;
            let chars = 0;
            const values: string[][] = [];
            for (const attribute of node.attributes) {
              if (memberSet.has(node) && attribute.name === 'open') continue;
              chars += attribute.name.length + attribute.value.length;
              if (chars > 16384) return null;
              values.push([attribute.name, attribute.value]);
            }
            return JSON.stringify(values.sort());
          };
          const records = retainedMembers.map(node => {
            const peerSummary =
              node.firstElementChild?.tagName === 'SUMMARY' ? node.firstElementChild : null;
            const parents = ancestry(node);
            const nodes = [node, ...parents.nodes, ...(peerSummary ? [peerSummary] : [])];
            return { node, summary: peerSummary, parents, nodes, signatures: nodes.map(signature) };
          });
          const nestedGroup = retainedMembers.some(node =>
            retainedMembers.some(other => node !== other && node.contains(other)),
          );
          const budget =
            native &&
            !documentLimited &&
            !groupLimited &&
            !nestedGroup &&
            records.every(
              record => !record.parents.limited && record.signatures.every(value => value !== null),
            );
          const initial = retainedMembers.map(node => node.hasAttribute('open'));
          let expected = [...initial];
          let armed = false,
            focusLost = false;
          const onFocus = (event: FocusEvent) => {
            if (armed && event.target !== summary) focusLost = true;
          };
          document.addEventListener('focusin', onFocus, true);
          const visible = (node: Element) => {
            const style = getComputedStyle(node),
              rect = node.getBoundingClientRect();
            return (
              !node.closest(
                '[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])',
              ) &&
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              rect.width > 0 &&
              rect.height > 0 &&
              ![node, ...ancestry(node).nodes].some(
                parent => getComputedStyle(parent).contentVisibility === 'hidden',
              )
            );
          };
          const context = () => {
            if (
              !budget ||
              el.getRootNode() !== document ||
              !summary ||
              summary.parentElement !== el ||
              el.firstElementChild !== summary
            )
              return false;
            if (grouped) {
              const current = document.querySelectorAll('details');
              if (current.length > 64) return false;
              const group = [...current].filter(node => node.getAttribute('name') === name);
              if (
                group.length !== retainedMembers.length ||
                group.some((node, i) => node !== retainedMembers[i])
              )
                return false;
            }
            return records.every(record => {
              const current = ancestry(record.node);
              return (
                record.node.isConnected &&
                record.node.getRootNode() === document &&
                record.node.firstElementChild === record.summary &&
                record.summary?.parentElement === record.node &&
                !current.limited &&
                current.nodes.length === record.parents.nodes.length &&
                current.nodes.every((node, i) => node === record.parents.nodes[i]) &&
                record.nodes.every((node, i) => signature(node) === record.signatures[i]) &&
                visible(record.node) &&
                visible(record.summary) &&
                !record.summary.closest('[aria-disabled="true"],[aria-readonly="true"]')
              );
            });
          };
          const read = () => {
            const overlays = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
            const overlay =
              Boolean(document.querySelector('dialog[open]')) ||
              overlays.length > 64 ||
              [...overlays].some(node => {
                const rect = node.getBoundingClientRect();
                return (
                  !node.closest('[hidden],[aria-hidden="true"]') &&
                  getComputedStyle(node).visibility === 'visible' &&
                  rect.width > 0 &&
                  rect.height > 0
                );
              });
            return {
              stable: context(),
              focused: document.activeElement === summary,
              focusLost,
              open: el.hasAttribute('open'),
              states: retainedMembers.map(node => node.hasAttribute('open')),
              scope: Boolean(
                native &&
                summary &&
                visible(summary) &&
                summary.tabIndex >= 0 &&
                !summary.closest('[aria-disabled="true"],[aria-readonly="true"]') &&
                !overlay &&
                !summary.querySelector(
                  'a[href],button,input,select,textarea,[contenteditable]:not([contenteditable="false"])',
                ),
              ),
            };
          };
          const matches = (states: boolean[]) =>
            states.length === expected.length && states.every((open, i) => open === expected[i]);
          const owned = (requireFocus = true) => {
            const state = read();
            return (
              state.stable &&
              state.scope &&
              !focusLost &&
              (!requireFocus || state.focused) &&
              matches(state.states)
            );
          };
          let namingLimited = false;
          const textNamed = (node: Element) => {
            const text = node.textContent || '';
            if (text.length > 8192) {
              namingLimited = true;
              return false;
            }
            return Boolean(text.trim());
          };
          const named = Boolean(
            summary &&
            (summary.getAttribute('aria-label')?.trim() ||
              (summary.getAttribute('aria-labelledby') || '').split(/\s+/).some(id => {
                const label = document.getElementById(id);
                return label && textNamed(label);
              }) ||
              (() => {
                if (
                  summary.querySelectorAll('*').length > 128 ||
                  (summary.textContent || '').length > 8192
                ) {
                  namingLimited = true;
                  return false;
                }
                const copy = summary.cloneNode(true) as HTMLElement;
                copy
                  .querySelectorAll('[hidden],[aria-hidden="true"]')
                  .forEach(node => node.remove());
                return textNamed(copy);
              })()),
          );
          const index = retainedMembers.indexOf(el);
          const before = read();
          const exclusive = grouped && Object.hasOwn(HTMLDetailsElement.prototype, 'name');
          return {
            budget,
            hasSummary: Boolean(summary),
            semantics: {
              named,
              namingUnverified: namingLimited && !named,
              nestedHeading: Boolean(summary?.querySelector('h1,h2,h3,h4,h5,h6')),
              disabled: summary?.getAttribute('aria-disabled') === 'true',
            },
            before: {
              open: el.hasAttribute('open'),
              grouped,
              native,
              visible: visible(el),
              scope: before.scope,
              stable: before.stable,
            },
            read,
            focus: () => {
              if (!owned(false)) return false;
              armed = true;
              summary!.focus({ preventScroll: true });
              return true;
            },
            owned,
            // https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element
            // Opening a name-group member synchronously closes the other open member.
            // A missing name API is accepted as the guide's non-exclusive fallback.
            acceptKey: () => {
              const state = read();
              const next = [...expected];
              next[index] = state.open;
              if (exclusive && state.open && state.open !== expected[index])
                next.forEach((_, i) => {
                  if (i !== index) next[i] = false;
                });
              if (
                !state.stable ||
                !state.scope ||
                !state.focused ||
                focusLost ||
                state.states.some((open, i) => open !== next[i])
              )
                return false;
              expected = next;
              return true;
            },
            restoreStep: (keys: number) => {
              if (!owned())
                return {
                  status: 'not-restored',
                  method: 'none',
                  reason: 'details-context-or-state-changed',
                };
              if (expected.every((open, i) => open === initial[i]))
                return {
                  status: keys === 2 ? 'restored' : 'unchanged',
                  method: keys === 2 ? 'keyboard' : 'none',
                };
              let change = expected.findIndex((open, i) => open && !initial[i]);
              if (change < 0) change = expected.findIndex((open, i) => !open && initial[i]);
              if (change < 0)
                return {
                  status: 'not-restored',
                  method: 'none',
                  reason: 'details-context-or-state-changed',
                };
              const desired = initial[change];
              const next = [...expected];
              next[change] = desired;
              if (exclusive && desired)
                next.forEach((_, i) => {
                  if (i !== change) next[i] = false;
                });
              // One synchronous compare/native-set; toggle handlers run later. The
              // caller crosses two rendering turns and rechecks before any next write.
              Object.getOwnPropertyDescriptor(HTMLDetailsElement.prototype, 'open')!.set!.call(
                retainedMembers[change],
                desired,
              );
              if (
                !context() ||
                retainedMembers.some((node, i) => node.hasAttribute('open') !== next[i])
              )
                return {
                  status: 'not-restored',
                  method: 'none',
                  reason: 'details-context-or-state-changed',
                };
              expected = next;
              return { status: 'wrote', method: grouped ? 'native-group' : 'native-property' };
            },
            restored: () => owned() && expected.every((open, i) => open === initial[i]),
            disarm: () => {
              armed = false;
            },
            dispose: () => document.removeEventListener('focusin', onFocus, true),
          };
        })
        .catch(() => null),
    ),
  );
  const observations: Array<Record<string, unknown>> = [];
  const findings: WebFinding[] = [];
  let continuationSafe = true,
    dependent = false;
  const activity = () => {
    dependent = true;
  };
  page.context().on('request', activity);
  page.on('websocket', activity);
  const render = () =>
    page.evaluate(
      () =>
        new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  try {
    for (const [index, owner] of owners.entries()) {
      const target = `details >> nth=${index}`;
      const observation: Record<string, unknown> = { selector: target, keysSent: 0 };
      observations.push(observation);
      let keys = 0;
      try {
        if (!owner) throw new Error('changed');
        const initial = await owner.evaluate(value => value.before);
        const semantics = await owner.evaluate(value => value.semantics);
        observation.initial = { selector: target, open: initial.open, grouped: initial.grouped };
        if (!initial.native || !initial.visible) {
          Object.assign(observation, {
            status: 'not-probed',
            reason: 'outside-safe-details-scope',
          });
          continue;
        }
        if (!(await owner.evaluate(value => value.hasSummary))) {
          findings.push({
            rule: 'widget-accordion-summary',
            guide: 'accordion',
            severity: 'warning',
            selector: target,
            evidence: { firstChildSummary: false },
            recommendation: 'Place a named summary as the first child of each native disclosure.',
          });
          Object.assign(observation, { status: 'not-probed', reason: 'missing-first-summary' });
          continue;
        }
        if (!(await owner.evaluate(value => value.budget))) {
          Object.assign(observation, { status: 'not-probed', reason: 'details-ownership-budget' });
          continue;
        }
        if (semantics.disabled) {
          Object.assign(observation, {
            status: 'not-probed',
            reason: 'declared-disabled-or-always-open-policy',
          });
          continue;
        }
        if (!initial.scope || !initial.stable) {
          Object.assign(observation, {
            status: 'not-probed',
            reason: 'outside-safe-details-scope',
          });
          continue;
        }
        if (semantics.namingUnverified) {
          Object.assign(observation, { status: 'not-probed', reason: 'details-naming-budget' });
          continue;
        }
        if (!semantics.named || semantics.nestedHeading)
          findings.push({
            rule: 'widget-accordion-summary',
            guide: 'accordion',
            severity: 'warning',
            selector: target,
            evidence: { named: semantics.named, nestedHeading: semantics.nestedHeading },
            recommendation:
              'Give each summary an accessible name; do not put heading semantics inside summary.',
          });
        if (
          dependent ||
          !(await owner.evaluate(value => value.focus())) ||
          !(await owner.evaluate(value => value.owned()))
        )
          throw new Error('changed');
        const press = async (key: string) => {
          if (dependent || !(await owner.evaluate(value => value.owned())))
            throw new Error('changed');
          keys++;
          await page.keyboard.press(key);
          if (dependent || !(await owner.evaluate(value => value.acceptKey())))
            throw new Error('changed');
          await render();
          if (dependent || !(await owner.evaluate(value => value.owned())))
            throw new Error('changed');
          return owner.evaluate(value => value.read().open);
        };
        const toggled = await press('Enter');
        observation.toggled = toggled;
        const restored = toggled === initial.open ? toggled : await press('Space');
        observation.restored = restored;
        const failed = toggled === initial.open || restored !== initial.open;
        let method = 'none',
          cleanupWrites = 0;
        for (let step = 0; step < 64; step++) {
          if (dependent) throw new Error('changed');
          const result = await owner.evaluate((value, count) => value.restoreStep(count), keys);
          if (result.status === 'not-restored') throw new Error('changed');
          if (result.status !== 'wrote') {
            if (!cleanupWrites) method = result.method;
            observation.restoration = {
              status: result.status,
              method,
              applicationResetVerified: false,
              cleanupWrites,
            };
            break;
          }
          cleanupWrites++;
          method = result.method;
          await render();
          if (dependent || !(await owner.evaluate(value => value.owned())))
            throw new Error('changed');
        }
        if (!(await owner.evaluate(value => value.restored()))) throw new Error('changed');
        observation.status = 'observed';
        if (failed)
          findings.push({
            rule: 'widget-accordion-keyboard',
            guide: 'accordion',
            severity: 'warning',
            selector: target,
            evidence: { initialOpen: initial.open, toggled, restored },
            recommendation:
              'Allow Enter and Space to toggle a non-disabled disclosure and retain focus on its summary; DOM cleanup does not certify application reset.',
          });
      } catch {
        Object.assign(observation, {
          status: 'unverified',
          reason: dependent ? 'dependent-work-blocked' : 'details-context-state-or-focus-changed',
          restoration: { status: 'not-restored', method: 'none', applicationResetVerified: false },
        });
        continuationSafe = false;
      } finally {
        observation.keysSent = keys;
        observation.restoration ||= {
          status: 'unchanged',
          method: 'none',
          applicationResetVerified: false,
          cleanupWrites: 0,
        };
        if (owner) await owner.evaluate(value => value.disarm()).catch(() => {});
      }
      if (!continuationSafe) break;
    }
  } finally {
    page.context().off('request', activity);
    page.off('websocket', activity);
    for (const owner of owners)
      if (owner) {
        await owner.evaluate(value => value.dispose()).catch(() => {});
        await owner.dispose();
      }
    for (const control of controls) await control.dispose();
  }
  return {
    observations,
    findings,
    continuationSafe,
    perPageLimit: 5,
    keyLimit: 2,
    groupMemberLimit: 32,
    documentDetailsLimit: 64,
    ancestorOwnershipLimit: 24,
    attributesPerNodeLimit: 128,
    attributeCodeUnitsPerNodeLimit: 16384,
    renderingOpportunityCount: 2,
    applicationResetVerified: false,
    networkDependent: dependent,
  };
}
