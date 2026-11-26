'use strict';
const { createServer } = require('node:http');

/** Owned acceptance fixture only: parent binds a dynamic port before starting Playwright. */
function createClaimsServer(platform) {
  let mode = 'good';
  let apiReads = 0;
  let submissions = 0;
  let base = 'http://127.0.0.1';
  const checkoutPath = platform === 'shopify' ? '/en/checkout' : '/wp/pay';
  const cartPath = platform === 'shopify' ? '/en/cart' : '/wp/cart';
  const body = content =>
    `<!doctype html><html><head><meta charset="utf-8"><title>Claims</title></head><body><main>${content}</main><script>window.Shopify={routes:{root:'/en/'}}</script></body></html>`;
  const allFields =
    '<input type="email"><input name="address1"><input name="city"><input name="postalCode"><select name="countryCode"><option>BG</option></select>';
  const server = createServer((req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname === '/__claims/mode' || url.pathname === '/__claims/state') {
      if (url.pathname.endsWith('/mode')) mode = url.searchParams.get('mode') || 'good';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ apiReads, submissions }));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname.endsWith('/cart.js') || url.pathname.endsWith('/wc/store/v1/cart')) {
      apiReads++;
      if (mode === 'api-blocked') {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cart-Token', 'private-fixture-token');
      res.end(JSON.stringify({ items: mode === 'api-nonempty' ? [{ id: 1, quantity: 1 }] : [] }));
      return;
    }
    if (
      url.pathname.endsWith('/cart/clear.js') ||
      (url.pathname.endsWith('/cart/items') && req.method === 'DELETE')
    ) {
      res.setHeader('Content-Type', 'application/json');
      res.end(req.method === 'DELETE' ? '[]' : '{"items":[]}');
      return;
    }
    if (req.method !== 'GET') submissions++;
    if (url.pathname === cartPath || url.pathname === '/cart') {
      const indication =
        mode === 'form-only' || mode === 'header-empty'
          ? '<form class="cart-form"></form>'
          : mode === 'hidden-empty'
            ? '<p class="cart-empty" hidden>Your cart is empty</p>'
            : '<p class="cart-empty">Your cart is empty</p>';
      const stale =
        mode === 'stale-row' ? '<div class="cart-item" data-woo-cart-item>Product 1</div>' : '';
      const href = mode === 'query-only' ? cartPath + '?redirect=checkout' : checkoutPath;
      res.end(
        body(
          `<h1>Cart</h1>${indication}${stale}<a class="checkout-button" href="${href}">Checkout</a>`,
        ).replace(
          '<main>',
          mode === 'header-empty'
            ? '<header><p class="cart-empty">Your cart is empty</p></header><main>'
            : '<main>',
        ),
      );
      return;
    }
    if (url.pathname === checkoutPath) {
      if (mode === 'http-error' || mode === 'blocked') {
        res.statusCode = mode === 'blocked' ? 403 : 500;
        res.end(body('Access denied'));
        return;
      }
      let fields = mode === 'missing' ? '' : allFields;
      if (mode === 'hidden-email') fields = fields.replace('type="email"', 'type="email" hidden');
      if (mode === 'disabled-email')
        fields = fields.replace('type="email"', 'type="email" disabled');
      if (mode === 'missing-city') fields = fields.replace('<input name="city">', '');
      if (mode === 'country-no-postcode') fields = fields.replace('<input name="postalCode">', '');
      if (mode === 'custom') fields = '<input id="custom-contact"><input id="custom-street">';
      const root =
        mode === 'unknown'
          ? '<div>Login required</div><footer><input type="email"></footer>'
          : `<form data-checkout-root>${fields}</form>`;
      res.end(body(`<h1>Checkout</h1>${root}`));
      return;
    }
    res.statusCode = 404;
    res.end(body('Missing'));
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      base = `http://127.0.0.1:${server.address().port}`;
      return base;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    },
  };
}
module.exports = { createClaimsServer };
