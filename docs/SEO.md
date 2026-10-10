# SEO inventory

`pnpm test:seo --site=<slug>` изпълнява `35-seo-inventory` за Shopify и WooCommerce. Проверката влиза и в режимите `full` и `pages`, за desktop и mobile browser projects.

Използва подготвеното `page-inventory.json`: начална страница, зададените продукти, каталог, search, cart, допълнителните `inventory.pages` и продуктите от включено `inventory.discoverProducts`. Не обхожда автоматично всички линкове в сайта; обхватът е ограничен от конфигурацията и `productLimit`.

Проверява крайния документ след навигация и показване на съдържанието. Източниците са публичният rendered DOM и HTTP `X-Robots-Tag`, без административни API, промени на количката или поръчки. Не създава собствени изображения; общата Playwright настройка за screenshot при грешка остава приложима.

Грешки, които провалят теста:

- HTTP грешки или неуспешна навигация.
- Липсващо, празно или повече от едно заглавие.
- Липсваща, празна или повече от една description за индексируема страница.
- Липсващ canonical за индексируема страница, множество canonical-и или невалиден/относителен canonical URL.
- Невалиден JSON синтаксис или корен от скаларна стойност в JSON-LD.
- Canonical към друга вече проверена страница с HTTP грешка или `noindex`.

Предупреждения за човешки преглед:

- Canonical, различен от крайния URL; това може да е умишлено за варианти и филтри.
- `og:url`, различен от canonical.
- URL на JSON-LD Product/WebPage, различен по домейн или път от canonical. Query за вариант не се третира като разминаване.
- Product name, различен от единствения видим H1. Свързани продукти и различно форматиране могат да обяснят предупреждението.
- Липсващ или множество видими H1.
- Еднакви title/description между различни canonical страници. Алтернативни URL-и с общ canonical се изключват.
- Canonical верига между вече проверени страници.

Cart, search и страниците с изричен `noindex`/`none` не изискват description и canonical като индексируемите страници. `noindex` се записва в отчета като информация; не можем да знаем дали е умишлен без зададена политика за конкретната страница. Невалиден JSON-LD и дублиран canonical се проверяват и там.

За всеки browser project HTML отчетът съдържа attachment `seo-inventory.json`: проверените URL-и, HTTP статуси, прочетените metadata/JSON-LD, грешките и предупрежденията. Проверката продължава след проблем на отделна страница; спира при общия механизъм за rate limit. Canonical цели извън провереното inventory не получават допълнителни заявки.

Това е техническа проверка на наличните данни, не пълна Schema.org или Google Rich Results валидация. Цените и наличността на конкретни варианти се проверяват от отделните commerce тестове. Не доказва как Google е индексирал сайта.

Локална валидация без реален магазин: `pnpm test:seo:local`.

Официални насоки: [Canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Robots metadata](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [Structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
