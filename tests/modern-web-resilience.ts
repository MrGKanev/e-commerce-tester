import type { Page } from '@playwright/test';
import type { WebFinding } from './modern-web';
import { safeAuditUrl } from './modern-web';

/** Passive main-document samples: no scroll, focus, media playback, DOM writes or extra fetches. */
export async function inspectResilience(page: Page) {
  const report = await page.evaluate(() => {
    const findings: WebFinding[] = [];
    const limit = 50;
    const selector = (el: Element): string => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parent = el.parentElement;
      if (!parent) return el.localName;
      const peers = [...parent.children].filter(peer => peer.localName === el.localName);
      return `${selector(parent)} > ${el.localName}:nth-of-type(${peers.indexOf(el) + 1})`;
    };
    const rendered = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility === 'visible' &&
        s.display !== 'none' &&
        !el.closest('[hidden], [inert]')
      );
    };
    const add = (
      rule: string,
      guide: string,
      el: Element,
      evidence: Record<string, unknown>,
      recommendation: string,
    ) =>
      findings.push({
        rule,
        guide,
        selector: selector(el),
        severity: 'warning',
        evidence,
        recommendation,
      });
    const named = (el: Element) =>
      Boolean(
        el.getAttribute('aria-label')?.trim() ||
        (el.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .some(id => document.getElementById(id)?.textContent?.trim()),
      );
    const described = (el: Element) =>
      (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .some(id => document.getElementById(id)?.textContent?.trim());
    const timingSupported = typeof performance.getEntriesByName === 'function';
    const observed = (url: string) =>
      Boolean(
        url &&
        timingSupported &&
        performance.getEntriesByName(url, 'resource').some(entry => entry.duration >= 0),
      );
    const allMedia = [...document.querySelectorAll<HTMLMediaElement>('video,audio')];
    const media = allMedia.slice(0, limit).map(el => {
      const r = el.getBoundingClientRect();
      const visibleBox = rendered(el);
      const inViewport =
        visibleBox && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      // Current geometry is not historical visibility. Keep that distinction in evidence.
      const farBelowViewport = visibleBox && r.top > innerHeight * 2;
      const sourceUrls = [
        el.currentSrc,
        el.getAttribute('src'),
        ...[...el.querySelectorAll('source[src]')].map(source => source.getAttribute('src')),
      ]
        .filter((url): url is string => Boolean(url))
        .flatMap(raw => {
          try {
            return [new URL(raw, document.baseURI).href];
          } catch {
            return [];
          }
        });
      const sourceRequestObserved = sourceUrls.some(observed);
      const poster = el instanceof HTMLVideoElement ? el.poster : '';
      const posterRequestObserved = observed(poster);
      const loading =
        el.getAttribute('loading')?.toLowerCase() === 'lazy' ? 'lazy' : 'eager-or-unspecified';
      const state = {
        selector: selector(el),
        kind: el.localName,
        visibleBox,
        inViewport,
        farBelowViewport,
        geometryIsCurrentNotHistorical: true,
        loading,
        preload: el.preload,
        autoplay: el.autoplay,
        controls: el.controls,
        sourcePresent: sourceUrls.length > 0,
        sourceRequestObserved,
        posterPresent: Boolean(poster),
        posterRequestObserved,
        nativeLazySupported: Object.hasOwn(HTMLMediaElement.prototype, 'loading'),
        timingEvidence: timingSupported ? 'resource-buffer-sample' : 'unsupported',
        absentTimingDoesNotProveDeferral: true,
      };
      if (farBelowViewport && !el.autoplay && (sourceRequestObserved || posterRequestObserved))
        add(
          'media-offscreen-request',
          'lazy-load-video-and-audio',
          el,
          state,
          'Review observed requests for currently offscreen non-autoplay media; defer non-critical data/posters where appropriate. Prior visibility, browser proximity thresholds and resource reuse are not known.',
        );
      if (inViewport && loading === 'lazy' && (sourceUrls.length > 0 || poster))
        add(
          'media-viewport-lazy',
          'lazy-load-video-and-audio',
          el,
          state,
          'Verify whether this visible media/poster is critical or an LCP candidate before delaying its load.',
        );
      if (
        el instanceof HTMLAudioElement &&
        loading === 'lazy' &&
        !el.controls &&
        !visibleBox &&
        state.nativeLazySupported
      )
        add(
          'media-lazy-audio-no-box',
          'lazy-load-video-and-audio',
          el,
          state,
          'Verify that lazy audio has a viewport-intersecting player or a working custom load/play fallback.',
        );
      return state;
    });
    const allCanvases = [...document.querySelectorAll('canvas')].filter(rendered);
    const canvases = allCanvases.slice(0, limit).map(el => {
      const decorative =
        el.closest('[aria-hidden="true"]') !== null ||
        ['none', 'presentation'].includes(el.getAttribute('role') || '');
      const state = {
        selector: selector(el),
        decorative,
        named: named(el),
        described: described(el),
        fallbackTextPresent: Boolean(el.textContent?.trim()),
        equivalentContentVerified: false,
      };
      if (!decorative && !state.named && !state.described && !state.fallbackTextPresent)
        add(
          'canvas-alternative-unverified',
          'accessibility',
          el,
          state,
          'Determine whether this canvas is meaningful; provide an equivalent text/data representation or explicitly hide decorative rendering. A name alone does not establish equivalence.',
        );
      return state;
    });
    const allScrollers = [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
      if (!rendered(el)) return false;
      const s = getComputedStyle(el);
      return (
        (['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 3) ||
        (['auto', 'scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 3)
      );
    });
    const authoredScrollbarHiding = (el: HTMLElement) => {
      if (el.style.getPropertyValue('scrollbar-width').trim() === 'none') return true;
      const matchesRules = (rules: CSSRuleList): boolean =>
        [...rules].some(rule => {
          if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) return false;
          if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) return false;
          if (rule instanceof CSSStyleRule) {
            try {
              if (
                rule.style.getPropertyValue('scrollbar-width').trim() === 'none' &&
                el.matches(rule.selectorText)
              )
                return true;
            } catch {
              /* Unsupported selectors are not evidence. */
            }
          }
          return 'cssRules' in rule ? matchesRules((rule as CSSGroupingRule).cssRules) : false;
        });
      return [...document.styleSheets].some(sheet => {
        if (sheet.disabled || (sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches))
          return false;
        try {
          return matchesRules(sheet.cssRules);
        } catch {
          return false;
        }
      });
    };
    const scrollers = allScrollers.slice(0, limit).map(el => {
      const s = getComputedStyle(el);
      const pseudoCue = ['::before', '::after'].some(pseudo => {
        const p = getComputedStyle(el, pseudo);
        return (
          p.content !== 'none' &&
          p.display !== 'none' &&
          Number(p.opacity) > 0 &&
          (p.backgroundImage !== 'none' || p.boxShadow !== 'none')
        );
      });
      // Inspect standardized authored hiding only. Unsupported legacy pseudo styles can
      // serialize as zero/none even for ordinary scrollbars (not evidence of author intent).
      const state = {
        selector: selector(el),
        horizontal: el.scrollWidth > el.clientWidth + 3,
        vertical: el.scrollHeight > el.clientHeight + 3,
        scrollbarExplicitlyHidden: s.scrollbarWidth === 'none' && authoredScrollbarHiding(el),
        computedScrollbarWidthNone: s.scrollbarWidth === 'none',
        inaccessibleStylesheetsNotInspected: true,
        authoredTabStop: el.tabIndex >= 0,
        named: named(el),
        descriptionPresent: described(el),
        maskPresent: s.maskImage !== 'none',
        backgroundCueCandidate: s.backgroundImage !== 'none',
        pseudoCueCandidate: pseudoCue,
        hintContrastVerified: false,
        keyboardScrollVerified: false,
      };
      if (state.scrollbarExplicitlyHidden)
        add(
          'scroller-hidden-scrollbar',
          'scrollability-affordance-hints',
          el,
          state,
          'Verify a discoverable alternative scrolling cue, its contrast and keyboard/touch operation when deliberately hiding scrollbars. Shadows and fades are optional when a usable scrollbar remains.',
        );
      return state;
    });
    const allSingleLines = [
      ...document.querySelectorAll<HTMLElement>('a,button,span,p,li,td,th,h1,h2,h3,label'),
    ].filter(el => {
      if (!rendered(el) || !el.textContent?.trim()) return false;
      const s = getComputedStyle(el);
      return (
        ['nowrap', 'pre'].includes(s.whiteSpace) &&
        ['hidden', 'clip'].includes(s.overflowX) &&
        el.scrollWidth > el.clientWidth + 3
      );
    });
    const singleLines = allSingleLines.slice(0, limit).map(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const label = el.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim();
      const state = {
        selector: selector(el),
        domTextLength: text.length,
        titlePresent: Boolean(el.title.trim()),
        descriptionPresent: described(el),
        explicitLabelPresent: Boolean(label),
        fullTextRouteVerified: false,
      };
      if (state.titlePresent && !state.descriptionPresent)
        add(
          'single-line-title-disclosure',
          'single-line-overflow',
          el,
          state,
          'Verify a keyboard and touch route to the full truncated text; a title tooltip alone is unavailable to those users. Full DOM text remains separate from visual disclosure.',
        );
      if (
        el.matches('a[href],button') &&
        label &&
        !label.toLowerCase().includes(text.toLowerCase())
      )
        add(
          'single-line-name-mismatch',
          'single-line-overflow',
          el,
          state,
          'Keep the full visible label in the accessible name when visually truncating text.',
        );
      return state;
    });
    const allGenerated = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(rendered)
      .flatMap(el =>
        ['::before', '::after'].flatMap(pseudo => {
          const style = getComputedStyle(el, pseudo);
          if (
            style.content === 'none' ||
            style.content === 'normal' ||
            style.display === 'none' ||
            style.visibility !== 'visible'
          )
            return [];
          const content = style.content;
          const match = /\/\s*["']([^"']*)["']\s*$/.exec(content);
          const alt = match?.[1]?.replace(/\s+/g, ' ').trim() || '';
          const domText = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const image = /url\(/i.test(content);
          // Inspect declarations without exporting CSS URLs, generated strings or customer text.
          return [
            {
              el,
              pseudo,
              image,
              hasAlt: Boolean(match),
              alt,
              domText,
              textual: !image && /^\s*["'][^"']+['"]/.test(content),
            },
          ];
        }),
      );
    const generated = allGenerated.slice(0, limit).map(item => {
      const { el, alt, domText } = item;
      const state = {
        selector: selector(el),
        pseudo: item.pseudo,
        image: item.image,
        alternativeSyntaxPresent: item.hasAlt,
        nonEmptyAlternative: Boolean(alt),
        domTextPresent: Boolean(domText),
        explicitNamePresent: named(el),
        duplicateAlternative: Boolean(alt && domText.toLowerCase().includes(alt.toLowerCase())),
      };
      if (state.duplicateAlternative)
        add(
          'generated-content-duplicate-alt',
          'accessible-generated-content',
          el,
          state,
          'Remove generated alternative text that repeats existing DOM text; decorative additions should not duplicate the label.',
        );
      if (
        el.matches('button,a[href],[role="button"],[role="link"]') &&
        !domText &&
        !state.explicitNamePresent &&
        item.textual &&
        !(item.hasAlt && !alt)
      )
        add(
          'generated-content-only-label',
          'accessible-generated-content',
          el,
          state,
          'Keep meaningful action labels in DOM text or an explicit accessible name; generated content alone is not a reliable label across browser features.',
        );
      return state;
    });
    return {
      schemaVersion: 1,
      coverage: {
        sampleLimit: limit,
        timingSupported,
        media: allMedia.length,
        canvases: allCanvases.length,
        scrollers: allScrollers.length,
        singleLines: allSingleLines.length,
        generated: allGenerated.length,
        sampled: {
          media: media.length,
          canvases: canvases.length,
          scrollers: scrollers.length,
          singleLines: singleLines.length,
          generated: generated.length,
        },
        scope: 'current-main-document-light-dom',
        passive: true,
      },
      observations: { media, canvases, scrollers, singleLines, generated },
      findings,
    };
  });
  return { ...report, url: safeAuditUrl(page.url()) };
}
