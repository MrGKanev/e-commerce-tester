'use strict';
const http = require('node:http');
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/products.json') return response.end(JSON.stringify({ products: [{ id: 1 }, { id: 2 }] }));
  if (url.pathname === '/cart.js') return response.end(JSON.stringify({ currency: 'BGN' }));
  if (url.pathname === '/wp-json/wc/store/v1/products') return response.end(JSON.stringify([{ id: 1, prices: { currency_code: 'BGN' } }, { id: 2, prices: { currency_code: 'BGN' } }]));
  if (url.pathname === '/tracker.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end('window.fixtureTracker = true;'); }
  response.setHeader('Content-Type', 'text/html');
  response.end('<html lang="en"><title>Local monitoring fixture</title><body><main><h1>Fixture store</h1><button id="payment">Pay by fixture</button></main><script src="http://localhost:45994/tracker.js?version=1"></script></body></html>');
}).listen(45994);
