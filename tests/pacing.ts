import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { APIRequestContext, BrowserContext } from '@playwright/test';

const origin = new URL(process.env.STORE_URL || 'https://zerno.co').origin;
export const RATE_LIMIT_FILE = path.resolve(
  process.env.RATE_LIMIT_DIR || '.',
  `.rate-limit.${process.env.SITE_SLUG || new URL(origin).hostname}.json`,
);

function milliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
  return value;
}

export async function pauseBetweenTests(): Promise<void> {
  await delay(
    milliseconds('TEST_DELAY_MS', 5000) + Math.random() * milliseconds('TEST_JITTER_MS', 3000),
  );
}

// One queue per worker: concurrent navigations/API calls are spaced as well.
let queue = Promise.resolve();
export function paceRequest(): Promise<void> {
  queue = queue.then(async () => {
    assertNotLimited();
    await delay(
      milliseconds('REQUEST_DELAY_MS', 2000) +
        Math.random() * milliseconds('REQUEST_JITTER_MS', 2000),
    );
    assertNotLimited();
  });
  return queue;
}

export function isLimited(): boolean {
  return fs.existsSync(RATE_LIMIT_FILE);
}

export function assertNotLimited(): void {
  if (isLimited())
    throw new Error('Store returned HTTP 429; remaining store requests are stopped. Retry later.');
}

export function recordRateLimit(status: number, url: string, retryAfter: string | null): void {
  if (status !== 429 || new URL(url).origin !== origin) return;
  fs.writeFileSync(
    RATE_LIMIT_FILE,
    JSON.stringify({ url, retryAfter, time: new Date().toISOString() }),
  );
}

const wrapped = new WeakSet<APIRequestContext>();
export function paceAPI(request: APIRequestContext): void {
  if (wrapped.has(request)) return;
  wrapped.add(request);
  // Playwright verbs (get/post/etc.) delegate to fetch; pace each call once.
  const original = request.fetch.bind(request);
  request.fetch = async (...args: Parameters<APIRequestContext['fetch']>) => {
    await paceRequest();
    const response = await original(...args);
    recordRateLimit(response.status(), response.url(), response.headers()['retry-after'] ?? null);
    return response;
  };
}

export async function paceContext(context: BrowserContext): Promise<void> {
  paceAPI(context.request);
  context.on('response', response => {
    recordRateLimit(response.status(), response.url(), response.headers()['retry-after'] ?? null);
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    if (isLimited()) return route.abort('blockedbyclient');
    // Leave static asset loading intact; pace documents and dynamic API requests.
    if (request.isNavigationRequest() || ['xhr', 'fetch'].includes(request.resourceType())) {
      try {
        await paceRequest();
      } catch {
        return route.abort('blockedbyclient');
      }
    }
    await route.fallback();
  });
}
