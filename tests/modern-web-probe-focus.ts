import type { Page } from '@playwright/test';

/** Retain focus ownership across planned probe transitions without undoing authored changes. */
export async function retainProbeFocus(page: Page) {
  return page.evaluateHandle(() => {
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
    let expected: Element | null = original;
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
      // Playwright focuses twice; the second call can overwrite authored redirection.
      focus: (el: HTMLElement) => {
        if (!owned()) return false;
        expected = el;
        el.focus();
        return owned();
      },
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
        if (document.activeElement === original) return true;
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
}
