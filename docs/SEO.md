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
- Years from 1900 to 2099 in URL paths or queries, such as `/summer-sale-2024`, `/blog/2023/post` or `?year=2026`. This warning does not require an unsuffixed counterpart; dates may be intentional.

Suffix matching works for collections, product categories, products and pages with arbitrary WooCommerce permalink prefixes. The original must exist in the sitemap on the same domain and language/path prefix. A standalone `model-2026` or `gifts-old` does not trigger a suffix-pair warning without its unsuffixed counterpart; `model-2026` still triggers the separate year warning. Suffix and year findings do not prove identical content, indexability, rankings or a ranking penalty. These findings are warnings, not test failures, and make no store changes. Compare full content/product ranges and canonical tags before deciding whether to rename, consolidate or redirect anything.

## Public HTML crawl

The same test also creates `seo-crawl.json` and adds findings to the HTML report. It reads sitemap page URLs, configured inventory pages (excluding the cart), and internal filter/sort/search links found in those pages. Requests are sequential, use the shared pacing/rate-limit mechanism, follow at most five redirects, and remain on the configured storefront origin. Administrative, account, checkout and cart/action URLs are not fetched. No JavaScript or forms are executed and no product pages are fetched just to enumerate category products.

Errors that fail the test:

- HTTP 4xx/5xx on a crawled URL.
- Sitemap URLs with `noindex`/`none` in robots metadata or `X-Robots-Tag`.
- Failed reads, non-HTML responses, unsafe/external redirect targets or exhausted page coverage.

Warnings for review:

- Sitemap URLs that redirect or canonicalize elsewhere, plus redirect chains.
- HTTP 200 pages whose title/H1 or template markers suggest a missing page (a possible soft 404).
- Indexable categories with an explicit empty-product message, a zero product total or a recognized empty grid.
- Different categories with identical complete **observed** product sets and different canonical URLs. Product order is ignored; collection-scoped Shopify product links and product variant/tracking queries are normalized. Noindex categories, empty sets and incomplete sets are excluded. Categories sharing a canonical do not trigger a duplicate finding on their own.
- Linked filter/sort/search URLs with HTTP 200, no `noindex`, and no valid canonical consolidation to a different URL. Recognized parameters include Shopify `sort_by`/`filter.*`, WooCommerce `orderby`/`filter_*`/`query_type_*`/price/rating parameters, and search `q`/`s`. Shopify tag URLs are also recognized. Parameters alone do not establish a problem: noindex or consolidated URLs do not trigger this warning.
- Years in discovered URLs not already covered by the sitemap scan.

Collection detection uses Shopify collection paths, WooCommerce archive/taxonomy body classes, or configured inventory entries with type `collection`, so custom WooCommerce category permalinks can be checked. Product extraction is scoped to recognized Shopify/WooCommerce grids and product links, excluding recommendations outside the grid. Supported pagination follows conventional next/page links with `page`, `paged`, `product-page` or `/page/N/`, staying within the same category. All observed products are combined before comparing categories; visible product totals, when recognized, must agree with the collected count.

There is a limit of **200 distinct public page reads** per audit and **50 pages per category**. Exceeding the global budget fails the test as incomplete coverage; `unreadUrls` lists queued pages that were not successfully read. A category with unsupported grid markup, unreadable pagination, load-more/infinite-scroll controls, a failed page or an inconsistent product count receives `collection-incomplete` and is excluded from duplicate comparison. These category warnings do not fail the test by themselves. Increase the documented limits in `tests/seo-crawl.ts` if the intended audit requires a larger budget.

This crawl inspects server HTML. JavaScript-only grids, client-added links/metadata, unrecognized custom pagination and localized empty/error messages may require additional theme-specific support. Absence of `noindex` in the response does not prove Google indexing; this test does not evaluate robots.txt rules or Search Console data. A duplicate product set is a reason to review category intent, descriptions and canonical tags, not an instruction to delete it. The existing inventory audit continues to inspect rendered metadata/JSON-LD for its configured pages.
