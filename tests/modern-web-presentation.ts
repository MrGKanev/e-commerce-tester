// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// responsive-design: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/css/responsive-design.md
// typography: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/typography.md
// color: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/color.md
// Use reversible viewport/preference/text stress on the isolated page.
// This is not real OS text scaling, field metrics or complete theme/AT certification.
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { WebFinding } from './modern-web';
import { safeAuditUrl } from './modern-web';

/** Stress rendered content; restore viewport, preferences and injected styles even on failure. */
export async function inspectPresentation(page: Page) {
  const originalViewport = page.viewportSize();
  const original = await page.evaluate(() => ({
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    forced: matchMedia('(forced-colors: active)').matches,
  }));
  const findings: WebFinding[] = [];
  const states: Array<Record<string, unknown>> = [];
  const geometry = () =>
    page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility === 'visible';
      };
      const clipped = [
        ...document.querySelectorAll('h1,h2,h3,p,label,button,input,select,textarea'),
      ]
        .filter(visible)
        .filter(el => {
          const s = getComputedStyle(el);
          return (
            (['hidden', 'clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 3) ||
            (['hidden', 'clip'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 3)
          );
        })
        .map(el =>
          el.id
            ? '#' + CSS.escape(el.id)
            : el.localName +
              ':nth-of-type(' +
              ([...el.parentElement!.children]
                .filter(peer => peer.localName === el.localName)
                .indexOf(el) +
                1) +
              ')',
        );
      // Source: form-factor-adaptation forbids clipping controls on parents.
      // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
      // Intersect border boxes with simple overflow:hidden/clip ancestors.
      // Scrollable containers, transforms, positioned escape paths,
      // clip margins and glyph visibility need a different model; leave unknown.
      const ancestorClipped: string[] = [];
      const ancestorPartiallyClipped: Array<Record<string, number | string>> = [];
      const fieldSizing: Array<Record<string, number | string | boolean | null>> = [];
      const zeroSizeControls: string[] = [],
        overflowingFields: string[] = [];
      const controls = [
        ...document.querySelectorAll('input:not([type="hidden"]),select,textarea,button'),
      ];
      for (const [index, el] of controls.slice(0, 100).entries()) {
        const style = getComputedStyle(el);
        if (style.visibility !== 'visible' || el.closest('[hidden],[inert],[aria-hidden="true"]'))
          continue;
        const lineage: Element[] = [];
        let parent: Element | null = el;
        while (parent && lineage.length < 33) {
          lineage.push(parent);
          parent = parent.parentElement;
        }
        if (
          parent ||
          lineage.some(node => {
            const s = getComputedStyle(node);
            return (
              s.display === 'none' ||
              s.transform !== 'none' ||
              (s.translate && s.translate !== 'none') ||
              (s.rotate && s.rotate !== 'none') ||
              (s.scale && s.scale !== 'none') ||
              (s.zoom && !['1', 'normal'].includes(s.zoom)) ||
              s.perspective !== 'none' ||
              s.clipPath !== 'none' ||
              ['absolute', 'fixed'].includes(s.position) ||
              ['hidden', 'auto'].includes(s.contentVisibility) ||
              s.opacity === '0'
            );
          })
        )
          continue;
        const selector = `:is(input:not([type="hidden"]),select,textarea,button) >> nth=${index}`;
        const r = el.getBoundingClientRect();
        // Sources: field-sizing guide accepts fixed fields/internal scrolling;
        // form-factor-adaptation requires usable boxes at narrow widths.
        // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
        // Never require field-sizing, guess native option text width or open an
        // OS picker. Record input/select/textarea geometry under the same stress.
        if (
          el.localName === 'select' ||
          el.localName === 'textarea' ||
          (el instanceof HTMLInputElement &&
            ['text', 'search', 'tel', 'url', 'email', 'password'].includes(el.type))
        ) {
          const px = (value: string) => (value.endsWith('px') ? parseFloat(value) : null);
          const localScroll = lineage
            .slice(1)
            .some(
              node =>
                node !== document.body &&
                node !== document.documentElement &&
                ['auto', 'scroll'].includes(getComputedStyle(node).overflowX),
            );
          const pageOverflow =
            !localScroll &&
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 5 &&
            (r.left < -1 || r.right > document.documentElement.clientWidth + 1);
          fieldSizing.push({
            selector,
            kind: el.localName,
            width: r.width,
            height: r.height,
            minInlinePx: px(style.minInlineSize),
            maxInlinePx: px(style.maxInlineSize),
            contentSizingObserved: style.getPropertyValue('field-sizing') === 'content',
            pageOverflow,
            zeroBox: r.width === 0 || r.height === 0,
          });
          if (!el.matches(':disabled,[readonly]')) {
            if (r.width === 0 || r.height === 0) zeroSizeControls.push(selector);
            else if (pageOverflow) overflowingFields.push(selector);
          }
        }
        if (!visible(el)) continue;
        let left = r.left,
          right = r.right,
          top = r.top,
          bottom = r.bottom,
          clipped = false;
        for (const node of lineage.slice(1)) {
          if (node === document.body || node === document.documentElement) continue;
          const s = getComputedStyle(node);
          if (
            ![
              'block',
              'flow-root',
              'flex',
              'grid',
              'inline-block',
              'inline-flex',
              'inline-grid',
            ].includes(s.display) ||
            (s.overflowClipMargin && s.overflowClipMargin !== '0px')
          )
            continue;
          const box = node.getBoundingClientRect();
          if (['hidden', 'clip'].includes(s.overflowX)) {
            clipped = true;
            left = Math.max(left, box.left + node.clientLeft);
            right = Math.min(right, box.left + node.clientLeft + node.clientWidth);
          }
          if (['hidden', 'clip'].includes(s.overflowY)) {
            clipped = true;
            top = Math.max(top, box.top + node.clientTop);
            bottom = Math.min(bottom, box.top + node.clientTop + node.clientHeight);
          }
        }
        const visibleWidth = Math.max(0, right - left),
          visibleHeight = Math.max(0, bottom - top);
        if (clipped && (visibleWidth === 0 || visibleHeight === 0)) ancestorClipped.push(selector);
        else if (clipped && (r.width - visibleWidth > 1 || r.height - visibleHeight > 1))
          ancestorPartiallyClipped.push({
            selector,
            width: r.width,
            height: r.height,
            visibleWidth,
            visibleHeight,
          });
      }
      const targets = [
        ...document.querySelectorAll(
          'main h1, main button[type="submit"], main [name="add"], main [data-add-to-cart]',
        ),
      ]
        .filter(visible)
        .slice(0, 5);
      const occluded = targets
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth)
            return false;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit && hit !== el && !el.contains(hit) && !hit.contains(el);
        })
        .map(el => (el.id ? '#' + CSS.escape(el.id) : el.localName));
      return {
        width: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 5,
        clipped: [...new Set(clipped)],
        ancestorClipped,
        ancestorPartiallyClipped,
        fieldSizing,
        zeroSizeControls,
        overflowingFields,
        fieldSizingSupported: CSS.supports('field-sizing', 'content'),
        nativeSelectTextAndPickerVerified: false,
        partialBorderBoxSubsetObserved: ancestorPartiallyClipped.length > 0,
        fieldSizingLimit: 100,
        ancestorControlLimit: 100,
        ancestorDepthLimit: 32,
        ancestorSampleLimited: controls.length > 100,
        partialControlAndGlyphClippingVerified: false,
        occluded,
      };
    });
  const add = (
    rule: string,
    guide: string,
    selector: string,
    evidence: Record<string, unknown>,
    recommendation: string,
  ) => findings.push({ rule, guide, severity: 'warning', selector, evidence, recommendation });
  try {
    for (const size of [
      { width: 320, height: 800 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      const state = await geometry();
      states.push({ name: 'viewport', requested: size, ...state });
      if (state.overflow)
        add(
          'presentation-reflow',
          'responsive-design',
          'document',
          { requested: size, observedWidth: state.width },
          'Remove page-level horizontal scrolling at narrow/landscape sizes, allowing necessary two-dimensional regions.',
        );
      for (const selector of state.ancestorClipped)
        add(
          'presentation-control-ancestor-clip',
          'form-factor-adaptation',
          selector,
          { requested: size, wholeBorderBoxOutsideClip: true },
          'Keep controls inside the visible area of their clipping ancestors; this bounded geometry sample does not verify glyphs or partial clipping.',
        );
      for (const clipping of state.ancestorPartiallyClipped)
        add(
          'presentation-control-partial-ancestor-clip',
          'form-factor-adaptation',
          String(clipping.selector),
          { requested: size, ...clipping, glyphVisibilityVerified: false },
          'Review a native control border box partially cut by simple non-scrollable clipping ancestors. This numeric rectangle sample does not verify text glyphs, transformed clips or native picker UI.',
        );
      for (const selector of state.zeroSizeControls)
        add(
          'field-sizing-zero-box',
          'form-fields-automatically-fit-contents',
          selector,
          { requested: size },
          'Keep exposed native fields usable when empty; the sampled border box has zero width or height. Fixed sizing is a valid fallback.',
        );
      for (const selector of state.overflowingFields)
        add(
          'field-sizing-page-overflow',
          'form-fields-automatically-fit-contents',
          selector,
          { requested: size },
          'Review this field outside the viewport during observed page-level horizontal overflow; constrain its layout without requiring field-sizing adoption.',
        );
      for (const selector of state.occluded)
        add(
          'presentation-occlusion',
          'content-first-noise-reduction',
          selector,
          { requested: size },
          'Review fixed overlays covering primary content or actions at this viewport.',
        );
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
    const baseline = await geometry();
    // User-style stress probes target third-party pages; Tailwind cannot express these global accessibility overrides there.
    for (const [name, content] of [
      [
        'text-spacing',
        '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-block-end:2em!important}',
      ],
      ['root-font-resize', 'html{font-size:200%!important}'],
    ]) {
      let style;
      try {
        style = await page.addStyleTag({ content });
      } catch {
        states.push({ name, supported: false, reason: 'style-injection-blocked' });
        continue;
      }
      try {
        const state = await geometry();
        states.push({ name, ...state });
        const newlyClipped = state.clipped.filter(selector => !baseline.clipped.includes(selector));
        if ((!baseline.overflow && state.overflow) || newlyClipped.length)
          add(
            'presentation-text-resilience',
            'typography',
            'document',
            { probe: name, newOverflow: !baseline.overflow && state.overflow, newlyClipped },
            'Keep text and controls reachable under user spacing/font overrides; inspect newly clipped elements.',
          );
      } finally {
        await style.evaluate(el => el.parentNode?.removeChild(el));
      }
    }
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, forcedColors: 'none' });
      const result = await new AxeBuilder({ page })
        .withRules(['color-contrast', 'button-name', 'link-name'])
        .exclude('iframe')
        .analyze();
      states.push({
        name: 'color-scheme',
        colorScheme,
        incomplete: result.incomplete.map(item => item.id),
        violations: result.violations.length,
      });
      for (const violation of result.violations)
        add(
          'presentation-' + violation.id,
          violation.id === 'color-contrast' ? 'color' : 'icons',
          'rendered document',
          { colorScheme, rule: violation.id, targets: violation.nodes.map(node => node.target) },
          violation.help + '; verify backgrounds and the actual accessible name in this state.',
        );
    }
    try {
      await page.emulateMedia({ forcedColors: 'active' });
      const active = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
      const state = active ? await geometry() : null;
      states.push({ name: 'forced-colors', supported: active, ...state });
      if (state?.occluded.length)
        add(
          'presentation-forced-colors',
          'color',
          'document',
          { occluded: state.occluded },
          'Keep primary content and controls visible in forced colors.',
        );
    } catch {
      states.push({ name: 'forced-colors', supported: false });
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
    await page.emulateMedia({
      colorScheme: original.dark ? 'dark' : 'light',
      forcedColors: original.forced ? 'active' : 'none',
    });
  }
  return {
    schemaVersion: 1,
    url: safeAuditUrl(page.url()),
    coverage: { states, contrastIsAutomatedSample: true, osTextScaleNotEmulated: true },
    findings,
  };
}
