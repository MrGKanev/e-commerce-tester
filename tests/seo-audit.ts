import type { Page } from '@playwright/test';
import type { InventoryPage } from './inventory';

export type SeoFinding = { severity: 'error' | 'warning' | 'info'; code: string; detail: string };
export type SeoDocument = {
  url: string;
  status: number;
  titles: string[];
  descriptions: string[];
  canonicals: string[];
  robots: string[];
  ogUrls: string[];
  headings: string[];
  jsonLd: string[];
};
export type SeoResult = {
  entry: InventoryPage;
  document: SeoDocument;
  indexable: boolean;
  canonical: string | null;
  findings: SeoFinding[];
};
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
function identity(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}
export function analyzeSeo(entry: InventoryPage, document: SeoDocument): SeoResult {
  const findings: SeoFinding[] = [];
  const add = (severity: SeoFinding['severity'], code: string, detail: string) =>
    findings.push({ severity, code, detail });
  const noindex = document.robots.some(value =>
    /(?:^|[\s,;:])(noindex|none)(?:$|[\s,;])/i.test(value),
  );
  const indexable = !noindex && !['cart', 'search'].includes(entry.type);
  const result: SeoResult = { entry, document, indexable, canonical: null, findings };
  if (document.status >= 400) add('error', 'http-status', `HTTP ${document.status}`);
  if (noindex)
    add(
      'info',
      'noindex',
      'Indexing disabled by meta or X-Robots-Tag; indexable-page requirements omitted.',
    );
  if (document.titles.length !== 1 || !document.titles[0]?.trim())
    add('error', 'title', 'Expected exactly one nonempty title.');
  if (indexable && (document.descriptions.length !== 1 || !document.descriptions[0]?.trim()))
    add(
      'error',
      'description',
      'Expected exactly one nonempty meta description on an indexable page.',
    );
  if (document.canonicals.length > 1 || (indexable && document.canonicals.length !== 1))
    add(
      'error',
      'canonical-count',
      'Expected one canonical on an indexable page; multiple canonicals are ambiguous.',
    );
  if (document.canonicals.length === 1) {
    const href = document.canonicals[0];
    try {
      const canonical = new URL(href);
      if (
        !/^https?:\/\//i.test(href) ||
        !['http:', 'https:'].includes(canonical.protocol) ||
        canonical.username ||
        canonical.password ||
        canonical.hash
      )
        throw new Error('invalid');
      result.canonical = canonical.href;
      if (identity(canonical.href) !== identity(document.url))
        add(
          'warning',
          'alternate-canonical',
          `Canonical differs from final document URL: ${canonical.href}. Review intended consolidation (variants, filters, alternate domains).`,
        );
      for (const ogUrl of document.ogUrls) {
        try {
          if (identity(new URL(ogUrl, document.url).href) !== identity(canonical.href))
            add('warning', 'og-url', `og:url differs from canonical: ${ogUrl}`);
        } catch {
          add('warning', 'og-url-invalid', `Invalid og:url: ${ogUrl}`);
        }
      }
    } catch {
      add(
        'error',
        'canonical-url',
        'Canonical must be an absolute HTTP(S) URL without credentials or fragment.',
      );
    }
  }
  if (indexable && !document.headings.length)
    add('warning', 'h1-missing', 'No visible nonempty H1.');
  if (document.headings.length > 1)
    add('warning', 'h1-multiple', 'Multiple visible H1 headings; review page hierarchy.');
  for (const [index, source] of document.jsonLd.entries()) {
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch {
      add('error', 'jsonld-syntax', `JSON-LD script ${index + 1} is not valid JSON.`);
      continue;
    }
    if (!data || typeof data !== 'object') {
      add('error', 'jsonld-shape', `JSON-LD script ${index + 1} must contain an object or array.`);
      continue;
    }
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as Record<string, unknown>;
      const types = [record['@type']].flat();
      if (types.some(type => ['WebPage', 'Product'].includes(String(type)))) {
        if (typeof record.url === 'string' && result.canonical) {
          try {
            const schemaUrl = new URL(record.url, document.url);
            // Product variants may intentionally have a different query string.
            const canonical = new URL(result.canonical);
            if (
              schemaUrl.origin !== canonical.origin ||
              schemaUrl.pathname.replace(/\/$/, '') !== canonical.pathname.replace(/\/$/, '')
            )
              add(
                'warning',
                'jsonld-url',
                `JSON-LD ${types.join(', ')} URL differs from canonical: ${record.url}`,
              );
          } catch {
            add('error', 'jsonld-url-invalid', `Invalid JSON-LD URL in script ${index + 1}.`);
          }
        }
        if (
          entry.type === 'product' &&
          types.includes('Product') &&
          typeof record.name === 'string' &&
          document.headings.length === 1 &&
          normalize(record.name) !== normalize(document.headings[0])
        )
          add('warning', 'jsonld-name', `Product name differs from visible H1: ${record.name}`);
      }
      // Traverse graph/nested entities, without assuming every node describes this page.
      Object.values(record).forEach(visit);
    };
    visit(data);
  }
  return result;
}
export function inventorySeoFindings(results: SeoResult[]) {
  const findings: (SeoFinding & { urls: string[] })[] = [];
  const documents = new Map(results.map(result => [identity(result.document.url), result]));
  for (const result of results) {
    if (!result.canonical) continue;
    const target = documents.get(identity(result.canonical));
    if (!target || target === result) continue;
    if (
      target.document.status >= 400 ||
      target.document.robots.some(value => /(?:^|[\s,;:])(noindex|none)(?:$|[\s,;])/i.test(value))
    )
      findings.push({
        severity: 'error',
        code: 'canonical-target',
        detail: 'Canonical points to an audited HTTP error or noindex page.',
        urls: [result.document.url, target.document.url],
      });
    if (target.canonical && identity(target.canonical) !== identity(result.canonical))
      findings.push({
        severity: 'warning',
        code: 'canonical-chain',
        detail: 'Canonical target declares a different canonical.',
        urls: [result.document.url, target.document.url],
      });
  }
  for (const field of ['titles', 'descriptions'] as const) {
    const groups = new Map<string, SeoResult[]>();
    for (const result of results) {
      if (!result.indexable || result.document.status >= 400) continue;
      const key = normalize(result.document[field][0] || '');
      if (key) groups.set(key, [...(groups.get(key) || []), result]);
    }
    for (const group of groups.values()) {
      // Intentional alternate URLs sharing the same canonical are not duplicate pages.
      if (new Set(group.map(result => result.canonical || result.document.url)).size > 1)
        findings.push({
          severity: 'warning',
          code: `duplicate-${field}`,
          detail: `Identical ${field} across different canonical pages.`,
          urls: group.map(result => result.document.url),
        });
    }
  }
  return findings;
}
export async function readSeoDocument(
  page: Page,
  status: number,
  robotsHeader = '',
): Promise<SeoDocument> {
  const snapshot = await page.evaluate(() => {
    const contents = (selector: string, attribute?: string) =>
      Array.from(document.querySelectorAll(selector)).map(element =>
        attribute ? element.getAttribute(attribute) || '' : element.textContent || '',
      );
    return {
      url: location.href,
      titles: contents('head title'),
      descriptions: contents('head meta[name="description" i]', 'content'),
      canonicals: contents('head link[rel~="canonical" i]', 'href'),
      robots: contents('head meta[name="robots" i], head meta[name="googlebot" i]', 'content'),
      ogUrls: contents('head meta[property="og:url" i]', 'content'),
      headings: Array.from(document.querySelectorAll('h1'))
        .filter(element => {
          const style = getComputedStyle(element);
          return (
            element.getClientRects().length &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
          );
        })
        .map(element => element.textContent?.trim() || '')
        .filter(Boolean),
      jsonLd: contents('script[type="application/ld+json" i]'),
    };
  });
  return { ...snapshot, status, robots: [...snapshot.robots, robotsHeader].filter(Boolean) };
}
