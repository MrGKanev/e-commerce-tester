import { randomUUID } from 'node:crypto';
import type { BrowserContext, Frame, Disposable } from '@playwright/test';

export type CspViolation = {
  directive: string;
  disposition: 'enforce' | 'report' | 'unknown';
  blockedOrigin: string;
  blockedKind: string;
  documentOrigin: string;
  context: 'main' | 'frame';
  count: number;
};
const directives = [
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'connect-src',
  'frame-src',
  'child-src',
  'worker-src',
  'form-action',
  'img-src',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'font-src',
  'media-src',
  'object-src',
  'base-uri',
  'frame-ancestors',
  'manifest-src',
  'prefetch-src',
  'navigate-to',
  'trusted-types',
  'require-trusted-types-for',
  'other',
];

/** Passive browser-event telemetry only. Never inject a policy, blocked request or form submission. */
export async function startCspObservation(context: BrowserContext, phase: () => string) {
  const binding = '__securityCsp_' + randomUUID().replaceAll('-', '');
  const ready = new WeakMap<Frame, { id: string; supported: boolean }>();
  const stages = new Map<string, { events: CspViolation[]; count: number; truncated: boolean }>();
  const resources: Disposable[] = [];
  let closed = false,
    installed = false,
    saturated = false;
  try {
    resources.push(
      await context.exposeBinding(binding, (source, value: unknown) => {
        if (closed || !source.frame || !value || typeof value !== 'object') return;
        const packet = value as Record<string, unknown>;
        if (typeof packet.id !== 'string' || !/^[a-f0-9]{32}$/.test(packet.id)) return;
        if (packet.kind === 'ready') {
          ready.set(source.frame, { id: packet.id, supported: packet.supported === true });
          return;
        }
        if (packet.kind === 'limit') {
          saturated = true;
          return;
        }
        if (packet.kind !== 'violation') return;
        const current = phase();
        let state = stages.get(current);
        if (!state) {
          state = { events: [], count: 0, truncated: false };
          stages.set(current, state);
        }
        if (++state.count > 200) {
          state.truncated = true;
          return;
        }
        // Revalidate the page-context packet and retain no free-form report fields.
        const origin = (value: unknown) => {
          if (typeof value !== 'string' || value.length > 500) return 'unresolved';
          try {
            const url = new URL(value);
            return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
              ? url.origin
              : 'opaque';
          } catch {
            return ['none', 'opaque', 'unresolved'].includes(value) ? value : 'unresolved';
          }
        };
        const event: CspViolation = {
          directive:
            typeof packet.directive === 'string' && directives.includes(packet.directive)
              ? packet.directive
              : 'other',
          disposition:
            packet.disposition === 'enforce' || packet.disposition === 'report'
              ? packet.disposition
              : 'unknown',
          blockedOrigin: origin(packet.blockedOrigin),
          blockedKind: [
            'url',
            'inline',
            'eval',
            'wasm-eval',
            'trusted-types-policy',
            'trusted-types-sink',
          ].includes(String(packet.blockedKind))
            ? String(packet.blockedKind)
            : 'other',
          documentOrigin: origin(packet.documentOrigin),
          context: source.frame.parentFrame() ? 'frame' : 'main',
          count: 1,
        };
        const previous = state.events.find(item =>
          Object.keys(event).every(
            key =>
              key === 'count' ||
              item[key as keyof CspViolation] === event[key as keyof CspViolation],
          ),
        );
        if (previous) previous.count++;
        else state.events.push(event);
      }),
    );
    resources.push(
      await context.addInitScript(
        ({ binding, directives }) => {
          const pending: Array<Record<string, unknown>> = [];
          let retries = 0,
            timer: ReturnType<typeof setTimeout> | undefined;
          const flush = () => {
            timer = undefined;
            const callback = (
              window as unknown as Record<string, (value: unknown) => Promise<void>>
            )[binding];
            if (typeof callback === 'function') {
              for (const packet of pending.splice(0)) void callback(packet).catch(() => {});
            } else if (retries++ < 30) timer = setTimeout(flush, 10);
          };
          const send = (packet: Record<string, unknown>) => {
            if (pending.length < 202) pending.push(packet);
            if (!timer) flush();
          };
          const id = [...crypto.getRandomValues(new Uint32Array(4))]
            .map(value => value.toString(16).padStart(8, '0'))
            .join('');
          Object.defineProperty(window, binding + 'Document', { value: id, configurable: true });
          const supported = typeof SecurityPolicyViolationEvent === 'function';
          let count = 0;
          if (supported)
            window.addEventListener(
              'securitypolicyviolation',
              event => {
                if (!event.isTrusted) return;
                if (++count > 200) {
                  if (count === 201) send({ kind: 'limit', id });
                  return;
                }
                const safeOrigin = (value: string) => {
                  try {
                    const url = new URL(value);
                    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
                      ? url.origin
                      : 'opaque';
                  } catch {
                    return 'none';
                  }
                };
                const blockedKind = [
                  'inline',
                  'eval',
                  'wasm-eval',
                  'trusted-types-policy',
                  'trusted-types-sink',
                ].includes(event.blockedURI)
                  ? event.blockedURI
                  : 'url';
                send({
                  kind: 'violation',
                  id,
                  directive: directives.includes(event.effectiveDirective)
                    ? event.effectiveDirective
                    : 'other',
                  disposition:
                    event.disposition === 'enforce' || event.disposition === 'report'
                      ? event.disposition
                      : 'unknown',
                  blockedKind,
                  blockedOrigin: blockedKind === 'url' ? safeOrigin(event.blockedURI) : 'none',
                  documentOrigin: safeOrigin(event.documentURI),
                });
              },
              true,
            );
          send({ kind: 'ready', id, supported });
        },
        { binding, directives },
      ),
    );
    installed = true;
  } catch {
    /* Explicit incomplete evidence; do not copy potentially private error text. */
  }
  return {
    async frameAvailable(frame: Frame) {
      if (!installed) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const id = await Promise.race([
          frame.evaluate(
            name => (window as unknown as Record<string, unknown>)[name],
            binding + 'Document',
          ),
          new Promise<null>(resolve => {
            timer = setTimeout(() => resolve(null), 300);
          }),
        ]);
        const status = ready.get(frame);
        return Boolean(status?.supported && status.id === id);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    snapshot(stage: string) {
      const state = stages.get(stage);
      return {
        events: structuredClone(state?.events || []),
        observedCount: state?.count || 0,
        truncated: saturated || state?.truncated || false,
        installed,
        phaseAttribution: 'binding-receipt' as const,
        tamperResistant: false as const,
      };
    },
    async stop() {
      closed = true;
      await Promise.allSettled(resources.map(resource => resource.dispose()));
    },
  };
}
