# Content checks

[Back to README](../README.md) · [Configuration](CONFIGURATION.md)

## Shared page inventory

`page-inventory.json` in the run directory is shared by product discovery, accessibility, content and inventory visual checks. The base inventory includes home, the two known products, collections, search, cart and explicitly configured static pages.

```json
{
  "inventory": {
    "discoverProducts": false,
    "productLimit": 5,
    "pages": [{ "path": "/policies/privacy-policy", "type": "static", "language": "en" }]
  }
}
```

Additional `/products.json` discovery is opt-in, limited to 1–25 products and cached once during setup. Page records retain URL, type and language. Supported types are `home`, `product`, `collection`, `search`, `cart`, `static`. Unknown policy/contact URLs are not discovered by this inventory builder; separate static-page specs have their own discovery checks.

Additional discovered products run inside inventory scenarios with steps and attachments per URL. Dashboard scenario coverage counts scenarios rather than individual steps/URLs.

## Dictionary spelling

[`tests/spelling.ts`](../tests/spelling.ts) uses local `nspell`, `dictionary-bg` and `dictionary-en`. Text is not sent to a cloud checker. It normalizes Unicode to NFC and segments words with `Intl.Segmenter`.

It reads visible DOM text, including labels, plus `alt`, `title`, `aria-label` and `placeholder`. It skips script/style/template content, hidden/editable regions, input values and textarea text. Nearest HTML `lang` takes precedence over the page fallback language. Latin words in Bulgarian content use the English dictionary; mixed Cyrillic/Latin words are findings.

```json
{
  "spelling": {
    "mode": "report",
    "languages": ["bg", "en"],
    "allowWords": ["MyBrand", "Shop Pay"],
    "acceptedFindings": [],
    "excludeSelectors": [".customer-review"],
    "maxFindings": 0
  }
}
```

| Mode               | Behavior                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `off`              | Disables spelling; dedicated content scenarios are not applicable                                                    |
| `report` (default) | Attaches findings without failing for unknown words                                                                  |
| `strict`           | Fails when unaccepted findings exceed `maxFindings`, languages are unchecked, or OCR words require confidence review |

Technical failures still fail the test in report mode. Unsupported/invalid content languages are recorded explicitly, rather than treated as checked.

`allowWords` accepts terms and phrases, allowing each word in a phrase too. `acceptedFindings` contains reviewed fingerprint IDs from `spelling.json`; it is the per-store baseline mechanism. Review findings before adding IDs or words. There are no `SPELLCHECK_*` settings or separate allowlist/baseline files.

```bash
pnpm test:content
pnpm test:pages
```

Visual specs also audit text before snapshot comparison. Other interaction specs do not automatically audit every transient menu, drawer or validation state; add an explicit `auditSpelling()` call while the state is visible when extending coverage.

## Evidence and deduplication

Each audit attaches JSON with word, language, context, suggestions, source, URL, CSS locator and bounding box. Findings trigger a separate full-page screenshot. OCR confidence omissions also trigger evidence.

The reporter merges findings by normalized text, language, component and word, retaining URLs, sources and locations. A shared header/footer typo is not multiplied across pages or projects. This merges results; it does not cache all repeated DOM dictionary checks. Suggestions are limited to five per word and do not change store content.

## Optional OCR

OCR reads selected visible image/canvas screenshots through a locally installed Tesseract executable. It is disabled by default.

```json
{
  "spelling": {
    "ocr": {
      "enabled": true,
      "selector": "img, canvas",
      "maxImages": 3,
      "minConfidence": 85,
      "tessdataPath": ""
    }
  }
}
```

Install `eng`/`bul` models matching `spelling.languages`. Setup checks availability before store navigation for non-smoke modes; the application does not download models. An empty `tessdataPath` uses the system location. Identical rasters are cached. OCR uses the same dictionaries, allowlist and fingerprints while retaining `ocr` as its source.

Low-confidence words are counted as unchecked. Strict mode requires review rather than treating them as a clean result. Reports include engine version and image/word counts. For Docker installation, see [Running tests](RUNNING.md#docker).

## Limitations

Dictionary spelling does not establish grammar, punctuation, meaning or complete Bulgarian inflection coverage. Names and specialist vocabulary can produce false positives. HTML language declarations and the Latin fallback are heuristics, not language detection.

The audit does not traverse iframe documents. DOM checking cannot read image text without OCR, and OCR may introduce recognition errors. Numeric tokens are skipped; whole URL/email strings do not have dedicated exclusion rules. Only content visible in the audited state is covered.

## Licenses

The project license does not replace dictionary licenses. `nspell` uses MIT; the Bulgarian dictionary has its own `(GPL-2.0 OR LGPL-2.1 OR MPL-1.1)` license. Preserve applicable notices when redistributing dependencies and verify the notices shipped with the installed packages, including `node_modules/dictionary-bg/license` and `node_modules/dictionary-en/license`.

Upstream references: [nspell](https://github.com/wooorm/nspell), [dictionary collection](https://github.com/wooorm/dictionaries), [Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).
