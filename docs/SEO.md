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
