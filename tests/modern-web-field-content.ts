import type { Page, ElementHandle } from '@playwright/test';
import type { WebFinding } from './modern-web';

// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// Fixed-size fields with standard internal scrolling are the recommended fallback;
// never require field-sizing adoption or infer inaccessible text from overflow:hidden.
// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// Sample real arrow-key editing without submissions or exporting field values.
// Empty-only sampling, retained ownership and compare-and-clear are our safety
// boundaries, not requirements imposed on stores by either guide.
export async function inspectFieldContent(
  page: Page,
  axis: 'vertical' | 'horizontal' = 'vertical',
) {
  const horizontal = axis === 'horizontal';
  const keyName = horizontal ? 'ArrowRight' : 'ArrowDown';
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Field content probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  // Horizontal scope is explicit non-wrapping LTR native textareas only. Do not
  // change wrap/direction to manufacture overflow or guess bidi caret movement.
  // Source: field sizing guide above permits normal internal scrolling; forms
  // calls for keyboard testing. The 80-character/82-key bounds are local policy.
  const sample = horizontal
    ? 'abcdefghij'.repeat(8)
    : Array.from({ length: 12 }, (_, i) => `Probe line ${i + 1}`).join('\n');
  const keyLimit = horizontal ? sample.length + 2 : 14;
  const previousFocus = await page.evaluateHandle(() => document.activeElement);
  const previousScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  let dependent = false;
  const activity = () => {
    dependent = true;
  };
  page.context().on('request', activity);
  page.on('websocket', activity);
  const controls = (await page
    .locator(horizontal ? 'textarea[wrap="off" i]' : 'textarea')
    .elementHandles()) as ElementHandle<HTMLTextAreaElement>[];
  try {
    for (const [index, control] of controls.slice(0, 5).entries()) {
      dependent = false;
      const selector = `${horizontal ? 'textarea[wrap="off" i]' : 'textarea'} >> nth=${index}`;
      const observation: Record<string, unknown> = { selector };
      let touched = false;
      const state = () =>
        control.evaluate(
          (el, { sample, horizontal }) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            let hidden = false;
            for (let parent: Element | null = el; parent; parent = parent.parentElement)
              hidden ||= getComputedStyle(parent).contentVisibility === 'hidden';
            return {
              eligible:
                el.isConnected &&
                // Focus and ancestor visibility are owned in this document;
                // skip shadow scopes instead of mutating before discovering a host.
                el.getRootNode() === document &&
                (!horizontal ||
                  (el.wrap.toLowerCase() === 'off' &&
                    s.direction === 'ltr' &&
                    !s.unicodeBidi.includes('override') &&
                    s.whiteSpace === 'pre')) &&
                !el.matches(':disabled,[readonly],[aria-disabled="true"]') &&
                !el.closest(
                  '[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])',
                ) &&
                !document.querySelector(
                  'dialog[open],[role="dialog"]:not([hidden]),[role="alertdialog"]:not([hidden])',
                ) &&
                !hidden &&
                s.visibility === 'visible' &&
                s.display !== 'none' &&
                s.writingMode === 'horizontal-tb' &&
                r.width > 0 &&
                r.height > 0,
              empty: el.value === '',
              owned: el.value === sample,
              focused: document.activeElement === el,
              maxLength: el.maxLength,
              width: el.clientWidth,
              height: el.clientHeight,
              range: horizontal
                ? Math.max(0, el.scrollWidth - el.clientWidth)
                : Math.max(0, el.scrollHeight - el.clientHeight),
              top: el.scrollTop,
              left: el.scrollLeft,
              paddingRight: parseFloat(s.paddingRight) || 0,
              paddingBottom: parseFloat(s.paddingBottom) || 0,
              caretAtEnd: el.selectionStart === sample.length && el.selectionEnd === sample.length,
              animating: el.getAnimations({ subtree: true }).some(a => a.playState === 'running'),
            };
          },
          { sample, horizontal },
        );
      const keyboard = await control.evaluateHandle((el, keyName) => {
        const evidence = { seen: false, cancelled: false };
        const listen = (event: KeyboardEvent) => {
          if (event.isTrusted && event.target === el && event.key === keyName) {
            evidence.seen = true;
            evidence.cancelled ||= event.defaultPrevented;
          }
        };
        window.addEventListener('keydown', listen);
        return { evidence, dispose: () => window.removeEventListener('keydown', listen) };
      }, keyName);
      try {
        const initial = await state();
        if (
          !initial.eligible ||
          !initial.empty ||
          (initial.maxLength >= 0 && initial.maxLength < sample.length)
        ) {
          Object.assign(observation, {
            status: 'not-probed',
            reason: 'prefilled-excluded-or-length-constrained',
          });
          continue;
        }
        touched = true;
        await control.fill(sample, { timeout: 1500 });
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        let current = await state();
        if (
          !current.eligible ||
          !current.owned ||
          !current.focused ||
          current.animating ||
          dependent
        )
          throw new Error('changed');
        await control.evaluate(el => {
          el.setSelectionRange(0, 0);
          el.scrollTop = 0;
          el.scrollLeft = 0;
        });
        const start = await state();
        for (let key = 0; key < keyLimit; key++) {
          current = await state();
          if (
            !current.eligible ||
            !current.owned ||
            !current.focused ||
            current.animating ||
            dependent
          )
            throw new Error('changed');
          // Do not use locator.press: it would refocus after authored focus theft.
          if (horizontal && current.caretAtEnd) break;
          await page.keyboard.press(keyName);
        }
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        // Native caret scrolling is asynchronous in Firefox/WebKit. Observe a
        // bounded settling window, just as the table scroll probe does. This is
        // a local sampling limit, not INP or a storefront performance budget.
        let end = await state();
        const deadline = Date.now() + 350;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 35));
          end = await state();
          if (!end.eligible || !end.owned || !end.focused || end.animating || dependent) break;
        }
        if (
          !end.eligible ||
          !end.owned ||
          !end.focused ||
          end.animating ||
          dependent ||
          end.width !== start.width ||
          end.height !== start.height ||
          end.range !== start.range
        )
          throw new Error('changed');
        const keys = await keyboard.evaluate(k => k.evidence);
        // Source: https://drafts.csswg.org/cssom-view/#scrolling-area
        // The scrollable area includes bottom padding. Native caret scrolling may
        // expose the text end without exposing trailing blank bottom/right padding
        // (Firefox observed range=50, top=42, padding=8). Compare the text end,
        // not mandatory scrollbar exhaustion; this is not glyph/ancestor visibility.
        const textRange = Math.max(
          0,
          end.range - (horizontal ? end.paddingRight : end.paddingBottom),
        );
        const tailInScrollport =
          textRange <= 2 || (horizontal ? end.left : end.top) >= textRange - 3;
        const reached = end.caretAtEnd && tailInScrollport;
        const blocked = !reached && keys.seen && keys.cancelled;
        Object.assign(observation, {
          status: reached || blocked ? 'observed' : 'unverified',
          reason: reached
            ? 'sample-end-reached'
            : blocked
              ? 'authored-arrow-cancellation'
              : 'native-keyboard-policy-or-layout-unverified',
          axis,
          sampleLines: horizontal ? 1 : 12,
          sampleCharacters: sample.length,
          keyLimit,
          overflow: end.range > 2,
          caretAtEnd: end.caretAtEnd,
          tailInScrollport,
          geometry: horizontal
            ? { range: end.range, left: end.left, paddingRight: end.paddingRight }
            : { range: end.range, top: end.top, paddingBottom: end.paddingBottom },
          keyboard: keys,
        });
        if (blocked)
          findings.push({
            rule: horizontal
              ? 'field-content-horizontal-navigation'
              : 'field-content-arrow-navigation',
            guide: 'form-fields-automatically-fit-contents',
            severity: 'warning',
            selector,
            evidence: { caretAtEnd: end.caretAtEnd, tailInScrollport, keyboard: keys },
            recommendation: `Review cancelled textarea ${keyName} editing: the bounded ${horizontal ? 'non-wrapping' : 'multiline'} sample did not reach its end. Preserve native editing or an equivalent keyboard path; automatic sizing is optional.`,
          });
      } catch {
        Object.assign(observation, {
          status: 'unverified',
          reason: 'control-focus-layout-or-dependency-changed',
        });
      } finally {
        observation.restoration = touched
          ? await control
              .evaluate((el, sample) => {
                if (
                  !el.isConnected ||
                  el.value !== sample ||
                  el.matches(':disabled,[readonly],[aria-disabled="true"]') ||
                  el.closest('[inert],[aria-hidden="true"]')
                )
                  return { status: 'not-restored', reason: 'ownership-changed' };
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
                  el,
                  '',
                );
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                el.scrollTop = 0;
                el.scrollLeft = 0;
                return { status: el.isConnected && el.value === '' ? 'restored' : 'not-restored' };
              }, sample)
              .catch(() => ({ status: 'not-restored', reason: 'control-unavailable' }))
          : { status: 'unchanged' };
        // Restore only while focus still belongs to this retained control. Never
        // override an authored redirection, including one caused by cleanup.
        if (
          touched &&
          (await control.evaluate(el => document.activeElement === el).catch(() => false))
        ) {
          await previousFocus
            .evaluate(el => {
              if (el === document.body && document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
              else if (el instanceof HTMLElement && el.isConnected)
                el.focus({ preventScroll: true });
            })
            .catch(() => {});
          await page.evaluate(
            pos => scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' }),
            previousScroll,
          );
        }
        await keyboard.evaluate(k => k.dispose()).catch(() => {});
        await keyboard.dispose();
        observations.push(observation);
      }
    }
  } finally {
    page.context().off('request', activity);
    page.off('websocket', activity);
    await previousFocus.dispose();
    for (const control of controls) await control.dispose();
  }
  return {
    observations,
    findings,
    limit: 5,
    axis,
    sampleLines: horizontal ? 1 : 12,
    sampleCharacters: sample.length,
    keyLimit,
    successfulSubmissionAttempted: false,
    parentClippingVerified: false,
    applicationResetVerified: false,
  };
}

export async function inspectHorizontalFieldContent(page: Page) {
  return inspectFieldContent(page, 'horizontal');
}
