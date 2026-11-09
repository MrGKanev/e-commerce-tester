# SEO inventory

`pnpm test:seo --site=<slug>` runs `35-seo-inventory` for Shopify and WooCommerce. The check is also part of the `full` and `pages` modes, for desktop and mobile browser projects.

It uses the prepared `page-inventory.json`: the home page, the configured products, the catalogue, search, cart, any extra `inventory.pages` and the products from `inventory.discoverProducts` when enabled. It does not crawl every link on the site; coverage is limited by the configuration and `productLimit`.

It checks the final document after navigation and content rendering. The sources are the public rendered DOM and the HTTP `X-Robots-Tag` header, with no administrative APIs, cart changes or orders. It creates no images of its own; the shared Playwright screenshot-on-failure setting still applies.

Errors that fail the test:

- HTTP errors or failed navigation.
- A missing, empty or duplicated title.
- A missing, empty or duplicated description on an indexable page.
- A missing canonical on an indexable page, multiple canonicals, or an invalid or relative canonical URL.
- Invalid JSON syntax or a scalar root value in JSON-LD.
- A canonical pointing to another already-checked page that has an HTTP error or `noindex`.

Warnings for human review:

- A canonical that differs from the final URL; this may be intentional for variants and filters.
- An `og:url` that differs from the canonical.
- A JSON-LD Product/WebPage URL whose domain or path differs from the canonical. A variant query is not treated as a mismatch.
- A product name that differs from the single visible H1. Related products and different formatting can explain the warning.
- A missing or multiple visible H1.
- Identical title/description across different canonical pages. Alternative URLs that share a canonical are excluded.
- A canonical chain between already-checked pages.

Cart, search and pages with an explicit `noindex`/`none` do not need a description and canonical like indexable pages do. `noindex` is recorded in the report as information; we cannot know whether it is intentional without a policy for that specific page. Invalid JSON-LD and a duplicated canonical are still checked there.

For each browser project the HTML report contains the attachment `seo-inventory.json`: the checked URLs, HTTP statuses, the metadata/JSON-LD that was read, and the errors and warnings. The check continues after a problem on a single page and stops only on the shared rate-limit mechanism. Canonical targets outside the checked inventory receive no extra requests.

This is a technical check of the available data, not a full Schema.org or Google Rich Results validation. Prices and availability of specific variants are verified by the separate commerce tests. It does not prove how Google has indexed the site.

Local validation without a real store: `pnpm test:seo:local`.

Official guidance: [Canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Robots metadata](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [Structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).

## Sitemap duplicate candidates (Shopify and WooCommerce)

A separate `@seo` test scans `/sitemap.xml`, nested sitemap indexes (including Shopify, Yoast and Rank Math formats), or `/wp-sitemap.xml` if the initial URL returns 404. It reads every listed page URL, independent of the configured page inventory. Only URLs on the configured storefront origin are accepted, including redirect targets. External sitemap entries are reported as incomplete coverage rather than fetched. Cycles are deduplicated; the scan stops at 100 sitemap documents and fails explicitly if that limit is exceeded. HTTP/XML errors also fail the scan. Requests use the existing pacing and rate-limit handling.

`seo-sitemaps.json` contains scanned sitemaps, listed URLs, findings and coverage errors. Findings also appear as warning annotations in the Playwright HTML report:

- Original URL plus a sibling ending in a positive integer (`-1`, `-2`, etc.), `-old`, `-new`, `-copy`, `-copy-2`, `-backup`, `-draft`, `-test`, `-duplicate`, `-temp` or `-tmp`.
- Repeated URLs within or across sitemaps (trailing slashes are normalized).
- Query strings or fragments in listed URLs.

Suffix matching works for collections, product categories, products and pages with arbitrary WooCommerce permalink prefixes. The original must exist in the sitemap on the same domain and language/path prefix. A standalone `model-2026` or `gifts-old` is not flagged without its unsuffixed counterpart. The check does not fetch these pages or prove identical content, indexability, rankings or a ranking penalty. Findings are warnings, not test failures, and make no store changes. Compare full content/product ranges and canonical tags before deciding whether to rename, consolidate or redirect anything.

Useful next checks (not implemented by this sitemap scan):

- Identical complete product sets under different category URLs, with pagination accounted for.
- Empty indexable categories and pages that return HTTP 200 with an error/empty-state template.
- Sitemap URLs that redirect, return 404, declare `noindex`, or canonicalize elsewhere.
- Filter/sort/search URLs exposed through internal links and allowed to index.
- Internal links to old URLs and redirect chains after migrations.

The existing inventory audit already checks duplicate titles/descriptions and several canonical problems for the configured pages.
