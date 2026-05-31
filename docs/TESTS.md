# Test Cases

Full test coverage reference for the e-commerce-tester suite (28 spec files, 3 browsers).

## Core functionality (01–09)

| File | Suite | What's checked |
|------|-------|----------------|
| `01-homepage` | Homepage | HTTP 200, title, meta description, canonical, favicon, header, footer, logo, hero section, no JS errors, no failed requests, CSS loaded, fixed-element audit |
| `02-navigation` | Desktop nav | Nav links visible & non-empty, all links respond 200, clicking navigates correctly, dropdown hover, cart icon, search icon |
| `02-navigation` | Footer nav | Link count, all links respond 200, social media links |
| `02-navigation` | Mobile nav | Hamburger visible, menu opens/closes, links visible when open, touch target sizes, no overlay after close, 404 page has header |
| `03-collections` | Collections | `/collections/all` loads, product grid visible, card has name+price+image+link, alt text, no overflow |
| `04-product` | Known products | 200, redirect check, title/meta/JSON-LD, H1 visible, price+currency, description, images (loaded+sized+alt+srcset), gallery thumbnails, add-to-cart (visible+enabled+not covered), quantity selector, variants, breadcrumbs, related products, no overflow, mobile sizing |
| `04-product` | First collection product | Loads, add-to-cart triggers visible response |
| `05-cart` | Cart | Cart page loads, empty state, cart link in header, add product, name & price shown, quantity increase, remove item, checkout button |
| `05-cart` | Mobile cart | No overflow, checkout visible at 390 px |
| `06-search` | Search | Icon visible, input appears on click, accepts text, submits & redirects, results found, no-results for nonsense, no overflow, predictive suggestions |
| `07-mobile` | Overflow | Every key page × 3 viewports (375, 390, 768 px) — overflow detected with culprit elements listed |
| `07-mobile` | Overlap / z-index | Add-to-cart buttons, checkout, hamburger — `elementFromPoint` check for covering elements; fixed-element audit |
| `07-mobile` | Font sizes | Body ≥ 14 px, description ≥ 14 px, inputs ≥ 16 px (iOS zoom prevention) |
| `07-mobile` | Touch targets | Cart icon, hamburger, add-to-cart all ≥ 40 px |
| `07-mobile` | Images | Product & homepage images don't exceed viewport width |
| `07-mobile` | Sticky header | Visible after 500 px scroll, ≤ 120 px height, doesn't block product |
| `07-mobile` | Tablet 768 px | No overflow on homepage & product page, nav visible |
| `08-pages` | Static pages | Contact, About, FAQ, Privacy, Terms, Refund, Shipping — reachable, renders content, no overflow |
| `08-pages` | Contact form | Form present, has email input and submit button |
| `08-pages` | Policy links | All policy links in footer respond 200 |
| `09-media` | Broken images | No broken images on homepage, collections, known products (with lazy-scroll) |
| `09-media` | Alt text | Images have alt text on homepage & product pages |
| `09-media` | Failed assets | No CSS/JS 4xx errors on key pages |
| `09-media` | Responsive images | Product images use `srcset` |
| `09-media` | Font loading | @font-face declarations present |
| `09-media` | Videos | No failed video assets |

## Advanced quality (10–16)

| File | Suite | What's checked |
|------|-------|----------------|
| `10-visual` | Visual regression | Pixel-level snapshot comparison (3 % tolerance) for homepage, product hero, cart, header, mobile viewports; dynamic elements masked |
| `11-accessibility` | WCAG 2.1 AA | axe-core audit on homepage, product, search, collections, cart, contact — no critical/serious violations; image alt text, heading order, color contrast, form labels |
| `12-performance` | Performance API | TTFB < 2 s, DOMContentLoaded < 6 s, full load < 12 s for all key pages; no render-blocking JS/CSS > 2 s; page weight < 10 MB |
| `12-performance` | Lighthouse | Performance ≥ 50, Accessibility ≥ 80, Best Practices ≥ 80, SEO ≥ 85 on homepage, product, collections, search |
| `12-performance` | Core Web Vitals | LCP < 2500 ms; CLS < 0.1; INP < 200 ms via PerformanceObserver — Google ranking signals |
| `12-performance` | Network resilience | Homepage load < 12 s on fast-4G (10 Mbps); DOMContentLoaded < 20 s on slow-3G (1.5 Mbps) via CDP — Chromium only |
| `13-api-mock` | API error handling | Shopify AJAX mocks — cart/add 422/500/network-abort, cart.js empty, search suggest empty/500/abort, product.js malformed JSON, recommendations unavailable, collections 429; page must not crash |
| `14-structured-data` | JSON-LD schemas | Product schema: `name`, `offers.price`, `offers.priceCurrency`, `image`; homepage: WebSite/Organization/Store schema; valid JSON on all pages |
| `14-structured-data` | Open Graph | `og:title`, `og:description`, `og:image` (absolute URL) on homepage; `og:title`, `og:image`, `og:type` on product |
| `14-structured-data` | Technical SEO | Canonical URL present; `sitemap.xml` returns 200 with `<urlset>`; `robots.txt` present and not blocking all crawlers |
| `15-gdpr` | Cookie consent | Banner visible on first visit; does not reappear after accepting; persists across navigation; consent in cookies/localStorage; decline button works |
| `16-dynamic-products` | Dynamic crawling | Fetches live catalogue from `/products.json` (up to 25 handles); per product: HTTP < 400, H1, price, JSON-LD, add-to-cart, hero image |

## E-commerce specifics (17–23)

| File | Suite | What's checked |
|------|-------|----------------|
| `17-checkout` | Checkout flow | Cart shows checkout button; redirect to `/checkout`; URL is HTTPS; no JS errors; email field present; shipping address fields present; express checkout buttons (Apple Pay, Shop Pay, Google Pay) if enabled |
| `18-variants` | Product variants | Variant selector present or single-variant graceful skip; disabled variants have sold-out indicator; selecting variant appends `?variant=ID`; price visible after switch; image swaps on variant with different media; radio inputs keyboard-reachable; select-based dropdowns update price |
| `19-filters` | Filters & sorting | All 5 sort params return a product grid; `sort_by` param preserved in URL; sort dropdown present if rendered; tag filter returns valid page; active filter shows reset link if available; pagination or load-more when product count ≥ 12 |
| `20-security` | Security headers | HTTPS redirect; HSTS with max-age ≥ 15 768 000 s; `X-Content-Type-Options: nosniff`; `X-Frame-Options` or CSP `frame-ancestors`; no mixed content; session cookie `Secure` flag; `SameSite` attribute; no server version; no `X-Powered-By`; `robots.txt` accessible; `/admin` not publicly accessible |
| `20-security` | API key detection | Scans all JS bundles loaded on homepage and product page for `shpat_`, `shppa_`, `sk_live_`, `sk_test_`, `ghp_`, AWS access keys, `private_key` in JSON — both external files and inline `<script>` tags |
| `21-trust` | Trust signals | Payment badge icons visible; refund/return policy link in footer; privacy policy present; contact info accessible; copyright/company text; product mentions shipping; product mentions return/guarantee; reviews section if enabled; social share buttons if enabled |
| `22-newsletter` | Newsletter signup | Email input on homepage; inside a form; empty submit fails validation; invalid email rejected; submit button visible and enabled; GDPR notice near form |
| `23-404` | 404 page | Non-existent URLs return HTTP 404; non-empty body; title matches "not found" / "404"; navigation link back to store; header/logo present; no stack trace, file paths, or `Exception` text; no overflow; no JS errors |

## New suites (25–28)

| File | Suite | What's checked |
|------|-------|----------------|
| `25-discount-codes` | Discount codes | Discount input visible on cart; apply button present and enabled; invalid code shows error or leaves total unchanged; empty submit doesn't crash; valid code (requires `DISCOUNT_CODE` env var) reduces total or shows discount line; `?discount=` checkout URL responds without server error |
| `26-currency-i18n` | Multi-currency & i18n | Currency switcher present; language/locale switcher present; switching currency updates price symbol; price symbols consistent across page; switching locale triggers navigation; currency meta tag is valid ISO 4217; `/localization` endpoint responds |
| `27-cross-sell` | Cross-sell & upsell | Related products section present; contains ≥ 1 product card; cards have valid `/products/` links; current product not in its own recommendations; no broken images; Shopify Recommendations API returns 200 with products array; "Frequently bought together" renders if enabled; cart upsell widget renders if enabled; recommendations found on at least one catalogue product |
| `28-recently-viewed` | Recently viewed | Visiting a product writes to localStorage; entry includes product handle; viewing multiple products accumulates history; widget appears on homepage after product visit; widget appears on product page after history is built; widget contains ≥ 1 product link; no broken images in widget; links point to valid `/products/` URLs; history persists after navigating away; cart page renders without JS errors |
