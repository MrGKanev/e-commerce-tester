import http from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import '../tests/01-homepage.spec';
import '../tests/04-product.spec';
import '../tests/14-structured-data.spec';
import '../tests/29-content.spec';
import '../tests/30-inventory-visual.spec';
import '../tests/35-seo-inventory.spec';
import '../tests/38-third-party-scripts.spec';
import '../tests/43-modern-web.spec';
import { test, expect } from '../tests/fixtures';
import { pageCheck } from '../tests/page-check';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { auditModernWebProbes } from '../tests/modern-web-page-audit';

test('pageCheck preserves failures and continues after exceptions and optional skips', async ({}, info) => {
  test.fail(true, 'Independent inspector errors must still fail the enclosing scenario');
  let continued = 0;
  await pageCheck('Inspector exception', async () => {
    throw new Error('owned inspector exception');
  });
  await pageCheck('Non-Error exception', async () => {
    throw undefined;
  });
  await pageCheck('Next check', async () => {
    continued++;
  });
  await pageCheck('Optional component absent', async step => {
    step.skip(true, 'No optional component');
  });
  await pageCheck('After optional component', async () => {
    continued++;
  });
  await info.attach('page-check-contract.json', {
    body: JSON.stringify({ continued }),
    contentType: 'application/json',
  });
  expect(continued).toBe(2);
});

for (const preserve of [false, true])
  test(`page load WebSocket: ${preserve ? 'preserved with active probes skipped' : 'standalone quarantine retained'}`, async ({
    page,
  }, info) => {
    let forwarded = 0;
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><html lang="en"><title>Owned socket</title><body><main><h1>Before socket</h1></main></body></html>',
      );
    });
    const sockets = new Set<Duplex>();
    server.on('upgrade', (request, socket) => {
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
          accept +
          '\r\n\r\n',
      );
      sockets.add(socket);
      // shortcut: one fixed response to the owned client's first frame; use a full
      // server if this fixture needs arbitrary/fragmented messages or close semantics.
      socket.once('data', () => {
        forwarded++;
        socket.write(Buffer.concat([Buffer.from([0x81, 12]), Buffer.from('Owned socket')]));
      });
      socket.on('error', () => {});
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const isolation = await prepareInteractionProbe(page, preserve);
      await page.goto(`http://127.0.0.1:${port}/owned-socket`);
      await page.evaluate(
        async ({ preserve, port }) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}/owned-socket`);
          await new Promise<void>((resolve, reject) => {
            socket.onerror = () => reject(new Error('Owned socket failed'));
            socket.onclose = () => {
              if (!preserve) resolve();
            };
            socket.onopen = () => {
              if (preserve) socket.send('Owned socket');
            };
            socket.onmessage = () => {
              document.querySelector('h1')!.textContent = 'Socket ready';
              resolve();
            };
          });
        },
        { preserve, port },
      );
      if (preserve) {
        await expect(page.locator('h1')).toHaveText('Socket ready');
        await auditModernWebProbes(page, info, isolation);
        expect(info.attachments.some(item => item.name === 'modern-web-probes-skipped.json')).toBe(
          true,
        );
        expect(forwarded).toBe(1);
        expect(isolation.counts().blockedSockets).toBe(0);
        expect(
          await page.evaluate(() =>
            Boolean((window as unknown as { __modernWebProbe?: boolean }).__modernWebProbe),
          ),
        ).toBe(false);
      } else {
        expect(await isolation.freeze()).toBe(true);
        expect(forwarded).toBe(0);
        expect(isolation.counts().blockedSockets).toBe(1);
      }
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
