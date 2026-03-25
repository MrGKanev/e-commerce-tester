# Test Cases

Full test coverage reference for the Zerno.co automated health-check suite.

## Original suite (01–09)

| File | Suite | What's checked |
|------|-------|----------------|
| `01-homepage` | Homepage | HTTP 200, title, meta description, canonical, favicon, header, footer, logo, hero section, no JS errors, no failed requests, CSS loaded, fixed-element audit |
| `02-navigation` | Desktop nav | Nav links visible & non-empty, all links respond 200, clicking navigates correctly, dropdown hover, cart icon, search icon |
| `02-navigation` | Footer nav | Link count, all links respond 200, social media links |
| `02-navigation` | Mobile nav | Hamburger visible, menu opens/closes, links visible when open, touch target sizes, no overlay after close, 404 page has header |
| `03-collections` | Collections | `/collections/all` loads, product grid visible, card has name+price+image+link, alt text, no overflow |
| `04-product` | **zerno-z1** | 200, redirect check, title/meta/JSON-LD, H1 visible, price+currency, description, images (loaded+sized+alt+srcset), gallery thumbnails, add-to-cart button (visible+enabled+not covered), quantity selector, variants, breadcrumbs, related products, no overflow, mobile sizing, mobile add-to-cart accessible |
| `04-product` | **zerno-z2** | Same full suite as zerno-z1 |
| `04-product` | First collection product | Loads, add-to-cart triggers visible response |
| `05-cart` | Cart | Cart page loads, empty state, cart link in header, add product, cart shows name & price, quantity increase, remove item, checkout button present & correct |
| `05-cart` | Mobile cart | No overflow, checkout visible on 390 px |
| `06-search` | Search | Icon visible, input appears on click, accepts text, submits & redirects, results for "zerno", no-results for nonsense, no overflow, predictive suggestions |
| `07-mobile` | Overflow | Every key page × 3 viewports (375, 390, 768 px) — overflow detected with culprit elements |
| `07-mobile` | Overlap/z-index | Add-to-cart buttons (z1, z2), checkout, hamburger — `elementFromPoint` check for covering elements; fixed-element audit with overlay detection |
| `07-mobile` | Font sizes | Body ≥ 14 px, description ≥ 14 px, inputs ≥ 16 px (iOS zoom prevention) |
| `07-mobile` | Touch targets | Cart icon, hamburger, add-to-cart all ≥ 40 px |
| `07-mobile` | Images | Product & homepage images don't exceed viewport width |
| `07-mobile` | Sticky header | Visible after 500 px scroll, ≤ 120 px height when sticky, doesn't block product |
| `07-mobile` | Tablet 768 px | No overflow on homepage & product page, nav visible |
| `08-pages` | Static pages | Contact, About, FAQ, Privacy, Terms, Refund, Shipping — reachable, renders content, no overflow |
| `08-pages` | Contact form | Form present, has email input + submit |
| `08-pages` | Policy links | All policy links in footer respond 200 |
| `09-media` | Broken images | No broken images on homepage, collections, zerno-z1, zerno-z2 (with lazy-scroll) |
| `09-media` | Alt text | Images have alt text on homepage & product pages |
| `09-media` | Failed assets | No CSS/JS 4xx errors on key pages |
| `09-media` | Responsive images | Product images use `srcset` |
| `09-media` | Font loading | @font-face declarations present |
| `09-media` | Videos | No failed video assets |

## Extended suite (10–13)

| File | Suite | What's checked |
|------|-------|----------------|
| `10-visual` | Visual regression | Pixel-level snapshot comparison (3 % tolerance) for homepage, product hero, cart, header, mobile viewports; dynamic elements masked |
| `11-accessibility` | WCAG 2.1 AA | axe-core audit on homepage, product, search, collections, cart, contact — no critical/serious violations; image alt text, heading order, color contrast (≤ 5 instances), form labels |
| `12-performance` | Performance API | TTFB < 2 s, DOMContentLoaded < 6 s, full load < 12 s for all key pages; no render-blocking JS/CSS > 2 s; page weight < 10 MB |
| `12-performance` | Lighthouse | Performance ≥ 50, Accessibility ≥ 80, Best Practices ≥ 80, SEO ≥ 85 on homepage, product, collections, search |
| `13-api-mock` | API error handling | Shopify AJAX mocks — cart/add 422/500/network-abort, cart.js empty, search suggest empty/500/abort, product.js malformed JSON, recommendations unavailable, collections 429; page must not crash |

## 2026 additions (12c, 12d, 14–16)

| File | Suite | What's checked |
|------|-------|----------------|
| `12-performance` | **Core Web Vitals** | LCP < 2500 ms (homepage + product); CLS < 0.1 (homepage + product); INP < 200 ms (homepage) via PerformanceObserver `event` entries — Google ranking signals updated March 2024 |
| `12-performance` | **Network Resilience** | Homepage load < 12 s on fast-4G (10 Mbps / 20 ms RTT); DOMContentLoaded < 20 s on slow-3G (1.5 Mbps / 40 ms RTT) via CDP `Network.emulateNetworkConditions` |
| `14-structured-data` | JSON-LD schemas | Product schema: `name`, `offers.price`, `offers.priceCurrency`, `image`; homepage: WebSite/Organization/Store schema; all pages: valid JSON parse — no broken scripts |
| `14-structured-data` | Open Graph | `og:title`, `og:description`, `og:image` (absolute URL) on homepage; `og:title`, `og:image`, `og:type` on product page; `og:title` on collections |
| `14-structured-data` | Technical SEO | Canonical URL present and absolute on product page; `sitemap.xml` returns 200 and contains `<urlset>`/`<sitemapindex>`; `robots.txt` returns 200, has `User-agent`, does not block all crawlers with `Disallow: /` |
| `15-gdpr` | Cookie consent | Banner visible on first visit (fresh context, no cookies); does not reappear after accepting; persists across page navigation; consent recorded in cookies or localStorage; no JS errors during accept flow; decline button hides banner without errors |
| `16-dynamic-products` | Dynamic crawling | Fetches live catalogue from `/products.json` (up to 25 handles, fallback to `KNOWN_PRODUCTS`); checks each product: HTTP < 400, H1 title present, price visible, JSON-LD script present, add-to-cart button found, hero image not broken |
