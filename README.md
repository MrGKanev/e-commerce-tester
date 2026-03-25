# Zerno.co — Automated Store Health Check

Automated weekly health-check system for [zerno.co](https://zerno.co), built with [Playwright](https://playwright.dev).

## What we built and why

Изградихме автоматизирана система за седмична проверка на здравето на Shopify магазин, която симулира реален потребител и валидира всеки критичен аспект — от заредени изображения до GDPR съответствие. Тестовете са организирани в 16 файла с нарастваща сложност: основни проверки на страниците (01–09), разширено покритие с достъпност, производителност и API грешки (10–13), и 2026 допълнения, насочени към актуалните Google ranking сигнали и регулаторни изисквания (14–16). В 2026 добавихме Core Web Vitals (LCP, CLS, INP), тъй като INP замени FID като официален Google метрик от март 2024, а LCP и CLS директно влияят на позициите в търсачката. Добавихме и structured data валидация (JSON-LD + OG тагове), защото богатите резултати в Google изискват точна Product схема с `name`, `offers` и `image` полета. Накрая въведохме динамично crawling на продукти от `/products.json` и GDPR тестове, за да не разчитаме на хардкодиран списък и да гарантираме, че cookie consent механизмът работи коректно при всяко ново посещение.

**Какво тестваме:**
- Функционалност — homepage, навигация, колекции, продуктови страници, количка, търсене, статични страници
- Responsive design — overflow, z-index, touch targets, font sizes на 3 viewport-а (375 / 390 / 768 px)
- Медия — счупени изображения, alt текст, srcset, шрифтове, видео assets
- Visual regression — pixel-level snapshot сравнения с 3 % tolerance
- Достъпност — WCAG 2.1 AA чрез axe-core на всички ключови страници
- Производителност — TTFB, DOMContentLoaded, Lighthouse (≥ 50 / 80 / 80 / 85), Core Web Vitals (LCP / CLS / INP), network throttling
- Structured data — Product JSON-LD, Open Graph тагове, canonical URL, sitemap.xml, robots.txt
- API error handling — Shopify AJAX мокове (422, 500, network abort, malformed JSON)
- GDPR / Cookie consent — поведение при first visit, persistence, storage валидация
- Динамично покритие — live каталог от `/products.json` (до 25 продукта), fallback към `KNOWN_PRODUCTS`

**Пълен списък с тест кейсове:** вижте [TESTS.md](TESTS.md)

---

## Setup (first time)

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Install Chromium (only needed once)
npm run install:browsers
```

---

## Running the tests

```bash
# Headless (recommended for weekly checks)
npm test

# Watch the browser while testing
npm run test:headed

# Debug mode (step through tests)
npm run test:debug
```

### Output after each run

```
reports/
├── history.html                  ← cumulative dashboard (all runs)
└── 2024-01-15_10-30/
    ├── index.html                ← HTML report with all screenshots
    ├── results.json              ← machine-readable results
    └── screenshots/              ← one screenshot per test
```

Open the detailed report:
```bash
npx playwright show-report reports/2024-01-15_10-30
```

Open the history dashboard:
```bash
npm run history
# or: open reports/history.html
```

---

## Weekly cron schedule (Mac)

```bash
crontab -e
```

Add (adjust path):
```
0 9 * * 1 cd /path/to/e-commerce-tester && npm test >> reports/cron.log 2>&1
```

---

## Project structure

```
e-commerce-tester/
├── tests/
│   ├── helpers.ts                  shared selectors, utilities, fetchProductHandles()
│   ├── 01-homepage.spec.ts
│   ├── 02-navigation.spec.ts       desktop + mobile nav
│   ├── 03-collections.spec.ts
│   ├── 04-product.spec.ts          zerno-z1, zerno-z2, generic
│   ├── 05-cart.spec.ts
│   ├── 06-search.spec.ts
│   ├── 07-mobile.spec.ts           overflow, z-index, touch targets
│   ├── 08-pages.spec.ts
│   ├── 09-media.spec.ts
│   ├── 10-visual.spec.ts           visual regression snapshots
│   ├── 11-accessibility.spec.ts    axe-core WCAG 2.1 AA
│   ├── 12-performance.spec.ts      Lighthouse, CWV, network throttling
│   ├── 13-api-mock.spec.ts         Shopify AJAX error mocks
│   ├── 14-structured-data.spec.ts  JSON-LD, Open Graph, sitemap, robots.txt
│   ├── 15-gdpr.spec.ts             cookie consent UX & persistence
│   └── 16-dynamic-products.spec.ts live product crawling via /products.json
├── scripts/
│   └── update-history.js           generates reports/history.html
├── reports/                        auto-generated, gitignored
├── playwright.config.ts
├── run.sh
├── TESTS.md                        full test case reference
└── package.json
```
