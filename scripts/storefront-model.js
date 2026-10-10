'use strict';
class CommerceUnverified extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommerceUnverified';
  }
}
const codes = new Set([...Intl.supportedValuesOf('currency'), 'BGN']);
const dollarCurrencies = ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD'];
function monetaryInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}
// Each platform supplies its monetary precision; decimal conversion uses integers.
function decimalMoney(value, precision = 2) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6)
    throw new CommerceUnverified('Unsupported monetary precision');
  const text = String(value).trim();
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(precision, 1)}})?$`).test(text) ||
    (precision === 0 && text.includes('.'))
  )
    throw new CommerceUnverified(`Unsupported decimal price: ${text}`);
  const [whole, fraction = ''] = text.split('.');
  const result =
    BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new CommerceUnverified('Price exceeds safe precision');
  return Number(result);
}
function parseMoney(value, currency, locale = 'en-US', options = {}) {
  const { precision = 2, decimalSeparator } = options;
  if (typeof value !== 'string' || !value.trim())
    throw new CommerceUnverified('No visible price text');
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  let text = value.normalize('NFKC').replace(/[\u200e\u200f\u061c]/g, '');
  if (/[-−]\s*\d/.test(text))
    throw new CommerceUnverified('Negative or ranged UI prices are not supported');
  for (let digit = 0; digit < 10; digit++)
    text = text.replaceAll(digits.format(digit), String(digit));
  if (
    !Object.hasOwn(options, 'precision') &&
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits > precision
  )
    throw new CommerceUnverified(`Currency ${currency} requires a dedicated precision adapter`);
  const explicit = [
    ...new Set((text.toUpperCase().match(/\b[A-Z]{3}\b/g) || []).filter(code => codes.has(code))),
  ];
  for (const code of new Set([currency, 'EUR', 'BGN', 'USD', 'GBP', 'CAD', 'AUD', 'JPY', 'KRW'])) {
    const token = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
      .formatToParts(1)
      .find(part => part.type === 'currency')?.value;
    if (
      token &&
      token.length > 1 &&
      !/^[A-Z]{3}$/.test(token) &&
      !token.includes('$') &&
      text.includes(token)
    )
      explicit.push(code);
  }
  if (/лв\.?/i.test(text)) explicit.push('BGN');
  const symbols = [...new Set(text.match(/[€£$¥₩₹]/g) || [])];
  const symbolCurrencies = {
    '€': ['EUR'],
    '£': ['GBP'],
    $: dollarCurrencies,
    '¥': ['JPY', 'CNY'],
    '₩': ['KRW'],
    '₹': ['INR'],
  };
  const unique = [...new Set(explicit)];
  if (unique.length > 1 || symbols.length > 1)
    throw new CommerceUnverified(
      'Price contains multiple currencies; configure a selector for the active currency',
    );
  const observedCurrency =
    unique[0] ||
    (symbols.length
      ? symbolCurrencies[symbols[0]].includes(currency)
        ? currency
        : symbolCurrencies[symbols[0]][0]
      : currency);
  if (symbols.length && !symbolCurrencies[symbols[0]].includes(observedCurrency))
    throw new Error('Price text has contradictory currency code and symbol');
  const amounts = text.match(/\d(?:[\d.,\u066b\u066c\s'’]*\d)?/g) || [];
  if (amounts.length !== 1)
    throw new CommerceUnverified('Price contains a range or multiple amounts');
  let number = amounts[0].replace(/[\s'’\u066c]/g, '').replaceAll('\u066b', '.');
  const comma = number.lastIndexOf(','),
    dot = number.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    const [whole, fraction] = number.split(decimal);
    if (
      !/^\d{1,3}(?:[.,]\d{3})+$/.test(whole) ||
      precision === 0 ||
      !new RegExp(`^\\d{1,${Math.max(precision, 1)}}$`).test(fraction || '')
    )
      throw new CommerceUnverified('Ambiguous grouped price');
    number = whole.replaceAll(grouping, '') + '.' + fraction;
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.';
    const parts = number.split(separator);
    const localeDecimal =
      decimalSeparator ||
      new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')
        ?.value ||
      '.';
    if (
      parts.length === 2 &&
      parts[1].length <= precision &&
      /^\d+$/.test(parts[1]) &&
      (parts[1].length < 3 || separator === localeDecimal)
    )
      number = parts.join('.');
    else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(number)) number = parts.join('');
    else throw new CommerceUnverified('Unsupported or ambiguous decimal precision');
  }
  return {
    amount: decimalMoney(number, precision),
    currency: observedCurrency,
    currencyEvidence: unique.length
      ? 'code'
      : symbols.length
        ? 'symbol-and-session'
        : 'session-only',
    text: value,
  };
}
function hasType(node, type) {
  return node && (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).includes(type);
}
function schemaPrice(
  schemas,
  product,
  variant,
  currency,
  pageUrl,
  { precision = 2, platform = 'shopify', productUrls = [] } = {},
) {
  const nodes = [],
    visited = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    nodes.push(value);
    Object.values(value).forEach(walk);
  }
  schemas.forEach(walk);
  const reference = value =>
    value && value['@id'] && !value['@type']
      ? nodes.find(node => node['@id'] === value['@id'] && node['@type']) || value
      : value;
  const sameProduct = value => {
    try {
      const target = new URL(value, pageUrl),
        page = new URL(pageUrl);
      const targetPath = decodeURIComponent(target.pathname).replace(/\/$/, '');
      const pagePath = decodeURIComponent(page.pathname).replace(/\/$/, '');
      return (
        target.origin === page.origin &&
        (targetPath === pagePath ||
          (platform === 'shopify' &&
            targetPath.endsWith('/products/' + product.handle) &&
            pagePath.endsWith('/products/' + product.handle)) ||
          productUrls.some(
            value =>
              decodeURIComponent(new URL(value, pageUrl).pathname).replace(/\/$/, '') ===
              targetPath,
          ))
      );
    } catch {
      return false;
    }
  };
  const products = nodes.filter(node => hasType(node, 'Product') || hasType(node, 'ProductGroup'));
  const matches = products.filter(node =>
    node.url ? sameProduct(node.url) : node.name === product.title,
  );
  if (!matches.length)
    throw new CommerceUnverified('No JSON-LD Product can be associated with this product');
  const offers = matches
    .flatMap(node => (Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []))
    .map(reference);
  const matchesVariant = offer => {
    const offered = reference(offer.itemOffered);
    if ((offer.url && !sameProduct(offer.url)) || (offered?.url && !sameProduct(offered.url)))
      return false;
    if (
      variant.sku &&
      product.variants.filter(item => item.sku === variant.sku).length === 1 &&
      [offer.sku, offered?.sku].includes(variant.sku)
    )
      return true;
    try {
      const target = new URL(offer.url || offered?.url || '', pageUrl);
      return sameProduct(target.href) && target.searchParams.get('variant') === String(variant.id);
    } catch {
      return false;
    }
  };
  const qualified = offers.filter(offer => hasType(offer, 'Offer') && matchesVariant(offer));
  const equalPrices = product.price_min === variant.price && product.price_max === variant.price;
  const unqualified = offers.filter(offer => {
    if (!hasType(offer, 'Offer') || offer.sku || offer.itemOffered) return false;
    let query;
    try {
      query = new URL(offer.url || pageUrl, pageUrl).searchParams.get('variant');
    } catch {
      return false;
    }
    return !query && (!offer.url || sameProduct(offer.url));
  });
  const selected = qualified.length
    ? qualified
    : equalPrices && unqualified.length === 1
      ? unqualified
      : [];
  if (selected.length) {
    const values = selected.map(offer => {
      if (!offer.priceCurrency || offer.price === undefined)
        throw new CommerceUnverified('Associated JSON-LD offer lacks price or currency');
      return {
        amount: decimalMoney(offer.price, precision),
        currency: offer.priceCurrency.toUpperCase(),
      };
    });
    if (new Set(values.map(value => JSON.stringify(value))).size !== 1)
      throw new Error('Contradictory JSON-LD offers for the selected variant');
    if (values[0].currency !== currency)
      throw new Error(`JSON-LD currency ${values[0].currency} differs from session ${currency}`);
    if (values[0].amount !== variant.price)
      throw new Error(
        `JSON-LD price ${values[0].amount} differs from variant price ${variant.price}`,
      );
    return { scope: qualified.length ? 'variant' : 'shared-product-price', ...values[0] };
  }
  const ranges = offers.filter(offer => hasType(offer, 'AggregateOffer'));
  if (ranges.length === 1) {
    if (!Number.isSafeInteger(product.price_min) || !Number.isSafeInteger(product.price_max))
      throw new CommerceUnverified('The public product price range is not exposed');
    const offer = ranges[0];
    if (!offer.priceCurrency || offer.lowPrice === undefined || offer.highPrice === undefined)
      throw new CommerceUnverified('AggregateOffer lacks explicit price range or currency');
    const low = decimalMoney(offer.lowPrice, precision),
      high = decimalMoney(offer.highPrice, precision);
    if (
      offer.priceCurrency.toUpperCase() !== currency ||
      low !== product.price_min ||
      high !== product.price_max
    )
      throw new Error(
        `JSON-LD range ${low}–${high} ${offer.priceCurrency} differs from product range ${product.price_min}–${product.price_max} ${currency}`,
      );
    return { scope: 'product-range', low, high, currency };
  }
  throw new CommerceUnverified(
    'JSON-LD offer cannot be uniquely associated with the selected variant',
  );
}

module.exports = { CommerceUnverified, monetaryInteger, decimalMoney, parseMoney, schemaPrice };
