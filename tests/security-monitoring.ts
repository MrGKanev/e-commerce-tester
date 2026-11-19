import { startCspObservation } from './security-csp';
import type { BrowserContext, Page, Request, Response } from '@playwright/test';
import type { SecuritySettings } from '../config/site-settings';
import {
  hash,
  identity,
  compare,
  type Scope,
  type Stage,
  type Script,
  type Destination,
  type Payment,
  type Finding,
  type Baseline,
} from '../scripts/security-model';

/** Observe actual responses only. Never refetch assets or capture request/WS payloads. */
export async function startSecurityObservation(context: BrowserContext, config: SecuritySettings) {
  const startedAt = new Map<string, number>([['initial', Date.now()]]);
  let phase = 'initial',
    closed = false,
    requests = 0,
    totalBytes = 0,
    scriptSlots = 0;
  const csp = await startCspObservation(context, () => phase);
  const records: Array<{ phase: string; script: Script }> = [];
  const destinations: Array<{ phase: string; destination: Destination }> = [];
  const requestInfo = new Map<
    Request,
    { phase: string; context: string; identity: ReturnType<typeof identity> }
  >();
  const tasks = new Set<Promise<void>>();
  const responded = new Set<Request>();
  const flags = new Map<string, Set<string>>();
  const workers: Array<{ phase: string; origin: string; urlHash: string; opaque: boolean }> = [];
  const pages = new Set<Page>();
  const sockets: Array<{
    page: Page;
    listen: (socket: import('@playwright/test').WebSocket) => void;
    worker: (worker: import('@playwright/test').Worker) => void;
  }> = [];
  const flag = (stage: string, reason: string) => {
    if (!flags.has(stage)) flags.set(stage, new Set());
    flags.get(stage)!.add(reason);
  };
  const location = (request: Request) => {
    try {
      const frame = request.frame();
      return frame.parentFrame()
        ? `frame:${hash(identity(frame.url()).origin + identity(frame.url()).pathHash)}`
        : 'main';
    } catch {
      return 'worker-or-unknown';
    }
  };
  const destination = (
    url: string,
    type: string,
    method: string,
    source: string,
    stage = phase,
  ) => {
    if (closed) return;
    if (++requests > config.limits.requests) {
      flag(stage, 'request-limit');
      return;
    }
    const id = identity(url);
    destinations.push({
      phase: stage,
      destination: {
        key: `${type}:${method}:${id.origin}:${source.split(':')[0]}`,
        origin: id.origin,
        type,
        method,
        context: source,
        urlHash: id.urlHash,
      },
    });
  };
  const onRequest = (request: Request) => {
    if (closed) return;
    const source = location(request),
      id = identity(request.url());
    destination(request.url(), request.resourceType(), request.method(), source);
    if (requestInfo.size >= config.limits.requests) {
      flag(phase, 'request-limit');
      return;
    }
    requestInfo.set(request, { phase, context: source, identity: id });
  };
  const responseTask = async (response: Response) => {
    const request = response.request(),
      meta = requestInfo.get(request);
    if (!meta || closed) return;
    responded.add(request);
    if (request.isNavigationRequest() && response.status() >= 400)
      flag(meta.phase, 'document-http-error');
    const mime = response.headers()['content-type'] || '';
    if (request.resourceType() !== 'script' && !/(?:java|ecma)script/i.test(mime)) return;
    if (response.status() >= 300 && response.status() < 400) return; // Redirect hops are destinations, not executable bodies.
    if (scriptSlots++ >= config.limits.scripts) {
      flag(meta.phase, 'script-limit');
      return;
    }
    const script: Script = {
      key: `external:${meta.identity.origin}:${meta.identity.pathHash}:${meta.context}`,
      kind: 'external-response',
      context: meta.context,
      origin: meta.identity.origin,
      urlHash: meta.identity.urlHash,
      status: 'pending',
      statusCode: response.status(),
    };
    const previous = request.redirectedFrom();
    if (previous) script.redirectFromHash = hash(previous.url());
    records.push({ phase: meta.phase, script });
    const length = Number(response.headers()['content-length']);
    if (response.status() >= 400) {
      script.status = 'unavailable';
      flag(meta.phase, 'script-http-error');
      return;
    }
    if (
      length > config.limits.scriptBytes ||
      (Number.isFinite(length) &&
        length > 0 &&
        totalBytes + length > config.limits.totalScriptBytes)
    ) {
      script.status = 'oversized';
      flag(meta.phase, 'script-byte-limit');
      return;
    }
    try {
      const bytes = await response.body();
      if (closed) return;
      if (
        bytes.length > config.limits.scriptBytes ||
        totalBytes + bytes.length > config.limits.totalScriptBytes
      ) {
        script.status = 'oversized';
        flag(meta.phase, 'script-byte-limit');
        return;
      }
      totalBytes += bytes.length;
      script.bytes = bytes.length;
      script.sha256 = hash(bytes);
      script.status = 'hashed';
    } catch {
      if (!closed) {
        script.status = 'unavailable';
        flag(meta.phase, 'script-body-unavailable');
      }
    }
  };
  const onResponse = (response: Response) => {
    const task = responseTask(response).catch(() => flag(phase, 'response-inspection-unavailable'));
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };
  const onFailed = (request: Request) => {
    const meta = requestInfo.get(request);
    responded.add(request);
    if (meta && request.resourceType() === 'script') {
      flag(meta.phase, 'script-request-failed');
      if (scriptSlots++ < config.limits.scripts)
        records.push({
          phase: meta.phase,
          script: {
            key: `external:${meta.identity.origin}:${meta.identity.pathHash}:${meta.context}`,
            kind: 'external-response',
            context: meta.context,
            origin: meta.identity.origin,
            urlHash: meta.identity.urlHash,
            status: 'unavailable',
          },
        });
    }
  };
  const watchPage = (page: Page) => {
    pages.add(page);
    const listen = (socket: import('@playwright/test').WebSocket) =>
      destination(socket.url(), 'websocket', 'CONNECT', 'page-websocket');
    const worker = (worker: import('@playwright/test').Worker) => {
      const id = identity(worker.url());
      if (workers.length < config.limits.scripts)
        workers.push({
          phase,
          origin: id.origin,
          urlHash: id.urlHash,
          opaque: !/^https?:/.test(worker.url()),
        });
      else flag(phase, 'worker-limit');
      if (!/^https?:/.test(worker.url())) flag(phase, 'opaque-worker-code-unavailable');
    };
    page.on('websocket', listen);
    page.on('worker', worker);
    sockets.push({ page, listen, worker });
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  context.on('requestfailed', onFailed);
  context.on('page', watchPage);
  context.pages().forEach(watchPage);
  return {
    setPhase(value: string) {
      phase = value;
      startedAt.set(value, Date.now());
    },
    async snapshot(
      scope: Scope,
      page: Page,
      documentOk: boolean,
      baseline?: Baseline,
    ): Promise<Stage> {
      // Bounded drain. Unfinished bodies remain explicitly pending in this stage.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...tasks]),
        new Promise(resolve => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      const stage = scope.stage;
      for (const [request, meta] of requestInfo)
        if (meta.phase === stage && request.resourceType() === 'script' && !responded.has(request))
          flag(stage, 'script-response-pending');
      const scripts = structuredClone(
        records.filter(item => item.phase === stage).map(item => item.script),
      );
      const payment: Payment = {
        documents: [],
        forms: [],
        formActions: [],
        frames: [],
        cardFields: 0,
        overlayCardFields: 0,
        sampleTruncated: false,
        framesInspected: 0,
      };
      const inspectedPages = [...pages].slice(0, 5);
      if (pages.size > 5) flag(stage, 'page-limit');
      let inlineSlots = scripts.length;
      for (const currentPage of inspectedPages) {
        if (currentPage.isClosed()) {
          flag(stage, 'closed-page-unavailable');
          continue;
        }
        payment.documents.push(identity(currentPage.url()).origin);
        for (const frame of currentPage.frames()) {
          if (payment.framesInspected >= config.limits.frames) {
            flag(stage, 'frame-limit');
            payment.sampleTruncated = true;
            break;
          }
          payment.framesInspected++;
          if (!(await csp.frameAvailable(frame))) {
            flag(stage, 'csp-listener-unavailable');
            continue;
          }
          const id = identity(frame.url()),
            source = frame.parentFrame() ? `frame:${hash(id.origin + id.pathHash)}` : 'main';
          try {
            const sample = await frame.evaluate(
              ({ limit, bytes }) => {
                const executable = (script: HTMLScriptElement) => {
                  const type = (script.type || '').trim().toLowerCase();
                  return (
                    !script.src &&
                    (!type ||
                      type === 'module' ||
                      /^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:\s*;.*)?$/.test(type))
                  );
                };
                const all = [...document.querySelectorAll<HTMLScriptElement>('script')].filter(
                  executable,
                );
                const inline = all.slice(0, limit).map((script, index) => ({
                  index,
                  tooLarge: (script.textContent || '').length > bytes,
                  text: (script.textContent || '').slice(0, bytes + 1),
                }));
                const visible = (el: Element) => {
                  for (let node: Element | null = el; node; node = node.parentElement) {
                    const s = getComputedStyle(node);
                    if (
                      node.matches('[hidden],[inert],[aria-hidden="true"]') ||
                      s.display === 'none' ||
                      s.visibility !== 'visible' ||
                      s.contentVisibility === 'hidden'
                    )
                      return false;
                  }
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                };
                const allForms = [...document.forms],
                  allFrames = [...document.querySelectorAll<HTMLIFrameElement>('iframe')];
                const fields = [
                  ...document.querySelectorAll(
                    'input[autocomplete~="cc-number"],input[autocomplete~="cc-csc"],input[autocomplete~="cc-exp"],input[autocomplete~="cc-exp-month"],input[autocomplete~="cc-exp-year"]',
                  ),
                ].filter(visible);
                const origins = (value: string) => {
                  try {
                    return new URL(value, document.baseURI).origin;
                  } catch {
                    return 'unresolved';
                  }
                };
                return {
                  inline,
                  inlineTruncated: all.length > limit,
                  forms: allForms.slice(0, 100).map(form => origins(form.action)),
                  formActions: allForms.slice(0, 100).map(form => {
                    try {
                      const url = new URL(form.action, document.baseURI);
                      return { origin: url.origin, path: url.pathname };
                    } catch {
                      return { origin: 'unresolved', path: '' };
                    }
                  }),
                  frames: allFrames.slice(0, 100).map(frame => origins(frame.src || 'about:blank')),
                  cardFields: fields.length,
                  overlayCardFields: fields.filter(field => {
                    for (let el: Element | null = field; el; el = el.parentElement)
                      if (
                        el.matches('dialog,[role="dialog"]') ||
                        getComputedStyle(el).position === 'fixed'
                      )
                        return true;
                    return false;
                  }).length,
                  domTruncated: allForms.length > 100 || allFrames.length > 100,
                };
              },
              {
                limit: Math.max(0, config.limits.scripts - inlineSlots),
                bytes: config.limits.scriptBytes,
              },
            );
            if (sample.inlineTruncated) {
              flag(stage, 'inline-script-limit');
              payment.sampleTruncated = true;
            }
            for (const inline of sample.inline) {
              inlineSlots++;
              const bytes = Buffer.byteLength(inline.text);
              const script: Script = {
                key: `inline:${source}:${inline.index}`,
                kind: 'inline-snapshot',
                context: source,
                origin: id.origin,
                urlHash: id.urlHash,
                status: 'hashed',
              };
              if (
                inline.tooLarge ||
                bytes > config.limits.scriptBytes ||
                totalBytes + bytes > config.limits.totalScriptBytes
              ) {
                script.status = 'oversized';
                flag(stage, 'script-byte-limit');
              } else {
                script.sha256 = hash(inline.text);
                script.bytes = bytes;
                totalBytes += bytes;
              }
              scripts.push(script);
            }
            payment.forms.push(...sample.forms);
            payment.formActions.push(
              ...sample.formActions.map(action => action.origin + ':' + hash(action.path)),
            );
            payment.frames.push(...sample.frames);
            if (!frame.parentFrame()) {
              payment.cardFields += sample.cardFields;
              payment.overlayCardFields += sample.overlayCardFields;
            }
            if (sample.domTruncated) {
              payment.sampleTruncated = true;
              flag(stage, 'payment-dom-limit');
            }
          } catch {
            flag(stage, 'frame-dom-unavailable');
          }
        }
      }
      if (scripts.some(script => script.status !== 'hashed'))
        flag(stage, 'script-evidence-incomplete');
      if (!documentOk) flag(stage, 'document-unavailable');
      for (const worker of workers.filter(worker => worker.phase === stage))
        if (
          !scripts.some(script => script.urlHash === worker.urlHash && script.status === 'hashed')
        )
          flag(stage, 'worker-response-unavailable');
      const policy = csp.snapshot(stage);
      if (policy.truncated) flag(stage, 'csp-event-limit');
      const incomplete = [...(flags.get(stage) || [])];
      const findings: Finding[] = [];
      const add = (
        rule: string,
        evidence: Record<string, unknown>,
        severity: 'warning' | 'high' = 'warning',
      ) => findings.push({ rule, severity, evidence });
      for (const event of policy.events)
        add(
          event.disposition === 'report'
            ? 'security-csp-report-only-violation'
            : 'security-csp-violation',
          { ...event, enforcementObserved: event.disposition === 'enforce' },
        );
      const contract = config.payment;
      if (scope.role === 'checkout') {
        if (
          !contract.checkoutOrigins.length ||
          !contract.formOrigins.length ||
          !contract.frameOrigins.length ||
          contract.allowTopDocumentCardFields === null
        )
          add('security-payment-contract-unconfigured', { explicit: false });
        if (
          contract.checkoutOrigins.length &&
          !contract.checkoutOrigins.includes(identity(page.url()).origin)
        )
          add('security-checkout-origin', { origin: identity(page.url()).origin }, 'high');
        for (const [kind, observed, allowed] of [
          ['form', payment.forms, contract.formOrigins],
          ['frame', payment.frames, contract.frameOrigins],
        ] as const)
          if (allowed.length)
            for (const origin of [...new Set(observed)])
              if (!allowed.includes(origin))
                add(
                  `security-payment-${kind}-origin`,
                  { origin, paymentPurposeUnverified: kind === 'frame' },
                  'high',
                );
        if (contract.allowTopDocumentCardFields === false && payment.cardFields)
          add(
            'security-top-document-card-fields',
            { count: payment.cardFields, overlayCount: payment.overlayCardFields },
            'high',
          );
      }
      const result: Stage = {
        scope,
        scripts,
        destinations: [
          ...new Map(
            destinations
              .filter(item => item.phase === stage)
              .map(item => [item.destination.key, item.destination]),
          ).values(),
        ],
        payment,
        policy,
        coverage: {
          complete: incomplete.length === 0,
          incomplete,
          documentOk: documentOk && !incomplete.includes('document-http-error'),
          totalScriptBytes: totalBytes,
          observedWorkers: workers.filter(worker => worker.phase === stage),
          configuredObserveMs: config.observeMs,
          actualElapsedMs: Date.now() - (startedAt.get(stage) || Date.now()),
        },
        findings,
        status: 'unverified',
      };
      result.findings.push(...compare(result, baseline));
      result.status = !result.coverage.complete
        ? 'unverified'
        : result.findings.length
          ? 'needs-review'
          : 'matches-baseline';
      return result;
    },
    async stop() {
      closed = true;
      context.off('request', onRequest);
      context.off('response', onResponse);
      context.off('requestfailed', onFailed);
      context.off('page', watchPage);
      for (const { page, listen, worker } of sockets) {
        page.off('websocket', listen);
        page.off('worker', worker);
      }
      await csp.stop();
    },
  };
}

export async function observeSecurityScenario(
  page: Page,
  config: SecuritySettings,
  scope: Omit<Scope, 'stage'>,
  url: string,
  baseline?: Baseline,
) {
  const observer = await startSecurityObservation(page.context(), config);
  const stages: Stage[] = [];
  const record = (stage: Stage) => {
    if (scope.role === 'storefront' && identity(page.url()).origin !== identity(url).origin) {
      stage.findings.push({
        rule: 'security-storefront-origin',
        severity: 'high',
        evidence: { origin: identity(page.url()).origin },
      });
      if (stage.coverage.complete) stage.status = 'needs-review';
    }
    stages.push(stage);
  };
  let documentOk = false;
  try {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      documentOk = Boolean(response && response.status() < 400);
    } catch {
      /* Record a generic incomplete stage without copying a sensitive URL/error message. */
    }
    // eslint-disable-next-line playwright/no-wait-for-timeout -- Explicit configured security observation window, not a readiness wait.
    await page.waitForTimeout(config.observeMs);
    record(await observer.snapshot({ ...scope, stage: 'initial' }, page, documentOk, baseline));
    if (scope.choice !== 'initial' && documentOk) {
      const selector =
        scope.choice === 'accept' ? config.consent.acceptSelector : config.consent.rejectSelector;
      const control = page.locator(selector!).filter({ visible: true });
      let safe = false;
      try {
        safe =
          (await control.count()) === 1 &&
          (await control.evaluate(
            el =>
              el instanceof HTMLButtonElement && !el.disabled && (el.type === 'button' || !el.form),
          ));
      } catch {
        /* Missing or ambiguous consent contract. */
      }
      observer.setPhase(scope.choice);
      if (safe) {
        try {
          await control.click({ timeout: 1500 });
        } catch {
          safe = false;
        }
      }
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Capture configured post-consent traffic and delayed injected resources.
      await page.waitForTimeout(config.observeMs);
      const stage = await observer.snapshot(
        { ...scope, stage: scope.choice },
        page,
        documentOk && safe,
        baseline,
      );
      if (!safe)
        stage.findings.push({
          rule: 'security-consent-control-unavailable',
          severity: 'warning',
          evidence: { safeUniqueControl: false },
        });
      record(stage);
    }
  } finally {
    await observer.stop();
  }
  return {
    schemaVersion: 1 as const,
    observedAt: new Date().toISOString(),
    stages,
    status: stages.some(stage => stage.status === 'unverified')
      ? 'unverified'
      : stages.some(stage => stage.status === 'needs-review')
        ? 'needs-review'
        : 'matches-baseline',
    limitations: {
      observationalOnly: true,
      executionNotVerified: true,
      inlineSnapshotOnly: true,
      serviceWorkersBlocked: true,
      workerAttributionLimited: true,
      workerWebSocketsUnobserved: true,
      closedShadowDomUnobserved: true,
      noFormOrCardValuesCollected: true,
      noRequestOrWebSocketPayloadsCollected: true,
      noSyntheticCardDataEntered: true,
    },
  };
}
