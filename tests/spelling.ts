import { readRasterText } from './ocr';
import { createHash } from 'node:crypto';
import nspell from 'nspell';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { readSiteSettings } from '../config/site-settings';
import { fingerprint, mergeFindings, type Finding } from '../scripts/spelling-model';

const settings = readSiteSettings().spelling;
const suggestions = new Map<string, string[]>();
let auditSequence = 0;
const dictionaries = new Map<string, Promise<ReturnType<typeof nspell>>>();
function dictionary(language: 'bg' | 'en') {
  if (!dictionaries.has(language))
    dictionaries.set(
      language,
      (async () => {
        const data =
          language === 'bg'
            ? (await import('dictionary-bg')).default
            : (await import('dictionary-en')).default;
        return nspell({ aff: Buffer.from(data.aff), dic: Buffer.from(data.dic) });
      })(),
    );
  return dictionaries.get(language)!;
}
export async function auditSpelling(
  page: Page,
  testInfo: TestInfo,
  fallbackLanguage = readSiteSettings().locale,
) {
  if (settings.mode === 'off')
    return {
      findings: [] as Finding[],
      unsupportedLanguages: [] as string[],
      ocr: {
        enabled: false,
        engine: '',
        imagesChecked: 0,
        wordsRecognized: 0,
        lowConfidenceSkipped: 0,
      },
    };
  const contextName =
    'spelling-context-' +
    createHash('sha256')
      .update(`${page.url()}|${testInfo.testId}|${testInfo.retry}|${++auditSequence}`)
      .digest('hex')
      .slice(0, 16);
  const samples = await page.evaluate(
    ({ exclude, fallback }) => {
      function visible(element: Element) {
        if (
          element.closest(
            'script, style, template, noscript, [hidden], [aria-hidden="true"], [contenteditable="true"]',
          )
        )
          return false;
        if (element instanceof HTMLElement && element.isContentEditable) return false;
        if (exclude.some(selector => element.closest(selector))) return false;
        const style = getComputedStyle(element);
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          element.getClientRects().length > 0
        );
      }
      function locator(element: Element) {
        const parts: string[] = [];
        let current: Element | null = element;
        for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
          if (current.id) {
            parts.unshift('#' + CSS.escape(current.id));
            break;
          }
          const tag = current.tagName.toLowerCase();
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter(
                sibling => sibling.tagName === current!.tagName,
              )
            : [current];
          parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
        }
        return parts.join(' > ');
      }
      function sample(element: Element, text: string, source: string) {
        const owner =
          element.closest('[data-component]') ||
          element.closest('header, footer') ||
          element.closest('main, nav, form');
        const rect = element.getBoundingClientRect();
        return {
          text: text.normalize('NFC').replace(/\s+/g, ' ').trim(),
          source,
          language: element.closest('[lang]')?.getAttribute('lang') || fallback,
          component:
            owner?.getAttribute('data-component') || owner?.tagName.toLowerCase() || 'body',
          locator: locator(element),
          rect: {
            x: rect.x + scrollX,
            y: rect.y + scrollY,
            width: rect.width,
            height: rect.height,
          },
        };
      }
      const result: ReturnType<typeof sample>[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (
          node.parentElement &&
          !node.parentElement.closest('input, textarea') &&
          visible(node.parentElement) &&
          node.textContent?.trim()
        )
          result.push(sample(node.parentElement, node.textContent, 'text'));
      }
      for (const element of document.querySelectorAll(
        '[alt], [title], [aria-label], [placeholder]',
      )) {
        if (!visible(element)) continue;
        for (const source of ['alt', 'title', 'aria-label', 'placeholder']) {
          const text = element.getAttribute(source);
          if (text?.trim()) result.push(sample(element, text, source));
        }
      }
      return result;
    },
    { exclude: settings.excludeSelectors, fallback: fallbackLanguage },
  );
  const ocr = await readRasterText(
    page,
    fallbackLanguage,
    settings.languages,
    settings.ocr,
    settings.excludeSelectors,
  );
  samples.push(...ocr.samples);
  const allowed = new Set(
    settings.allowWords.flatMap(phrase => {
      const normalized = phrase.normalize('NFC').toLocaleLowerCase();
      return [
        normalized,
        ...Array.from(new Intl.Segmenter('bg', { granularity: 'word' }).segment(normalized))
          .filter(part => part.isWordLike)
          .map(part => part.segment),
      ];
    }),
  );
  const findings: Finding[] = [];
  const unsupported = new Set<string>();
  for (const sample of samples) {
    try {
      Intl.getCanonicalLocales(sample.language);
    } catch (error) {
      if (error instanceof RangeError) {
        unsupported.add(sample.language);
        continue;
      }
      throw error;
    }
    const declared = sample.language.toLowerCase().split('-')[0];
    if (!['bg', 'en'].includes(declared)) {
      unsupported.add(sample.language);
      continue;
    }
    const segments = new Intl.Segmenter(sample.language, { granularity: 'word' }).segment(
      sample.text,
    );
    for (const segment of segments) {
      const word = segment.segment;
      if (
        !segment.isWordLike ||
        !/\p{L}/u.test(word) ||
        /\d/.test(word) ||
        allowed.has(word.toLocaleLowerCase())
      )
        continue;
      const language =
        declared === 'bg' && /^[\p{Script=Latin}\p{M}'’-]+$/u.test(word) ? 'en' : declared;
      if (!settings.languages.includes(language as 'bg' | 'en')) {
        unsupported.add(language);
        continue;
      }
      const mixed = /\p{Script=Latin}/u.test(word) && /\p{Script=Cyrillic}/u.test(word);
      const spell = await dictionary(language as 'bg' | 'en');
      if (!mixed && (spell.correct(word) || spell.correct(word.toLocaleLowerCase()))) continue;
      const finding: Finding = {
        id: '',
        language,
        component: sample.component,
        source: sample.source,
        text: sample.text,
        word,
        suggestions: mixed
          ? []
          : (() => {
              const key = language + ':' + word;
              if (!suggestions.has(key)) suggestions.set(key, spell.suggest(word).slice(0, 5));
              return suggestions.get(key)!;
            })(),
        accepted: false,
        urls: [page.url()],
        locations: [
          {
            url: page.url(),
            locator: sample.locator,
            screenshot: contextName,
            source: sample.source,
            rect: sample.rect,
          },
        ],
      };
      finding.id = fingerprint(finding);
      finding.accepted = settings.acceptedFindings.includes(finding.id);
      findings.push(finding);
    }
  }
  const report = {
    schemaVersion: 1,
    ocr: ocr.stats,
    url: page.url(),
    findings: mergeFindings([], findings),
    unsupportedLanguages: [...unsupported],
  };
  await testInfo.attach('spelling.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  if (report.findings.length || report.ocr.lowConfidenceSkipped)
    await testInfo.attach(contextName, {
      body: await page.screenshot({ fullPage: true, animations: 'disabled', scale: 'css' }),
      contentType: 'image/png',
    });
  if (settings.mode === 'strict') {
    expect(
      report.ocr.lowConfidenceSkipped,
      'OCR words need manual review due to low confidence',
    ).toBe(0);
    expect(report.unsupportedLanguages, 'Some content languages were not checked').toEqual([]);
    expect(
      report.findings.filter(finding => !finding.accepted).length,
      'Unaccepted spelling findings',
    ).toBeLessThanOrEqual(settings.maxFindings);
  }
  return report;
}
