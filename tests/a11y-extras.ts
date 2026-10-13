import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Checks that complement the axe WCAG run: landmarks, focus behavior, names, zoom and reflow. */
export const A11Y_CHECKS = {
  landmarks: 'Single main, labelled repeated navs, banner and footer',
  skipLinks: 'Skip links point to an existing target',
  language: 'html lang matches the page language',
  zoom: 'Viewport meta does not block pinch zoom',
  tabindex: 'No positive tabindex',
  linkPurpose: 'No generic link text without an accessible name',
  labelInName: 'Accessible name contains the visible label',
  keyboardTrap: 'Tab never gets stuck on one element',
  focusVisible: 'Focused elements show a focus indicator',
  focusHidden: 'Focus never lands on an invisible element',
  reflow: 'No horizontal scroll at 320 CSS px',
  ariaBestPractice: 'No serious axe ARIA/semantics findings',
} as const;
export type A11yCheck = keyof typeof A11Y_CHECKS;
export type A11yProblems = Record<A11yCheck, string[]>;

const FOCUS_STOPS = 20;

async function domChecks(page: Page, language: string) {
  return page.evaluate(lang => {
    const visible = (e: Element) => e.checkVisibility({ checkVisibilityCSS: true });
    const text = (e: Element) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const label = (e: Element) => {
      const ids = e.getAttribute('aria-labelledby');
      const byRef = ids
        ? ids
            .split(/\s+/)
            .map(id => document.getElementById(id)?.textContent?.trim() || '')
            .join(' ')
            .trim()
        : '';
      return (e.getAttribute('aria-label') || '').trim() || byRef;
    };
    const tag = (e: Element) =>
      e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ` "${text(e).slice(0, 40)}"`;
    const out: Record<string, string[]> = {
      landmarks: [],
      skipLinks: [],
      language: [],
      zoom: [],
      tabindex: [],
      linkPurpose: [],
      labelInName: [],
    };

    const mains = [...document.querySelectorAll('main, [role="main"]')].filter(visible);
    if (mains.length !== 1) out.landmarks.push(`${mains.length} visible main landmarks (need 1)`);
    if (![...document.querySelectorAll('header, [role="banner"]')].some(visible))
      out.landmarks.push('No banner/header landmark');
    if (![...document.querySelectorAll('footer, [role="contentinfo"]')].some(visible))
      out.landmarks.push('No footer/contentinfo landmark');
    const navs = [...document.querySelectorAll('nav, [role="navigation"]')].filter(visible);
    if (navs.length > 1) {
      const names = navs.map(label);
      names.forEach((name, i) => {
        if (!name || names.indexOf(name) !== i)
          out.landmarks.push(`Navigation ${i + 1} of ${navs.length} has no unique accessible name`);
      });
    }

    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const hash = link.getAttribute('href')!.slice(1);
      if (
        !hash ||
        !/skip|jump|прескочи|към съдържанието|към основното/i.test(text(link) + label(link))
      )
        continue;
      if (!document.getElementById(decodeURIComponent(hash)))
        out.skipLinks.push(`Skip link "${text(link)}" targets missing #${hash}`);
    }

    const pageLang = document.documentElement.lang.toLowerCase();
    if (lang && pageLang.split('-')[0] !== lang.toLowerCase().split('-')[0])
      out.language.push(`html lang="${pageLang}" but the page is expected in "${lang}"`);

    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport);
    if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || (max && Number(max[1]) < 2))
      out.zoom.push(`Viewport blocks zoom: ${viewport}`);

    for (const e of document.querySelectorAll('[tabindex]'))
      if (Number(e.getAttribute('tabindex')) > 0) out.tabindex.push(tag(e));

    const generic =
      /^(click here|here|read more|more|learn more|details|link|тук|повече|прочети повече|виж повече)\.?$/i;
    for (const link of document.querySelectorAll('a[href]')) {
      if (!visible(link) || label(link)) continue;
      if (generic.test(text(link))) out.linkPurpose.push(tag(link));
    }

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const e of document.querySelectorAll('a[href], button, [role="button"], [role="link"]')) {
      const name = norm(label(e));
      const shown = norm(text(e));
      if (visible(e) && name && shown && !name.includes(shown))
        out.labelInName.push(`${tag(e)} has aria-label "${name}"`);
    }
    return out;
  }, language);
}

async function focusChecks(page: Page) {
  // Transitions would hide a style change from a synchronous before/after comparison.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  const trap: string[] = [];
  const indicator: string[] = [];
  const hidden: string[] = [];
  let last = '';
  let repeat = 0;
  for (let i = 0; i < FOCUS_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      const name =
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        ` "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
      const sig = () => {
        const s = getComputedStyle(el);
        return [
          s.outlineStyle,
          s.outlineWidth,
          s.outlineColor,
          s.boxShadow,
          s.borderColor,
          s.backgroundColor,
          s.color,
          s.textDecorationLine,
        ].join('|');
      };
      const focused = sig();
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow !== 'none';
      const rect = el.getBoundingClientRect();
      const shown =
        el.checkVisibility({ checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0;
      // Programmatic focus after keyboard use keeps :focus-visible, so the Tab sequence continues here.
      el.blur();
      const changed = focused !== sig();
      el.focus();
      return { name, shown, indicated: outline || shadow || changed };
    });
    if (!stop) continue;
    repeat = stop.name === last ? repeat + 1 : 0;
    last = stop.name;
    if (repeat === 3) trap.push(`Focus stayed on ${stop.name} for 4 Tab presses`);
    if (!stop.shown) hidden.push(stop.name);
    else if (!stop.indicated) indicator.push(stop.name);
  }
  return {
    keyboardTrap: trap,
    focusVisible: [...new Set(indicator)],
    focusHidden: [...new Set(hidden)],
  };
}

async function reflow(page: Page) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  try {
    return await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth - innerWidth;
      return wide > 5 ? [`Page is ${wide}px wider than a 320px viewport`] : [];
    });
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

async function ariaBestPractice(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['best-practice', 'cat.aria', 'cat.semantics', 'cat.name-role-value'])
    .exclude('iframe')
    .analyze();
  return result.violations
    .filter(v => v.impact === 'critical' || v.impact === 'serious')
    .map(v => `${v.id} (${v.nodes.length}): ${v.help}`);
}

/** Read-only: scrolls nothing, submits nothing; focuses elements and temporarily resizes the viewport. */
export async function auditA11yExtras(page: Page, language = ''): Promise<A11yProblems> {
  const dom = await domChecks(page, language);
  const focus = await focusChecks(page);
  return {
    ...dom,
    ...focus,
    reflow: await reflow(page),
    ariaBestPractice: await ariaBestPractice(page),
  } as A11yProblems;
}
