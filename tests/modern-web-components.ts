// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// accessible-web-components: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/html/accessible-web-components.md
// web-components: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/html/web-components.md
// Inspect only reachable open roots and exposed semantics; absent authored ARIA
// does not prove ElementInternals semantics are missing. Closed roots remain unknown.
import type { Page } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

/** Passive open-shadow samples only. Never attachInternals(), submit forms or invoke component APIs. */
export async function inspectComponents(page: Page) {
  const snapshot = await page.evaluate(() => {
    const rootLimit = 50;
    const elementLimit = 2000;
    const findings: WebFinding[] = [];
    const roots: Array<{ root: Document | ShadowRoot; index: number }> = [
      { root: document, index: 0 },
    ];
    const observations: Array<Record<string, unknown>> = [];
    const memberships = new Set<Element>();
    const sampledForms = new Set<HTMLFormElement>();
    let membershipScanTruncated = false;
    const collectForm = (form: HTMLFormElement) => {
      if (sampledForms.has(form)) return;
      if (sampledForms.size >= rootLimit) {
        membershipScanTruncated = true;
        return;
      }
      sampledForms.add(form);
      for (let index = 0; index < form.elements.length; index++) {
        if (memberships.size >= elementLimit) {
          membershipScanTruncated = true;
          break;
        }
        memberships.add(form.elements[index]);
      }
    };
    for (let index = 0; index < Math.min(document.forms.length, rootLimit); index++)
      collectForm(document.forms[index]);
    if (document.forms.length > rootLimit) membershipScanTruncated = true;
    let visitedElements = 0;
    let customElementsObserved = 0;
    let formParticipants = 0;
    let nativeShadowControls = 0;
    let relationships = 0;
    let scanTruncated = false;
    let nameInspectionTruncated = false;
    let nameNodesVisited = 0;
    const selector = (el: Element, rootIndex: number) =>
      `tree-${rootIndex}:` + (el.id ? '#' + CSS.escape(el.id) : el.localName);
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let current: Element | null = el;
      while (current) {
        const style = getComputedStyle(current);
        if (
          current.hasAttribute('hidden') ||
          current.hasAttribute('inert') ||
          style.display === 'none' ||
          style.visibility !== 'visible' ||
          style.contentVisibility === 'hidden'
        )
          return false;
        const parent: Element | null = current.parentElement;
        current =
          parent ||
          (current.getRootNode() instanceof ShadowRoot
            ? (current.getRootNode() as ShadowRoot).host
            : null);
      }
      return true;
    };
    const add = (
      rule: string,
      guide: string,
      el: Element,
      rootIndex: number,
      evidence: Record<string, unknown>,
      recommendation: string,
    ) =>
      findings.push({
        rule,
        guide,
        selector: selector(el, rootIndex),
        severity: 'warning',
        evidence,
        recommendation,
      });
    // Text presence, not text contents, is retained. Slot assignment may provide a real native button label.
    const contentPresent = (el: Element, depth = 0): boolean => {
      if (++nameNodesVisited > elementLimit || depth > 40) {
        nameInspectionTruncated = true;
        return false;
      }
      const style = getComputedStyle(el);
      if (
        el.matches('[aria-hidden="true"],[hidden],script,style,template') ||
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        style.contentVisibility === 'hidden'
      )
        return false;
      if (el instanceof HTMLImageElement && el.alt.trim()) return true;
      if (
        el.matches('svg,[role="img"]') &&
        (el.getAttribute('aria-label')?.trim() ||
          (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .some(id =>
              (el.getRootNode() as Document | ShadowRoot).getElementById(id)?.textContent?.trim(),
            ))
      )
        return true;
      if (el instanceof HTMLSlotElement) {
        const assigned = el.assignedNodes({ flatten: true });
        if (assigned.length)
          return assigned.some(node =>
            node.nodeType === Node.TEXT_NODE
              ? Boolean(node.textContent?.trim())
              : node instanceof Element && contentPresent(node, depth + 1),
          );
      }
      return [...el.childNodes].some(node =>
        node.nodeType === Node.TEXT_NODE
          ? Boolean(node.textContent?.trim())
          : node instanceof Element && contentPresent(node, depth + 1),
      );
    };
    const namePresent = (el: Element, tree: Document | ShadowRoot) => {
      if (el.getAttribute('aria-label')?.trim() || el.getAttribute('title')?.trim()) return true;
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (ids.some(id => Boolean(tree.getElementById(id)?.textContent?.trim()))) return true;
      const reflected = (el as Element & { ariaLabelledByElements?: Element[] | null })
        .ariaLabelledByElements;
      if (reflected?.some(label => Boolean(label.textContent?.trim()))) return true;
      if (
        'labels' in el &&
        [...((el as HTMLInputElement).labels || [])].some(label => contentPresent(label))
      )
        return true;
      if (el instanceof HTMLInputElement && el.type === 'image' && el.alt.trim()) return true;
      if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type))
        return Boolean(el.value.trim()) || el.type !== 'button';
      return el.matches('button,a[href],summary') && contentPresent(el);
    };
    for (let index = 0; index < roots.length; index++) {
      const { root, index: rootIndex } = roots[index];
      // A bounded TreeWalker avoids materializing every descendant of an unbounded document.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (visitedElements >= elementLimit) {
          scanTruncated = true;
          break;
        }
        visitedElements++;
        const el = node as Element;
        if (el.localName.includes('-')) customElementsObserved++;
        if (el instanceof HTMLFormElement) collectForm(el);
        if (el.shadowRoot) {
          if (roots.length - 1 < rootLimit)
            roots.push({ root: el.shadowRoot, index: roots.length });
          else scanTruncated = true;
        }
        if ((root instanceof ShadowRoot || el.shadowRoot) && visible(el)) {
          for (const attribute of [
            'aria-labelledby',
            'aria-describedby',
            'aria-controls',
            'aria-errormessage',
          ]) {
            if (attribute === 'aria-errormessage' && el.getAttribute('aria-invalid') !== 'true')
              continue;
            const ids = (el.getAttribute(attribute) || '').trim().split(/\s+/).filter(Boolean);
            if (!ids.length) continue;
            relationships++;
            const missingCount = ids.filter(id => !root.getElementById(id)).length;
            if (missingCount)
              add(
                'shadow-aria-reference',
                'accessible-web-components',
                el,
                rootIndex,
                {
                  attribute,
                  referenceCount: ids.length,
                  missingInOwnTree: missingCount,
                  elementReflectionMayProvideSeparateRelationship: true,
                },
                'Keep ID-based ARIA references within the same tree; use supported outward element-reference reflection or an explicit label for cross-boundary relationships.',
              );
          }
          if (
            root instanceof ShadowRoot &&
            el.matches(
              'button,a[href],input:not([type="hidden"]):not([type="submit"]):not([type="reset"]),select,textarea,summary',
            ) &&
            !el.matches(':disabled')
          ) {
            nativeShadowControls++;
            if (!namePresent(el, root) && !nameInspectionTruncated)
              add(
                'shadow-native-control-name',
                'accessible-web-components',
                el,
                rootIndex,
                {
                  nativeControl: true,
                  detectableNamePresent: false,
                  computedAccessibleNameVerified: false,
                },
                'Give this shadow-internal native control a same-tree label or supported accessible name; inspect the accessibility tree for naming mechanisms not detected by this sample.',
              );
          }
        }
        if (el.localName.includes('-') && memberships.has(el)) {
          formParticipants++;
          const inner = el.shadowRoot;
          const disabled = el.matches(':disabled');
          const enabledTabStops = inner
            ? [
                ...inner.querySelectorAll<HTMLElement>(
                  'button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]',
                ),
              ].filter(
                control =>
                  !control.matches(':disabled') && control.tabIndex >= 0 && visible(control),
              ).length
            : null;
          observations.push({
            selector: selector(el, rootIndex),
            formCollectionMember: true,
            disabled,
            openShadowRoot: Boolean(inner),
            enabledInternalTabStops: enabledTabStops,
            internalsStateRead: false,
            valueAndValidityUnverified: true,
          });
          if (disabled && enabledTabStops)
            add(
              'component-disabled-focus',
              'form-associated-custom-elements',
              el,
              rootIndex,
              {
                formCollectionMember: true,
                disabled: true,
                enabledInternalTabStops: enabledTabStops,
              },
              'When a form-associated component is disabled, disable or remove its internal controls from sequential focus; verify re-enabling and event handling with a configured workflow.',
            );
        }
        node = walker.nextNode();
      }
      if (visitedElements >= elementLimit) break;
    }
    return {
      schemaVersion: 1,
      coverage: {
        openShadowRoots: roots.length - 1,
        visitedElements,
        customElementsObserved,
        nativeShadowControls,
        relationships,
        formParticipants,
        rootLimit,
        elementLimit,
        scanTruncated,
        nameInspectionTruncated,
        membershipScanTruncated,
        shadowDomSupported: 'attachShadow' in Element.prototype,
        formAssociatedApiPresent:
          'attachInternals' in HTMLElement.prototype &&
          typeof ElementInternals !== 'undefined' &&
          'setFormValue' in ElementInternals.prototype,
        closedRootsUnobservable: true,
        internalsStateRead: false,
        successfulSubmissionAttempted: false,
        scope: 'bounded-main-document-open-shadow-trees',
      },
      observations,
      findings,
    };
  });
  return { ...snapshot, url: safeAuditUrl(page.url()) };
}
