import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { readSiteSettings } from '../config/site-settings';

export type Metric = {
  status: 'measured' | 'unmeasured';
  value: number | null;
  reason: string | null;
};
export type ActionTiming = {
  id: number;
  label: string;
  start: number;
  end: number | null;
  outcome: string;
  readyElapsedMs: number | null;
  latency: Metric;
};
export type VitalDocument = {
  project?: string;
  scenario?: string;
  id: string;
  url: string;
  synthetic: true;
  final: boolean;
  window: {
    startedAt: number;
    endedAt: number;
    durationMs: number;
    reason: string;
    paintWindowEnded: boolean;
    paintEndedAt: number | null;
    domReadyAt: number | null;
  };
  activeObservers: number;
  metrics: {
    lcp: Metric;
    cls: Metric;
    interactionLatency: Metric;
    ttfb: Metric;
    domContentLoaded: Metric;
    load: Metric;
  };
  actions: ActionTiming[];
  entries: Record<string, unknown>[];
  support: string[];
  resources: { transferBytesLowerBound: number; blocking: { url: string; duration: number }[] };
};
export type VitalsOptions = {
  enabled: boolean;
  mode: 'report' | 'strict';
  afterDomMs: number;
  maxPaintMs: number;
  minPaintMs: number;
  maxEventMs: number;
};

/** Entire function runs in the document before application scripts. No fetches. */
export function initWebVitals(options: VitalsOptions) {
  if (window.top !== window || !options.enabled) return;
  type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
  type EventEntry = PerformanceEntry & {
    interactionId?: number;
    processingStart?: number;
    processingEnd?: number;
    target?: Element;
  };
  type Runtime = {
    finish: (reason: string) => VitalDocument;
    begin: (label: string) => { documentId: string; id: number };
    end: (id: number, outcome: string) => void;
  };
  const scope = window as unknown as {
    __storeVitals?: Runtime;
    __publishStoreVitals?: (report: VitalDocument) => Promise<void>;
  };
  if (scope.__storeVitals) return;
  const id = `${performance.timeOrigin}-${Math.random()}`;
  const visibleAtStart = document.visibilityState === 'visible';
  let endedAt: number | null = null;
  let savedFinal: VitalDocument | null = null;
  const supported =
    typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes || [] : [];
  const active = new Map<string, PerformanceObserver>();
  const failed = new Set<string>();
  const entries: Record<string, unknown>[] = [];
  const events: { id: number; time: number; duration: number }[] = [];
  const actions: (Omit<ActionTiming, 'latency'> & { latency?: Metric })[] = [];
  let lcp: number | null = null,
    cls = 0,
    sessionValue = 0;
  let sessionStart: number | null = null,
    lastShift: number | null = null;
  let domAt: number | null = null,
    paintEnded = false,
    paintEnd = 0;
  let reason = 'active',
    ended = false,
    frameCount = 0,
    firstInput = false;
  let frames = 0;
  const timers: number[] = [];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const missing = (why: string): Metric => ({ status: 'unmeasured', value: null, reason: why });
  const measured = (value: number): Metric => ({
    status: 'measured',
    value: round(value),
    reason: null,
  });
  function consume(type: string, list: PerformanceEntry[]) {
    if (ended) return;
    for (const entry of list) {
      if (entries.length < 1000) {
        const event = entry as EventEntry;
        const shift = entry as Shift;
        entries.push({
          type,
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          interactionId: event.interactionId,
          processingStart: event.processingStart,
          processingEnd: event.processingEnd,
          target: event.target
            ? event.target.tagName.toLowerCase() + (event.target.id ? '#' + event.target.id : '')
            : null,
        });
      }
      if (type === 'largest-contentful-paint' && !paintEnded) lcp = entry.startTime;
      if (type === 'layout-shift' && !paintEnded && !(entry as Shift).hadRecentInput) {
        if (
          sessionStart === null ||
          lastShift === null ||
          entry.startTime - lastShift > 1000 ||
          entry.startTime - sessionStart > 5000
        ) {
          sessionStart = entry.startTime;
          sessionValue = 0;
        }
        lastShift = entry.startTime;
        sessionValue += (entry as Shift).value;
        cls = Math.max(cls, sessionValue);
      }
      if (type === 'event') {
        const event = entry as EventEntry;
        if (event.interactionId && Number.isFinite(event.duration))
          events.push({ id: event.interactionId, time: event.startTime, duration: event.duration });
      }
      // first-input is diagnostic; pointerdown alone is not the full click interaction.
      if (type === 'first-input') firstInput = true;
    }
  }
  function metric(
    type: string,
    value: number | null,
    final: boolean,
    requirePaintWindow = false,
  ): Metric {
    if (!visibleAtStart) return missing('document-started-hidden');
    if (!supported.includes(type) || failed.has(type)) return missing('unsupported-api');
    if (!final) return missing('observation-active');
    if (
      requirePaintWindow &&
      (domAt === null || paintEnd - domAt < options.minPaintMs || frameCount < 2)
    )
      return missing('observation-window-too-short-or-no-render');
    return value === null ? missing('no-entry-observed') : measured(value);
  }
  function actionMetric(action: { start: number; end: number | null }): Metric {
    if (!supported.includes('event') || failed.has('event'))
      return missing('unsupported-event-timing');
    const groups = new Map<number, number>();
    for (const event of events)
      if (event.time >= action.start && (action.end === null || event.time <= action.end)) {
        groups.set(event.id, Math.max(groups.get(event.id) || 0, event.duration));
      }
    return groups.size
      ? measured(Math.max(...groups.values()))
      : missing('no-qualifying-event-observed; events-below-16ms-may-be-filtered');
  }
  function snapshot(final: boolean): VitalDocument {
    if (final && savedFinal) return savedFinal;
    const now = endedAt ?? performance.now();
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as (PerformanceResourceTiming & {
      renderBlockingStatus?: string;
    })[];
    const named = actions.map(action => ({ ...action, latency: actionMetric(action) }));
    const known = named
      .filter(action => action.latency.status === 'measured')
      .map(action => action.latency.value!);
    return {
      id,
      url: location.href,
      synthetic: true,
      final,
      window: {
        startedAt: performance.timeOrigin,
        endedAt: performance.timeOrigin + now,
        durationMs: round(now),
        reason,
        paintWindowEnded: paintEnded,
        paintEndedAt: paintEnded ? performance.timeOrigin + paintEnd : null,
        domReadyAt: domAt === null ? null : performance.timeOrigin + domAt,
      },
      activeObservers: active.size,
      support: [...supported],
      entries: [...entries],
      actions: named,
      metrics: {
        lcp: metric('largest-contentful-paint', lcp, paintEnded || firstInput),
        cls: metric('layout-shift', cls, paintEnded, true),
        interactionLatency: known.length
          ? measured(Math.max(...known))
          : missing(
              supported.includes('event')
                ? 'no-measured-named-interactions'
                : 'unsupported-event-timing',
            ),
        ttfb:
          nav && nav.requestStart > 0 && nav.responseStart >= nav.requestStart
            ? measured(nav.responseStart - nav.requestStart)
            : missing('no-navigation-timing'),
        domContentLoaded: nav?.domContentLoadedEventEnd
          ? measured(nav.domContentLoadedEventEnd)
          : missing('dom-content-loaded-not-observed'),
        load: nav?.loadEventEnd ? measured(nav.loadEventEnd) : missing('load-not-observed'),
      },
      resources: {
        transferBytesLowerBound:
          (nav?.transferSize || 0) + resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        blocking: resources
          .filter(entry => entry.renderBlockingStatus === 'blocking')
          .map(entry => ({ url: entry.name, duration: round(entry.duration) })),
      },
    };
  }
  function publish() {
    // Context destruction can invalidate an in-flight binding; final snapshots are also pulled by Node.
    if (scope.__publishStoreVitals)
      void scope.__publishStoreVitals(snapshot(ended)).catch(() => undefined);
  }
  function drain(types: string[]) {
    for (const type of types) {
      const observer = active.get(type);
      if (observer) consume(type, observer.takeRecords());
    }
  }
  function stopPaint(why: string) {
    if (paintEnded) return;
    drain(['largest-contentful-paint', 'layout-shift']);
    paintEnd = performance.now();
    paintEnded = true;
    reason = why;
    for (const type of ['largest-contentful-paint', 'layout-shift']) {
      active.get(type)?.disconnect();
      active.delete(type);
    }
    publish();
  }
  function finish(why: string) {
    if (!ended) {
      stopPaint(why);
      drain([...active.keys()]);
      for (const observer of active.values()) observer.disconnect();
      active.clear();
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frames);
      ended = true;
      endedAt = performance.now();
      reason = why;
    }
    savedFinal ||= snapshot(true);
    return savedFinal;
  }
  for (const type of ['largest-contentful-paint', 'layout-shift', 'event', 'first-input']) {
    if (!supported.includes(type)) {
      failed.add(type);
      continue;
    }
    try {
      const observer = new PerformanceObserver(list => {
        consume(type, list.getEntries());
        publish();
      });
      observer.observe({
        type,
        buffered: true,
        ...(type === 'event' ? { durationThreshold: 16 } : {}),
      } as PerformanceObserverInit);
      active.set(type, observer);
    } catch {
      failed.add(type);
    }
  }
  function rendered() {
    frameCount++;
    if (frameCount < 2 && !ended) frames = requestAnimationFrame(rendered);
  }
  frames = requestAnimationFrame(rendered);
  function ready() {
    if (ended) return;
    domAt = performance.now();
    timers.push(window.setTimeout(() => stopPaint('post-dom-window'), options.afterDomMs));
    publish();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  timers.push(window.setTimeout(() => stopPaint('max-paint-window'), options.maxPaintMs));
  timers.push(
    window.setTimeout(() => {
      drain(['event', 'first-input']);
      for (const type of ['event', 'first-input']) {
        active.get(type)?.disconnect();
        active.delete(type);
      }
      publish();
    }, options.maxEventMs),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopPaint('document-hidden');
  });
  window.addEventListener(
    'pagehide',
    () => {
      finish('pagehide');
      publish();
    },
    { once: true },
  );
  scope.__storeVitals = {
    finish,
    begin(label) {
      const start = performance.now();
      const action = {
        id: actions.length + 1,
        label,
        start,
        end: null,
        outcome: 'active',
        readyElapsedMs: null,
      };
      actions.push(action);
      return { documentId: id, id: action.id };
    },
    end(actionId, outcome) {
      const action = actions.find(action => action.id === actionId);
      if (action) {
        action.end = performance.now();
        action.outcome = outcome;
        action.readyElapsedMs = round(action.end - action.start);
      }
      publish();
    },
  };
}

const sessions = new WeakMap<BrowserContext, VitalsSession>();
export class VitalsSession {
  records = new Map<string, VitalDocument>();
  private pages = new WeakSet<Page>();
  private patches = new Map<string, { outcome: string; elapsed: number }>();
  constructor(
    readonly context: BrowserContext,
    readonly options: VitalsOptions,
  ) {}
  accept(report: VitalDocument) {
    if (!/^https?:/.test(report.url)) return;
    if (this.records.get(report.id)?.final && !report.final) return;
    for (const action of report.actions) {
      const patch = this.patches.get(report.id + ':' + action.id);
      if (patch) {
        action.outcome = patch.outcome;
        action.readyElapsedMs = patch.elapsed;
      }
    }
    this.records.set(report.id, report);
  }
  patch(documentId: string, actionId: number, outcome: string, elapsed: number) {
    this.patches.set(documentId + ':' + actionId, { outcome, elapsed });
    const report = this.records.get(documentId);
    if (report) this.accept(report);
  }
  async capture(page: Page, reason: string) {
    if (page.isClosed() || !/^https?:/.test(page.url())) return;
    try {
      const report = await page.evaluate(async why => {
        const scope = window as unknown as {
          __storeVitals?: { finish: (reason: string) => VitalDocument };
        };
        if (!scope.__storeVitals) return null;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 100);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timer);
              resolve();
            }),
          );
        });
        return scope.__storeVitals.finish(why);
      }, reason);
      if (report) this.accept(report);
    } catch (error) {
      // Preserve streamed records as explicitly incomplete, rather than inventing a zero.
      for (const report of this.records.values())
        if (report.url === page.url() && !report.final) {
          for (const key of Object.keys(report.metrics) as (keyof VitalDocument['metrics'])[])
            report.metrics[key] = {
              status: 'unmeasured',
              value: null,
              reason: `snapshot-unavailable: ${(error as Error).message}`,
            };
        }
    }
  }
  wire(page: Page) {
    if (this.pages.has(page)) return;
    this.pages.add(page);
    for (const method of ['goto', 'reload', 'goBack', 'goForward'] as const) {
      const original = page[method].bind(page) as (...args: unknown[]) => Promise<unknown>;
      Object.assign(page, {
        [method]: async (...args: unknown[]) => {
          await this.capture(page, 'next-navigation');
          return original(...args);
        },
      });
    }
    const close = page.close.bind(page);
    page.close = async options => {
      await this.capture(page, 'page-close');
      return close(options);
    };
  }
  async flush(reason = 'scenario-end') {
    for (const page of this.context.pages()) await this.capture(page, reason);
    return [...this.records.values()];
  }
}
export async function installWebVitals(
  context: BrowserContext,
  options = readSiteSettings().performanceMetrics,
  inject = true,
) {
  const existing = sessions.get(context);
  if (existing) return existing;
  const session = new VitalsSession(context, options);
  sessions.set(context, session);
  if (!options.enabled) return session;
  await context.exposeBinding('__publishStoreVitals', (_source, report: VitalDocument) =>
    session.accept(report),
  );
  if (inject) await context.addInitScript(initWebVitals, options);
  context.on('page', page => session.wire(page));
  context.pages().forEach(page => session.wire(page));
  const close = context.close.bind(context);
  context.close = async options => {
    try {
      await session.flush('context-close');
    } finally {
      await close(options);
    }
  };
  return session;
}
export async function measureInteraction<T>(
  page: Page,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const session = sessions.get(page.context());
  if (!session || !session.options.enabled) return operation();
  const token = await page.evaluate(
    name =>
      (
        window as unknown as {
          __storeVitals?: { begin: (label: string) => { documentId: string; id: number } };
        }
      ).__storeVitals?.begin(name),
    label,
  );
  const start = Date.now();
  let outcome = 'failed';
  try {
    const result = await operation();
    outcome = 'completed';
    return result;
  } finally {
    if (token) {
      session.patch(token.documentId, token.id, outcome, Date.now() - start);
      try {
        await page.evaluate(
          ({ documentId, id, outcome }) => {
            const scope = window as unknown as {
              __storeVitals?: { end: (id: number, outcome: string) => void };
            };
            if (scope.__storeVitals && String(performance.timeOrigin) === documentId.split('-')[0])
              scope.__storeVitals.end(id, outcome);
          },
          { ...token, outcome },
        );
      } catch {
        /* Navigating operations retain their outcome in the Node checkpoint. */
      }
    }
  }
}
export async function attachWebVitals(sessions: VitalsSession[], testInfo: TestInfo) {
  const documents = (await Promise.all(sessions.map(session => session.flush()))).flat();
  if (!documents.length) return;
  const settings = readSiteSettings();
  for (const document of documents) {
    document.project = testInfo.project.name;
    document.scenario = testInfo.title;
  }
  const budgets = settings.thresholds.webVitals;
  const checks = documents.flatMap(document =>
    (['lcp', 'cls', 'interactionLatency'] as const).map(name => ({
      documentId: document.id,
      url: document.url,
      metric: name,
      ...document.metrics[name],
      assessment:
        document.metrics[name].status !== 'measured'
          ? 'unmeasured'
          : document.metrics[name].value! > budgets[name]
            ? 'over-budget'
            : 'within-budget',
    })),
  );
  await testInfo.attach('web-vitals.json', {
    body: JSON.stringify(
      {
        schemaVersion: 1,
        synthetic: true,
        documents,
        checks,
        pacing: {
          requestDelayMs: process.env.REQUEST_DELAY_MS || 2000,
          requestJitterMs: process.env.REQUEST_JITTER_MS || 2000,
        },
        note: 'Bounded synthetic observations; event latency is not field INP. Pacing may affect loading and operation readiness.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  const unmeasured = checks.filter(check => check.assessment === 'unmeasured');
  if (unmeasured.length)
    testInfo.annotations.push({
      type: 'measurement-unmeasured',
      description: `${unmeasured.length} passive measurements unmeasured; see web-vitals.json`,
    });
  if (settings.performanceMetrics.mode === 'strict' && testInfo.status === 'passed') {
    const issues = checks.filter(check => check.assessment !== 'within-budget');
    if (issues.length)
      throw new Error(
        `Synthetic performance checks need attention: ${issues.map(issue => `${issue.metric}: ${issue.assessment} (${issue.reason || issue.value})`).join('; ')}`,
      );
  }
}
