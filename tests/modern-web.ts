import type { Page, TestInfo } from '@playwright/test';
import type { VitalDocument } from './web-vitals';

export type WebFinding = {
  rule: string;
  guide: string;
  severity: 'warning' | 'error';
  selector: string;
  evidence: Record<string, unknown>;
  recommendation: string;
};

export function safeAuditUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()])
    if (/^(?:password|passwd|email|access_token|secret|credit_card|card_number)$/i.test(key))
      url.searchParams.set(key, '[redacted]');
  return url.href;
}

// Executable rules are reviewed locally; upstream skills are never executed by store runs.
export const MODERN_WEB_RULES = {
  'form-username-autofill': [
    'autofill-sign-in-form',
    'warning',
    'Mark the sign-in identifier with autocomplete="username" alongside current-password.',
  ],
  'nested-interactive': [
    'card',
    'warning',
    'Separate nested links/buttons/controls so each action has an independent keyboard target.',
  ],
  'breadcrumb-current': [
    'breadcrumbs',
    'warning',
    'Identify the current page in breadcrumb navigation; verify the last item and accessible hierarchy.',
  ],
  'nav-current-duplicate': [
    'navbar',
    'warning',
    'Review multiple current-page links inside the same navigation region.',
  ],
  'progress-name': [
    'spinner',
    'warning',
    'Give a progress indicator an accessible name and expose its busy/completion state.',
  ],
  'privacy-url-parameters': [
    'privacy',
    'warning',
    'Review sensitive-looking URL parameter names; do not expose personal data or credentials in URLs.',
  ],
  'security-nosniff': [
    'security',
    'warning',
    'Serve the document with X-Content-Type-Options: nosniff.',
  ],
  'security-framing': [
    'security',
    'warning',
    'Review CSP frame-ancestors or X-Frame-Options for the intended embedding policy.',
  ],
  'security-csp': [
    'security',
    'warning',
    'Review an enforced Content-Security-Policy appropriate for the storefront; report-only is not enforcement.',
  ],
  'security-hsts': [
    'security',
    'warning',
    'Review Strict-Transport-Security on HTTPS, with a positive max-age and the intended subdomain scope.',
  ],
  'lcp-image-lazy': [
    'optimize-image-priority',
    'warning',
    'Remove lazy loading from the observed image LCP element.',
  ],
  'lcp-image-priority': [
    'optimize-image-priority',
    'warning',
    'Review high fetch priority for the observed image LCP element.',
  ],
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
export async function inspectModernWeb(page: Page, headers?: Record<string, string>) {
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
        if (autocomplete.split(/\s+/).includes('current-password') && control.form) {
          const username = [...control.form.querySelectorAll<HTMLInputElement>('input')].find(
            input => visible(input) && !input.disabled && ['text', 'email'].includes(input.type),
          );
          if (
            username &&
            !(username.getAttribute('autocomplete') || '')
              .toLowerCase()
              .split(/\s+/)
              .includes('username')
          )
            add('form-username-autofill', username, {
              passwordPurpose: 'current-password',
              identifierPurpose: 'not-username',
            });
        }
      }
    }
    for (const outer of document.querySelectorAll('a[href], button'))
      if (
        visible(outer) &&
        outer.querySelector(
          'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]',
        )
      )
        add('nested-interactive', outer, { nestedInteractive: true });
    for (const nav of document.querySelectorAll('nav, [role="navigation"]')) {
      if (!visible(nav)) continue;
      const current = nav.querySelectorAll('[aria-current="page"]');
      if (current.length > 1)
        add('nav-current-duplicate', nav, { currentPageItems: current.length });
      if (/breadcrumb|хлебн/i.test(nav.getAttribute('aria-label') || '') && current.length === 0)
        add('breadcrumb-current', nav, { currentPageIdentified: false });
    }
    for (const progress of document.querySelectorAll('progress, [role="progressbar"]'))
      if (
        visible(progress) &&
        !progress.getAttribute('aria-label')?.trim() &&
        !(progress.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .some(id => document.getElementById(id)?.textContent?.trim()) &&
        !(progress instanceof HTMLProgressElement && progress.labels?.length)
      )
        add('progress-name', progress, { accessibleName: false });
    const sensitiveKeys = [...new URL(location.href).searchParams.keys()].filter(key =>
      /^(?:password|passwd|email|access_token|secret|credit_card|card_number)$/i.test(key),
    );
    if (sensitiveKeys.length)
      add('privacy-url-parameters', document.documentElement, { parameterNames: sensitiveKeys });
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
    const reportUrl = new URL(location.href);
    for (const key of sensitiveKeys) reportUrl.searchParams.set(key, '[redacted]');
    return {
      url: reportUrl.href,
      viewport: { width: innerWidth, height: innerHeight },
      coverage: { images: images.length, formControls: controls.length, videos: videos.length },
      findings,
    };
  });

  const attribution = await page.evaluate(() => {
    const scope = window as unknown as {
      __storeVitals?: { peek?: () => VitalDocument; finish?: (reason: string) => VitalDocument };
    };
    // End passive sampling before our own preference/viewport/input stress changes the page.
    const snapshot =
      scope.__storeVitals?.finish?.('modern-web-probe-boundary') || scope.__storeVitals?.peek?.();
    return snapshot?.attribution || null;
  });
  if (attribution?.initialVisibility === 'visible' && attribution.lcp?.kind === 'image') {
    const element = String(attribution.lcp.element || 'observed LCP image');
    if (attribution.lcp.loading === 'lazy')
      snapshot.findings.push({
        rule: 'lcp-image-lazy',
        selector: element,
        evidence: attribution.lcp,
      });
    if (attribution.lcp.fetchPriority !== 'high')
      snapshot.findings.push({
        rule: 'lcp-image-priority',
        selector: element,
        evidence: attribution.lcp,
      });
  }
  if (headers) {
    const add = (rule: Rule, evidence: Record<string, unknown>) =>
      snapshot.findings.push({ rule, selector: 'document response', evidence });
    if (headers['x-content-type-options']?.toLowerCase() !== 'nosniff')
      add('security-nosniff', { nosniff: false });
    if (!headers['content-security-policy'])
      add('security-csp', {
        enforcedCsp: false,
        reportOnly: Boolean(headers['content-security-policy-report-only']),
      });
    if (
      !/(?:^|;)\s*frame-ancestors\s+[^;]+/i.test(headers['content-security-policy'] || '') &&
      !/^(deny|sameorigin)$/i.test(headers['x-frame-options'] || '')
    )
      add('security-framing', { framingPolicy: false });
    const age = /(?:^|;)\s*max-age\s*=\s*(\d+)\s*(?:;|$)/i.exec(
      headers['strict-transport-security'] || '',
    );
    if (
      new URL(snapshot.url).protocol === 'https:' &&
      (!age || !Number.isSafeInteger(Number(age[1])) || Number(age[1]) <= 0)
    )
      add('security-hsts', { positiveHstsMaxAge: false });
  }
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
          (timing.iterations !== Infinity && Number(timing.activeDuration) <= 5000) ||
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
            iterations: timing.iterations === Infinity ? null : (timing.iterations ?? 1),
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
      animation.rate >= prior.rate &&
      (animation.iterations === null ||
        (prior.iterations !== null && animation.iterations >= prior.iterations))
    )
      snapshot.findings.push({
        rule: 'motion-reduced-unchanged',
        selector: animation.selector,
        evidence: {
          animation: animation.name,
          durationMs: animation.duration,
          preference: 'reduce',
          heuristic:
            'unchanged persistent spatial keyframes; essential motion and pause controls not verified',
        },
      });
  }
  return {
    schemaVersion: 1,
    ...snapshot,
    attribution,
    coverage: {
      ...snapshot.coverage,
      responseHeadersObserved: Boolean(headers),
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

export async function attachModernWeb(
  report: { url: string; coverage: object; findings: readonly WebFinding[] },
  testInfo: TestInfo,
  name = 'modern-web',
) {
  await testInfo.attach(`${name}.json`, {
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
  await testInfo.attach(`${name}.txt`, { body: summary, contentType: 'text/plain' });
  for (const finding of report.findings.filter(item => item.severity === 'warning'))
    testInfo.annotations.push({
      type: 'modern-web-warning',
      description: `${finding.rule}: ${finding.selector}. ${finding.recommendation}`,
    });
}
