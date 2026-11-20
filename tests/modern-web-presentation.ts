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
      // Only report a whole border box outside a simple overflow:hidden/clip
      // ancestor. Scrollable containers, transforms, positioned escape paths,
      // clip margins and glyph visibility need a different model; leave unknown.
      const ancestorClipped: string[] = [];
      const controls = [
        ...document.querySelectorAll('input:not([type="hidden"]),select,textarea,button'),
      ];
      for (const [index, el] of controls.slice(0, 100).entries()) {
        if (!visible(el) || el.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
        const lineage: Element[] = [];
        let parent: Element | null = el;
        while (parent && lineage.length < 33) {
          lineage.push(parent);
          parent = parent.parentElement;
        }
        if (
          parent ||
          lineage.some(node => {
            const style = getComputedStyle(node);
            return (
              style.transform !== 'none' ||
              (style.translate && style.translate !== 'none') ||
              (style.rotate && style.rotate !== 'none') ||
              (style.scale && style.scale !== 'none') ||
              (style.zoom && !['1', 'normal'].includes(style.zoom)) ||
              style.perspective !== 'none' ||
              style.clipPath !== 'none' ||
              ['absolute', 'fixed'].includes(style.position) ||
              style.contentVisibility === 'hidden'
            );
          })
        )
          continue;
        const r = el.getBoundingClientRect();
        if (
          lineage.slice(1).some(node => {
            if (node === document.body || node === document.documentElement) return false;
            const style = getComputedStyle(node);
            if (style.overflowClipMargin && style.overflowClipMargin !== '0px') return false;
            const box = node.getBoundingClientRect();
            const left = box.left + node.clientLeft,
              top = box.top + node.clientTop;
            return (
              (['hidden', 'clip'].includes(style.overflowX) &&
                (r.right < left - 1 || r.left > left + node.clientWidth + 1)) ||
              (['hidden', 'clip'].includes(style.overflowY) &&
                (r.bottom < top - 1 || r.top > top + node.clientHeight + 1))
            );
          })
        )
          ancestorClipped.push(
            `:is(input:not([type="hidden"]),select,textarea,button) >> nth=${index}`,
          );
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
