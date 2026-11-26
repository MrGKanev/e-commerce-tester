// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
// "Manage focus correctly to and from updated content" motivates preserving an
// authored focus change. Stopping later probe stages after lost ownership is a
// local audit safety policy, not an authoring rule or application-reset proof.
export interface WidgetProbeContinuation {
  continuationSafe?: boolean;
  networkDependent?: boolean;
  observations?: readonly Record<string, unknown>[];
  restoration?: unknown;
  cleanup?: unknown;
  scrollRestoration?: unknown;
  focusRestoration?: unknown;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function cleanupAllowsContinuation(value: unknown, untouched = false): boolean {
  if (value === undefined) return true;
  const cleanup = record(value);
  if (!cleanup) return false;
  // These booleans belong only to cleanup result objects. A native disclosure's
  // observation.restored === false can be a successfully restored closed state.
  if (cleanup.closed === false || cleanup.restored === false) return false;
  if (cleanup.status === undefined) return true; // Legacy closed-state evidence.
  return (
    ['restored', 'unchanged', 'not-needed'].includes(String(cleanup.status)) ||
    (untouched && cleanup.status === 'not-attempted')
  );
}

/** Classify only explicit top-level probe outcomes, never arbitrary nested data. */
export function canContinueWidgetProbe(probe: WidgetProbeContinuation): boolean {
  if (probe.continuationSafe === false || probe.networkDependent === true) return false;
  for (const key of ['restoration', 'cleanup', 'scrollRestoration', 'focusRestoration'] as const)
    if (!cleanupAllowsContinuation(probe[key])) return false;
  for (const observation of probe.observations || []) {
    const untouched = ['not-probed', 'not-applicable'].includes(String(observation.status));
    if (!untouched && observation.status !== 'observed') return false;
    if (untouched && typeof observation.keysSent === 'number' && observation.keysSent !== 0)
      return false;
    for (const key of ['restoration', 'cleanup', 'scrollRestoration', 'focusRestoration'] as const)
      if (!cleanupAllowsContinuation(observation[key], untouched)) return false;
  }
  // Observed legacy stages own their existing success contract even if they do
  // not expose standardized restoration status. Findings themselves are not a
  // safety signal: a fully restored keyboard advisory may safely precede a probe.
  return true;
}
