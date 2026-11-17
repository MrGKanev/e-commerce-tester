import type { Page, TestInfo } from '@playwright/test';

// Executable rules are reviewed locally; upstream skills are never executed by store runs.
export const MODERN_WEB_RULES = {
  'image-lazy-high': [
    'optimize-image-priority',
    'warning',
    'Remove lazy loading from a critical image, or remove its high priority.',
  ],
  'image-viewport-lazy': [
    'optimize-image-priority',
    'warning',
    'Verify the largest visible image is an LCP candidate; if so, load it eagerly.',
  ],
  'image-high-overuse': [
    'optimize-image-priority',
    'warning',
    'Reserve high priority for at most one or two critical images.',
  ],
  'form-description-reference': [
    'forms',
    'error',
    'Point each description/error reference at an existing element with the matching ID.',
  ],
  'form-invalid-feedback': [
    'forms',
    'warning',
    'Associate a useful error message with the invalid field using aria-describedby or aria-errormessage.',
  ],
  'form-password-get': [
    'forms',
    'warning',
    'Use POST for password forms and verify the actual submission does not expose credentials in the URL.',
  ],
  'form-password-autofill': [
    'forms',
    'warning',
    'Set autocomplete to current-password or new-password as appropriate.',
  ],
  'video-captions': [
    'accessibility',
    'warning',
    'If this video contains meaningful audio, provide synchronized captions or verify an equivalent accessible player.',
  ],
  'motion-reduced-unchanged': [
    'motion',
    'warning',
    'Reduce or stop persistent spatial motion, or verify it is essential and has a keyboard-accessible pause control.',
  ],
} as const;
type Rule = keyof typeof MODERN_WEB_RULES;
type Observation = { rule: Rule; selector: string; evidence: Record<string, unknown> };
export type ModernWebReport = Awaited<ReturnType<typeof inspectModernWeb>>;

/** Inspect the current document without filling fields, submitting forms or scrolling. */
export async function inspectModernWeb(page: Page) {
  const snapshot = await page.evaluate(() => {
    const findings: Observation[] = [];
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility === 'visible' &&
        style.display !== 'none'
      );
    };
    const selector = (el: Element): string => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parent = el.parentElement;
      if (!parent) return el.localName;
      const peers = [...parent.children].filter(child => child.localName === el.localName);
      return `${selector(parent)} > ${el.localName}:nth-of-type(${peers.indexOf(el) + 1})`;
    };
    const add = (rule: Rule, el: Element, evidence: Record<string, unknown>) =>
      findings.push({ rule, selector: selector(el), evidence });
    const images = [...document.images].filter(visible);
    for (const image of images)
      if (image.loading === 'lazy' && image.getAttribute('fetchpriority') === 'high')
        add('image-lazy-high', image, { loading: 'lazy', fetchpriority: 'high' });
    const viewportImages = images
      .filter(image => {
        const rect = image.getBoundingClientRect();
        return (
          rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0
        );
      })
      .sort((a, b) => {
        const area = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width * r.height;
        };
        return area(b) - area(a);
      });
    const candidate = viewportImages[0];
    if (candidate?.loading === 'lazy') {
      const rect = candidate.getBoundingClientRect();
      add('image-viewport-lazy', candidate, {
        heuristic: 'largest visible image, not measured LCP',
        width: rect.width,
        height: rect.height,
      });
    }
    const high = [...document.images].filter(
      image => image.getAttribute('fetchpriority') === 'high',
    );
    if (high.length > 2) add('image-high-overuse', high[0], { highPriorityImages: high.length });

    const controls = [
      ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ].filter(el => !el.disabled && visible(el));
    for (const control of controls) {
      const references = [
        'aria-describedby',
        ...(control.getAttribute('aria-invalid') === 'true' ? ['aria-errormessage'] : []),
      ].flatMap(attribute =>
        (control.getAttribute(attribute) || '')
          .split(/\s+/)
          .filter(Boolean)
          .map(id => ({ attribute, id })),
      );
      const missing = references.filter(ref => !document.getElementById(ref.id));
      if (missing.length) add('form-description-reference', control, { missing });
      if (
        control.getAttribute('aria-invalid') === 'true' &&
        !references.some(ref => document.getElementById(ref.id)?.textContent?.trim())
      )
        add('form-invalid-feedback', control, { ariaInvalid: true, linkedErrorText: false });
      if (control instanceof HTMLInputElement && control.type === 'password') {
        if (control.form?.method === 'get')
          add('form-password-get', control, { method: 'get', submissionNotAttempted: true });
        // Firefox's IDL property can omit authored section-prefixed password hints.
        const autocomplete = (control.getAttribute('autocomplete') || '').trim().toLowerCase();
        if (
          !autocomplete
            .split(/\s+/)
            .some(token => ['current-password', 'new-password'].includes(token))
        )
          add('form-password-autofill', control, { autocomplete });
      }
    }
    const videos = [...document.querySelectorAll('video')].filter(
      video =>
        visible(video) &&
        (video.currentSrc || video.getAttribute('src') || video.querySelector('source[src]')),
    );
    for (const video of videos) {
      const decorativeCandidate = video.autoplay && video.muted && !video.controls;
      if (
        !decorativeCandidate &&
        !video.querySelector('track[kind="captions"], track[kind="subtitles"]')
      )
        add('video-captions', video, { captionTrackPresent: false, audioContentNotVerified: true });
    }
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      coverage: { images: images.length, formControls: controls.length, videos: videos.length },
      findings,
    };
  });

  const originalMotion = await page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  // Compare actual animations, not the presence of a media-query string in a stylesheet.
  const animations = async () =>
    page.evaluate(async () => {
      if (document.hidden || typeof document.getAnimations !== 'function') return null;
      const settled = await new Promise<boolean>(resolve => {
        const timeout = setTimeout(() => resolve(false), 1000);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(timeout);
            resolve(true);
          }),
        );
      });
      if (!settled) return null;
      return document.getAnimations().flatMap(animation => {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) return [];
        const el = effect.target,
          rect = el.getBoundingClientRect(),
          timing = effect.getComputedTiming();
        if (
          animation.playState !== 'running' ||
          animation.playbackRate === 0 ||
          timing.iterations !== Infinity ||
          !Number.isFinite(Number(timing.duration)) ||
          !Number(timing.duration) ||
          rect.width === 0 ||
          rect.height === 0 ||
          rect.bottom <= 0 ||
          rect.top >= innerHeight ||
          rect.right <= 0 ||
          rect.left >= innerWidth ||
          getComputedStyle(el).visibility !== 'visible'
        )
          return [];
        const spatial = [
          'transform',
          'translate',
          'scale',
          'rotate',
          'left',
          'right',
          'top',
          'bottom',
          'width',
          'height',
          'offsetDistance',
          'backgroundPosition',
        ];
        const frames = effect
          .getKeyframes()
          .map(frame =>
            Object.fromEntries(Object.entries(frame).filter(([key]) => spatial.includes(key))),
          );
        if (
          !frames.some(frame => Object.keys(frame).length) ||
          new Set(frames.map(frame => JSON.stringify(frame))).size < 2
        )
          return [];
        const path = (node: Element): string =>
          node.id
            ? '#' + CSS.escape(node.id)
            : node.parentElement
              ? `${path(node.parentElement)} > ${node.localName}:nth-of-type(${[...node.parentElement.children].filter(peer => peer.localName === node.localName).indexOf(node) + 1})`
              : node.localName;
        return [
          {
            selector: path(el),
            name: animation instanceof CSSAnimation ? animation.animationName : animation.id,
            pseudo: effect.pseudoElement,
            duration: Number(timing.duration),
            rate: Math.abs(animation.playbackRate),
            frames: JSON.stringify(frames),
          },
        ];
      });
    });
  let baseline, reduced;
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    baseline = await animations();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    reduced = await animations();
  } finally {
    await page.emulateMedia({ reducedMotion: originalMotion ? 'reduce' : 'no-preference' });
  }
  for (const animation of reduced || []) {
    const prior = baseline?.find(
      item =>
        item.selector === animation.selector &&
        item.name === animation.name &&
        item.pseudo === animation.pseudo,
    );
    if (
      prior &&
      prior.frames === animation.frames &&
      animation.duration <= prior.duration &&
      animation.rate >= prior.rate
    )
      snapshot.findings.push({
        rule: 'motion-reduced-unchanged',
        selector: animation.selector,
        evidence: {
          animation: animation.name,
          durationMs: animation.duration,
          preference: 'reduce',
          heuristic:
            'unchanged infinite spatial keyframes; essential motion and pause controls not verified',
        },
      });
  }
  return {
    schemaVersion: 1,
    ...snapshot,
    coverage: {
      ...snapshot.coverage,
      motionSupported: baseline !== null && reduced !== null,
      motionBaseline: baseline?.length ?? 0,
      motionReduced: reduced?.length ?? 0,
    },
    findings: snapshot.findings.map(finding => {
      const [guide, severity, recommendation] = MODERN_WEB_RULES[finding.rule];
      return { ...finding, guide, severity, recommendation };
    }),
  };
}

export async function attachModernWeb(report: ModernWebReport, testInfo: TestInfo) {
  await testInfo.attach('modern-web.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  const summary = [
    `Modern Web observations: ${report.url}`,
    `Coverage: ${JSON.stringify(report.coverage)}`,
    'Warnings require review. No findings does not establish full guidance compliance.',
    ...report.findings.map(
      finding =>
        `${finding.severity.toUpperCase()} ${finding.rule} (${finding.guide})\nElement: ${finding.selector}\nObserved: ${JSON.stringify(finding.evidence)}\nFix: ${finding.recommendation}`,
    ),
  ].join('\n\n');
  await testInfo.attach('modern-web.txt', { body: summary, contentType: 'text/plain' });
  for (const finding of report.findings.filter(item => item.severity === 'warning'))
    testInfo.annotations.push({
      type: 'modern-web-warning',
      description: `${finding.rule}: ${finding.selector}. ${finding.recommendation}`,
    });
}
