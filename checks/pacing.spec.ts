import { expect } from '@playwright/test';
import { test } from '../tests/fixtures';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import { RATE_LIMIT_FILE, paceAPI, paceContext, isLimited } from '../tests/pacing';

let server: Server;
const requests: number[] = [];
const origin = process.env.STORE_URL!;

test.beforeAll(async () => {
  fs.rmSync(RATE_LIMIT_FILE, { force: true });
  server = createServer((req, res) => {
    requests.push(Date.now());
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/limited') {
      res.statusCode = 429;
      res.setHeader('Retry-After', '60');
    }
    res.end('<html><title>Local pacing test</title></html>');
  });
  await new Promise<void>(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
});

test.afterAll(async () => {
  fs.rmSync(RATE_LIMIT_FILE, { force: true });
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('paces direct browser navigations and API get/post calls', async ({ browser, request }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await paceContext(context);
    const page = await context.newPage();
    await page.goto(origin);
    await page.goto(`${origin}/second`);
    paceAPI(request);
    await request.get(origin);
    await context.request.post(origin);
    expect(requests.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < requests.length; i++) {
      expect(requests[i] - requests[i - 1]).toBeGreaterThanOrEqual(50);
    }
  } finally { await context.close(); }
});

test('shared fixture also paces pages created by Playwright', async ({ page }) => {
  const count = requests.length;
  await page.goto(origin);
  expect(requests.length).toBeGreaterThan(count);
});

test('records Retry-After and blocks requests after HTTP 429', async ({ browser, request }) => {
  test.fail(true, 'The automatic guard must mark a rate-limited test as failed');
  paceAPI(request);
  await request.get(`${origin}/limited`);
  expect(isLimited()).toBe(true);
  expect(JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf8')).retryAfter).toBe('60');
  const count = requests.length;
  await expect(request.post(origin)).rejects.toThrow('HTTP 429');
  const context = await browser.newContext();
  try {
    await paceContext(context);
    const page = await context.newPage();
    await expect(page.goto(origin)).rejects.toThrow();
    expect(requests.length).toBe(count);
  } finally { await context.close(); }
});


test('shared fixture skips further tests after 429', async ({ page }) => {
  await page.goto(origin);
  throw new Error('This test must be skipped before sending a request');
});
