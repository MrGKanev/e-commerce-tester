import type { Page, ElementHandle } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

type Point = { x: number; y: number };

/** Exercise wheel containment only for a modal already opened by the page. Never opens/closes UI. */
export async function inspectDialogScroll(page: Page, restorePointer?: Point) {
  if (
    !(await page.evaluate(
      () => (window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe,
    ))
  )
    throw new Error('Dialog scroll probes require prepareInteractionProbe(...).freeze() first');
  const findings: WebFinding[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const initial = await page.evaluate(() => ({
    x: scrollX,
    y: scrollY,
    width: innerWidth,
    height: innerHeight,
  }));
  const supported = await page.evaluate(() => CSS.supports('selector(dialog:modal)'));
  if (!supported)
    return {
      schemaVersion: 1,
      url: safeAuditUrl(page.url()),
      coverage: {
        applicable: false,
        status: 'unverified',
        reason: 'modal-selector-unsupported',
        observations,
        wheelOnly: true,
      },
      findings,
    };
  const modals = (await page
    .locator('dialog:modal')
    .elementHandles()) as ElementHandle<HTMLDialogElement>[];
  // DOM order is not top-layer opening order. Do not attribute wheel behavior to a guessed modal.
  if (modals.length > 1)
    return {
      schemaVersion: 1,
      url: safeAuditUrl(page.url()),
      coverage: {
        applicable: false,
        status: 'unverified',
        reason: 'stacked-native-modals',
        stackedModalCount: modals.length,
        observations,
        wheelOnly: true,
      },
      findings,
    };
  const modal = modals.at(-1);
  if (!modal)
    return {
      schemaVersion: 1,
      url: safeAuditUrl(page.url()),
      coverage: {
        applicable: false,
        status: 'not-observed',
        reason: 'no-open-native-modal',
        observations,
        wheelOnly: true,
      },
      findings,
    };
  const before = await modal.evaluate(el => ({
    selector: el.id ? '#' + CSS.escape(el.id) : 'dialog:modal',
    x: el.scrollLeft,
    y: el.scrollTop,
  }));
  const root = await page.evaluate(() => {
    const scrolling = document.scrollingElement || document.documentElement;
    return {
      maxX: scrolling.scrollWidth - scrolling.clientWidth,
      maxY: scrolling.scrollHeight - scrolling.clientHeight,
      overflow: getComputedStyle(document.documentElement).overflowY,
      bodyOverflow: document.body ? getComputedStyle(document.body).overflowY : null,
    };
  });
  try {
    if (root.maxY <= 2) {
      observations.push({
        status: 'unverified',
        reason: 'background-has-no-vertical-scroll-range',
      });
    } else {
      const deltaY = initial.y >= root.maxY - 2 ? -400 : 400;
      const targets = await modal.evaluate(el => {
        const r = el.getBoundingClientRect();
        const backdrop = [
          { x: 2, y: 2 },
          { x: innerWidth - 3, y: 2 },
          { x: 2, y: innerHeight - 3 },
          { x: innerWidth - 3, y: innerHeight - 3 },
        ].find(
          point => point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom,
        );
        const candidates = [
          { x: r.left + Math.min(12, r.width / 2), y: r.top + Math.min(12, r.height / 2) },
          { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          { x: r.right - Math.min(12, r.width / 2), y: r.bottom - Math.min(12, r.height / 2) },
        ];
        const content = candidates.find(point => {
          const hit = document.elementFromPoint(point.x, point.y);
          return (
            point.x >= 0 &&
            point.x < innerWidth &&
            point.y >= 0 &&
            point.y < innerHeight &&
            hit &&
            (hit === el || el.contains(hit)) &&
            !hit.closest(
              'a[href],button,input,select,textarea,[contenteditable="true"],[role="slider"],[role="spinbutton"]',
            )
          );
        });
        return {
          backdrop,
          content,
          maxY: el.scrollHeight - el.clientHeight,
          overscroll: getComputedStyle(el).overscrollBehaviorY,
          backdropOverflow: getComputedStyle(el, '::backdrop').overflowY,
          backdropOverscroll: getComputedStyle(el, '::backdrop').overscrollBehaviorY,
        };
      });
      for (const kind of ['backdrop', 'content-boundary'] as const) {
        const point = kind === 'backdrop' ? targets.backdrop : targets.content;
        if (!point) {
          observations.push({
            kind,
            status: 'unverified',
            reason:
              kind === 'backdrop' ? 'no-exposed-backdrop-space' : 'no-noninteractive-content-point',
          });
          continue;
        }
        if (!(await modal.evaluate(el => el.isConnected && el.matches(':modal')))) {
          observations.push({ kind, status: 'unverified', reason: 'modal-changed' });
          break;
        }
        await page.evaluate(
          position => scrollTo({ left: position.x, top: position.y, behavior: 'instant' }),
          initial,
        );
        await modal.evaluate((el, delta) => {
          el.scrollTop = delta > 0 ? el.scrollHeight : 0;
        }, deltaY);
        const start = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        await page.mouse.move(point.x, point.y);
        await page.mouse.wheel(0, deltaY);
        // Wheel events return before compositor scrolling settles; observe a bounded sample window.
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              setTimeout(
                () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                180,
              ),
            ),
        );
        const end = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        const leaked = Math.abs(end.y - start.y) > 2 || Math.abs(end.x - start.x) > 2;
        observations.push({
          kind,
          status: 'observed',
          start,
          end,
          backgroundMoved: leaked,
          deltaY,
          modalScrollable: targets.maxY > 2,
        });
        if (leaked)
          findings.push({
            rule: 'dialog-background-scroll',
            guide: 'prevent-page-scroll-under-modal-dialog',
            severity: 'warning',
            selector: before.selector,
            evidence: {
              kind,
              start,
              end,
              modalScrollable: targets.maxY > 2,
              modalOverscroll: targets.overscroll,
              backdropOverflow: targets.backdropOverflow,
              backdropOverscroll: targets.backdropOverscroll,
              nonScrollableContainmentSupportUnverified: true,
            },
            recommendation:
              'Review background wheel scroll while a native modal is open. Contain dialog/backdrop scroll chaining; non-scrollable-container support varies by engine, so verify a compatible fallback without treating CSS syntax support as behavior proof.',
          });
      }
    }
  } catch (error) {
    const unsupported =
      error instanceof Error && /not supported|not implemented/i.test(error.message);
    observations.push({
      status: 'unverified',
      reason: unsupported ? 'wheel-operation-unsupported' : 'modal-changed-or-probe-error',
    });
  } finally {
    await modal
      .evaluate((el, position) => {
        el.scrollLeft = position.x;
        el.scrollTop = position.y;
      }, before)
      .catch(() => {});
    await page
      .evaluate(
        position => scrollTo({ left: position.x, top: position.y, behavior: 'instant' }),
        initial,
      )
      .catch(() => {});
    await page.mouse.move(restorePointer?.x ?? 0, restorePointer?.y ?? 0).catch(() => {});
  }
  const restored = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: {
      applicable: true,
      status: observations.some(item => item.status === 'observed') ? 'observed' : 'unverified',
      observations,
      initial,
      restored,
      stackedModalCount: modals.length,
      perPageModalLimit: 1,
      backgroundScrollRange: root,
      wheelOnly: true,
      touchOrKeyboardEmulated: false,
      pointerRestoration: restorePointer
        ? 'caller-supplied-origin'
        : 'origin-unavailable-parked-at-viewport-corner',
      cssSyntaxDoesNotEstablishBehaviorSupport: true,
    },
    findings,
  };
}
