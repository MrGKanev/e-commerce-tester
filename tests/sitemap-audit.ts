import type { Page, APIRequestContext } from '@playwright/test';
import type { SeoFinding } from './seo-audit';
import { assertNotLimited } from './pacing';

type SitemapFinding = SeoFinding & { urls: string[] };
export function sitemapFindings(urls: string[]): SitemapFinding[] {
  const findings: SitemapFinding[] = [];
  const counts = new Map<string, number>();
  for (const value of urls) {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    counts.set(url.href, (counts.get(url.href) || 0) + 1);
  }
  for (const [value, count] of counts) {
    const url = new URL(value);
    if (count > 1)
      findings.push({
        severity: 'warning',
        code: 'sitemap-duplicate-url',
        detail: `URL occurs ${count} times in sitemaps.`,
        urls: [value],
      });
    if (/(?:^|[^0-9])(?:19|20)[0-9]{2}(?=$|[^0-9])/.test(url.pathname + url.search))
      findings.push({
        severity: 'warning',
        code: 'url-year',
        detail:
          'URL contains a year (1900–2099); review whether the dated address and content are still appropriate.',
        urls: [value],
      });
    if (url.search || url.hash)
      findings.push({
        severity: 'warning',
        code: 'sitemap-parameters',
        detail:
          'Sitemap URL contains a query or fragment; review variants, filters and tracking parameters.',
        urls: [value],
      });
    const base = new URL(value);
    base.pathname = base.pathname.replace(
      /-(?:[1-9]\d*|old|new|copy(?:-\d+)?|backup|draft|test|duplicate|temp|tmp)$/i,
      '',
    );
    if (base.href !== value && counts.has(base.href))
      findings.push({
        severity: 'warning',
        code: 'sitemap-suffix-pair',
        detail:
          'Both the original and a suffixed URL are in the sitemap. Compare content/products and canonical tags before changing either URL; suffix alone does not prove duplication.',
        urls: [base.href, value],
      });
  }
  return findings;
}

export async function auditSitemaps(page: Page, request: APIRequestContext, base: string) {
  const origin = new URL(base).origin;
  const pending = [origin + '/sitemap.xml'];
  const visited = new Set<string>();
  const urls: string[] = [];
  const errors: { url: string; message: string }[] = [];
  function publicUrl(value: string) {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || !/^https?:$/.test(url.protocol))
      throw new Error(`Sitemap URL must stay on storefront origin: ${value}`);
    return url.href;
  }
  while (pending.length) {
    const source = pending.shift()!;
    if (visited.has(source)) continue;
    // shortcut: at most 100 sitemap documents, raise this limit for larger catalogues.
    if (visited.size >= 100) {
      errors.push({ url: source, message: 'Sitemap limit (100) reached; coverage is incomplete.' });
      break;
    }
    visited.add(source);
    try {
      let target = publicUrl(source);
      let response = await request.get(target, { maxRedirects: 0 });
      for (let redirects = 0; response.status() >= 300 && response.status() < 400; redirects++) {
        if (redirects >= 5 || !response.headers().location)
          throw new Error('Invalid or excessive sitemap redirects');
        target = publicUrl(new URL(response.headers().location, target).href);
        response = await request.get(target, { maxRedirects: 0 });
      }
      visited.add(target);
      if (source === origin + '/sitemap.xml' && response.status() === 404) {
        pending.push(origin + '/wp-sitemap.xml');
        continue;
      }
      if (!response.ok()) throw new Error(`Sitemap returned HTTP ${response.status()}`);
      const parsed = await page.evaluate(
        xml => {
          const document = new DOMParser().parseFromString(xml, 'application/xml');
          const root = document.documentElement;
          if (
            document.querySelector('parsererror') ||
            !['sitemapindex', 'urlset'].includes(root.localName)
          )
            throw new Error('Invalid sitemap XML');
          const entryName = root.localName === 'sitemapindex' ? 'sitemap' : 'url';
          const locations = Array.from(root.children)
            .filter(node => node.localName === entryName)
            .map(node => {
              const locs = Array.from(node.children).filter(child => child.localName === 'loc');
              if (locs.length !== 1 || !locs[0].textContent?.trim())
                throw new Error('Sitemap entry must have one nonempty loc');
              return locs[0].textContent.trim();
            });
          return { index: root.localName === 'sitemapindex', locations };
        },
        await response.text(),
      );
      for (const location of parsed.locations) {
        const url = publicUrl(location);
        if (parsed.index) pending.push(url);
        else urls.push(url);
      }
    } catch (error) {
      assertNotLimited();
      errors.push({ url: source, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    schemaVersion: 1,
    sitemaps: [...visited],
    urls,
    findings: sitemapFindings(urls),
    errors,
  };
}
