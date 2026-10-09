import { test, expect } from '@playwright/test';
import {
  installWebVitals,
  initWebVitals,
  measureInteraction,
  type VitalsOptions,
} from '../tests/web-vitals';

const options: VitalsOptions = {
  enabled: true,
  mode: 'report',
  afterDomMs: 250,
  minPaintMs: 50,
  maxPaintMs: 1500,
  maxEventMs: 3000,
};
const url = 'http://127.0.0.1:45985/';
const html = (script = '') =>
  `<html><body><h1>Local metrics fixture</h1><div id="content">Visible page content</div><button id="action">Action</button><script>${script}</script></body></html>`;

async function fixture(browser: import('@playwright/test').Browser, body: string) {
  const context = await browser.newContext();
  const session = await installWebVitals(context, options);
  let requests = 0;
  await context.route('**/*', route => {
    if (route.request().isNavigationRequest()) requests++;
    return route.fulfill({ contentType: 'text/html', body });
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { context, session, page, requests: () => requests };
}

test('one normal navigation records nonzero CLS and navigation metrics without another request', async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    html(
      `setTimeout(() => { const banner = document.createElement('div'); banner.style.height='160px'; banner.textContent='Inserted banner'; document.body.prepend(banner); document.body.dataset.shifted='true'; }, 80);`,
    ),
  );
  try {
    await f.page.waitForFunction(() => document.body.dataset.shifted === 'true');
    await f.page.waitForFunction(() => {
      const scope = window as unknown as { __storeVitals: { finish: unknown } };
      return !!scope.__storeVitals;
    });
    // Local sampling window, not a store navigation or artificial page action.
    await f.page.waitForFunction(() => performance.now() >= 350);
    const [doc] = await f.session.flush();
    expect(doc.metrics.cls.status).toBe('measured');
    expect(doc.metrics.cls.value).toBeGreaterThan(0);
    expect(doc.metrics.ttfb.status).toBe('measured');
    expect(doc.activeObservers).toBe(0);
    expect(f.requests()).toBe(1);
  } finally {
    await f.context.close();
  }
});

test('a fully observed stable page can validly have zero CLS', async ({ browser }) => {
  const f = await fixture(browser, html());
  try {
    await f.page.waitForFunction(() => performance.now() >= 350);
    const [doc] = await f.session.flush();
    expect(doc.metrics.cls).toEqual({ status: 'measured', value: 0, reason: null });
    expect(doc.activeObservers).toBe(0);
  } finally {
    await f.context.close();
  }
});

test('unsupported observer APIs report unmeasured, not zero', async ({ browser }) => {
  const context = await browser.newContext();
  const session = await installWebVitals(context, options, false);
  await context.addInitScript(
    ({ source, config }) => {
      Object.defineProperty(PerformanceObserver, 'supportedEntryTypes', { get: () => [] });
      // Combined init script makes API simulation deterministic before instrumentation.
      (0, eval)(`(${source})`)(config);
    },
    { source: initWebVitals.toString(), config: options },
  );
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html() }));
  const page = await context.newPage();
  try {
    await page.goto(url);
    const [doc] = await session.flush();
    expect(doc.metrics.cls.status).toBe('unmeasured');
    expect(doc.metrics.cls.value).toBeNull();
    expect(doc.metrics.lcp.status).toBe('unmeasured');
    expect(doc.metrics.interactionLatency.status).toBe('unmeasured');
  } finally {
    await context.close();
  }
});

test('real named action records event latency separately from ready-state time', async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    html(
      `document.getElementById('action').onclick=()=>{const start=performance.now();while(performance.now()-start<120){}document.body.dataset.done='true';};`,
    ),
  );
  try {
    await measureInteraction(f.page, 'menu open', async () => {
      await f.page.locator('#action').click();
      await expect(f.page.locator('body')).toHaveAttribute('data-done', 'true');
    });
    await f.page.waitForFunction(() => performance.now() >= 450);
    const [doc] = await f.session.flush();
    expect(doc.actions).toHaveLength(1);
    expect(doc.actions[0].latency.status).toBe('measured');
    expect(doc.actions[0].latency.value).toBeGreaterThanOrEqual(96);
    expect(doc.actions[0].outcome).toBe('completed');
    expect(f.requests()).toBe(1);
  } finally {
    await f.context.close();
  }
});

test('multiple ordinary navigations retain earlier documents and close observers', async ({
  browser,
}) => {
  const f = await fixture(browser, html());
  try {
    await f.page.goto(url + 'second');
    const docs = await f.session.flush();
    expect(docs).toHaveLength(2);
    expect(docs.every(doc => doc.activeObservers === 0)).toBe(true);
    expect(f.requests()).toBe(2);
  } finally {
    await f.context.close();
  }
});

test('fast visits remain unmeasured for CLS when the observation window is insufficient', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const session = await installWebVitals(context, {
    ...options,
    minPaintMs: 1000,
    afterDomMs: 1200,
    maxPaintMs: 1500,
  });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html() }));
  const page = await context.newPage();
  try {
    await page.goto(url);
    const [doc] = await session.flush();
    expect(doc.metrics.cls.status).toBe('unmeasured');
    expect(doc.metrics.cls.value).toBeNull();
  } finally {
    await context.close();
  }
});

test('failed operations remain failures and their latency report does not replace the error', async ({
  browser,
}) => {
  const f = await fixture(browser, html());
  try {
    await expect(
      measureInteraction(f.page, 'cart mutation', async () => {
        throw new Error('Cart returned 422');
      }),
    ).rejects.toThrow('Cart returned 422');
    const [doc] = await f.session.flush();
    expect(doc.actions[0].outcome).toBe('failed');
    expect(doc.actions[0].latency.status).toBe('unmeasured');
    expect(f.requests()).toBe(1);
  } finally {
    await f.context.close();
  }
});

test('LCP uses the latest candidate in the bounded window', async ({ browser }) => {
  const f = await fixture(
    browser,
    html(
      `setTimeout(()=>{const text=document.createElement('p');text.style.fontSize='48px';text.textContent='This is a larger late content candidate repeated across the rendered page';document.body.append(text);},90);`,
    ),
  );
  try {
    await f.page.waitForFunction(() => performance.now() >= 350);
    const [doc] = await f.session.flush();
    const lcp = doc.entries.filter(entry => entry.type === 'largest-contentful-paint');
    expect(lcp.length).toBeGreaterThanOrEqual(1);
    expect(doc.metrics.lcp.status).toBe('measured');
    expect(doc.metrics.lcp.value).toBe(lcp.at(-1)!.startTime);
  } finally {
    await f.context.close();
  }
});
