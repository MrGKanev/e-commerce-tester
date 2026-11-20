'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createClaimsServer } = require('./claims-fixture-server');

test('claims fixtures remain independent while the legacy fixed port is occupied', async t => {
  let legacyRequests = 0;
  const legacy = createServer((_request, response) => {
    legacyRequests++;
    response.end('Unrelated listener');
  });
  await new Promise((resolve, reject) => {
    legacy.once('error', error => (error.code === 'EADDRINUSE' ? resolve() : reject(error)));
    legacy.listen(45994, '127.0.0.1', resolve);
  });
  t.after(async () => {
    if (!legacy.listening) return;
    legacy.closeAllConnections();
    await new Promise(resolve => legacy.close(resolve));
  });
  const shopify = createClaimsServer('shopify');
  const woo = createClaimsServer('woocommerce');
  t.after(() => Promise.all([shopify.close(), woo.close()]));
  const [shopUrl, wooUrl] = await Promise.all([shopify.listen(), woo.listen()]);
  assert.notEqual(new URL(shopUrl).port, '45994');
  assert.notEqual(new URL(wooUrl).port, '45994');
  assert.notEqual(shopUrl, wooUrl);
  await fetch(shopUrl + '/__claims/mode?mode=api-nonempty');
  const cart = await (await fetch(shopUrl + '/cart.js')).json();
  assert.equal(cart.items.length, 1);
  const shopState = await (await fetch(shopUrl + '/__claims/state')).json();
  const wooState = await (await fetch(wooUrl + '/__claims/state')).json();
  assert.deepEqual(shopState, { apiReads: 1, submissions: 0 });
  assert.deepEqual(wooState, { apiReads: 0, submissions: 0 });
  assert.equal(legacyRequests, 0);
});
