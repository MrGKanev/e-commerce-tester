import type { Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

/** Source: Reporting API, process reporting endpoints:
 * https://www.w3.org/TR/reporting-1/#process-header
 * Structured Fields string escapes differ from splitting a header on commas.
 * Keep unsupported dictionaries unverified; values stay internal for URL checks.
 * Deliberately bounded subset of the Structured Fields dictionary, not a full validator.
 * Parameters, duplicate keys and non-string values stay unverified. Quoted commas
 * and the two SF string escapes are supported; endpoint values never leave here.
 */
function reportingNames(value: string | undefined) {
  const names = new Map<string, string>();
  if (value === undefined) return { status: 'absent' as const, names };
  if (!value || value.length > 65536) return { status: 'unverified' as const, names };
  const member =
    /[ \t]*([a-z*][a-z\d_.*-]*)(="(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\["\\])*")[ \t]*(,|$)/y;
  let position = 0;
  while (position < value.length) {
    member.lastIndex = position;
    const match = member.exec(value);
    if (!match || names.has(match[1]) || names.size >= 100)
      return { status: 'unverified' as const, names: new Map<string, string>() };
    names.set(match[1], JSON.parse(match[2].slice(1)));
    position = member.lastIndex;
    if (match[3] === ',' && position === value.length)
      return { status: 'unverified' as const, names: new Map<string, string>() };
  }
  return { status: 'observed' as const, names };
}

/** Passive policy evidence only: never create policies, write sinks or send disallowed requests. */
export async function inspectDocumentPolicies(page: Page, headers?: Record<string, string>) {
  const normalized = Object.fromEntries(
    Object.entries(headers || {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const dom = await page.evaluate(() => ({
    trustedTypesApiPresent: 'trustedTypes' in window,
    metaPolicies: [...document.head.querySelectorAll<HTMLMetaElement>('meta[http-equiv]')]
      .filter(meta => meta.httpEquiv.toLowerCase() === 'content-security-policy')
      .map(meta => meta.content),
  }));
  const findings: WebFinding[] = [];
  const endpoints = reportingNames(normalized['reporting-endpoints']);
  const add = (
    rule: string,
    guide: string,
    evidence: Record<string, unknown>,
    recommendation: string,
  ) =>
    findings.push({
      rule,
      guide,
      severity: 'warning',
      selector: 'document policy',
      evidence,
      recommendation,
    });
  const policies = [
    ...(normalized['content-security-policy']
      ? [{ disposition: 'enforce', source: 'header', value: normalized['content-security-policy'] }]
      : []),
    ...(normalized['content-security-policy-report-only']
      ? [
          {
            disposition: 'report',
            source: 'header',
            value: normalized['content-security-policy-report-only'],
          },
        ]
      : []),
    ...dom.metaPolicies.map(value => ({ disposition: 'enforce', source: 'meta', value })),
  ].map(({ disposition, source, value }) => {
    // allHeaders() can combine repeated CSP fields. Commas may also occur in source URLs;
    // avoid inventing an effective policy from an ambiguous serialized list.
    if (value.includes(','))
      return { disposition, source, parseStatus: 'comma-containing-policy-unverified' };
    const directives = new Map<string, string[]>();
    let duplicateDirectiveCount = 0;
    for (const directive of value.split(';')) {
      const [name, ...tokens] = directive.trim().split(/\s+/);
      if (!name) continue;
      const normalizedName = name.toLowerCase();
      if (directives.has(normalizedName)) duplicateDirectiveCount++;
      else directives.set(normalizedName, tokens);
    }
    const connect = directives.get('connect-src') || directives.get('default-src');
    const reportTo = directives.get('report-to');
    const reportUri = directives.get('report-uri');
    const reportToSingleToken =
      reportTo?.length === 1 && /^[!#$%&'*+.^_`|~\w-]+$/.test(reportTo[0]);
    const legacyReportToHeaderPresent = Boolean(normalized['report-to']?.trim());
    const endpointNameObserved =
      source === 'header' && reportToSingleToken && endpoints.status !== 'unverified'
        ? endpoints.names.has(reportTo![0])
        : null;
    // Reporting endpoint URI references resolve against the response/document URL,
    // never document.baseURI (a page-authored <base> must not change header meaning).
    // https://www.w3.org/TR/reporting-1/#process-header
    // This verifies syntax/scheme only, not TLS, reachability, delivery or ingestion.
    let endpointUrlParseStatus = 'not-inspected';
    if (endpointNameObserved === true) {
      try {
        const endpoint = new URL(endpoints.names.get(reportTo![0])!, page.url());
        endpointUrlParseStatus = ['http:', 'https:'].includes(endpoint.protocol)
          ? 'http-url'
          : 'non-http-url';
      } catch {
        endpointUrlParseStatus = 'invalid-url';
      }
    }
    const reporting = {
      reportToPresent: reportTo !== undefined,
      reportToTokenCount: reportTo?.length ?? null,
      reportUriPresent: reportUri !== undefined,
      reportUriTokenCount: reportUri?.length ?? null,
      endpointDictionaryStatus: endpoints.status,
      endpointNameObserved,
      endpointUrlParseStatus,
      legacyReportToHeaderPresent,
      metaReportingIgnored: source === 'meta',
      endpointUrlValidityVerified: false,
      deliveryVerified: false,
    };
    if (endpointNameObserved === false && !legacyReportToHeaderPresent)
      add(
        'policy-csp-reporting-endpoint',
        'security',
        { source, disposition, ...reporting },
        'Review the CSP report-to name against Reporting-Endpoints. A matching name still requires valid endpoint URLs, browser support and server-side receipt verification; legacy report-uri behavior varies.',
      );
    if (['invalid-url', 'non-http-url'].includes(endpointUrlParseStatus))
      add(
        'policy-csp-reporting-url',
        'security',
        { source, disposition, endpointUrlParseStatus, deliveryVerified: false },
        'Configure the selected Reporting-Endpoints member with a valid HTTP(S) URL reference. Separately verify secure-context eligibility, TLS, CORS and actual receiver ingestion.',
      );
    // CSP3 fallback source: https://www.w3.org/TR/CSP3/#directive-fallback-list
    // In particular, form-action has no default-src fallback. The first authored
    // directive (including an empty one) wins; policies never merge into one list.
    // CSP3 fallback is per directive and per policy, not a merged origin allowlist.
    // In particular form-action never inherits default-src, and an empty directive
    // overrides its fallback just as an explicitly populated directive does.
    const sourceLists = Object.fromEntries(
      Object.entries({
        'script-src': ['script-src', 'default-src'],
        'script-src-elem': ['script-src-elem', 'script-src', 'default-src'],
        'script-src-attr': ['script-src-attr', 'script-src', 'default-src'],
        'connect-src': ['connect-src', 'default-src'],
        'frame-src': ['frame-src', 'child-src', 'default-src'],
        'worker-src': ['worker-src', 'child-src', 'script-src', 'default-src'],
        'form-action': ['form-action'],
      }).map(([directive, fallbacks]) => {
        const selected = fallbacks.find(name => directives.has(name));
        const tokens = selected ? directives.get(selected)! : undefined;
        return [
          directive,
          {
            source: selected ?? 'unrestricted-by-this-policy',
            sourceExpressionCount: tokens?.length ?? null,
            // Authored facts only; strict-dynamic/nonces/invalid expressions can
            // alter matching. Never describe these counters as effective access.
            wildcardPresent: tokens?.includes('*') ?? false,
            broadSchemePresent: tokens?.some(token => /^(?:https?|wss?):$/i.test(token)) ?? false,
            enforcementVerified: false,
          },
        ];
      }),
    );
    const requiresTrustedTypes =
      directives.get('require-trusted-types-for')?.includes("'script'") || false;
    const policyNames = directives.get('trusted-types');
    const broadConnect = Boolean(
      connect?.some(token => ['*', 'https:', 'http:', 'wss:', 'ws:'].includes(token.toLowerCase())),
    );
    if (disposition === 'enforce' && requiresTrustedTypes && policyNames?.includes('*'))
      add(
        'policy-trusted-types-wildcard',
        'trusted-types',
        { source, policyNameWildcard: true, enforcementBehaviorVerified: false },
        'Review wildcard Trusted Types policy creation during migration; prefer a reviewed policy-name allowlist and validate sanitizer behavior.',
      );
    return {
      disposition,
      source,
      parseStatus: 'observed',
      directiveCount: directives.size,
      duplicateDirectiveCount,
      reporting,
      sourceLists,
      connectSourceExpressionCount: connect?.length ?? null,
      connectSource: directives.has('connect-src')
        ? 'connect-src'
        : directives.has('default-src')
          ? 'default-src'
          : 'unrestricted-by-this-policy',
      broadConnect,
      explicitFormAction: directives.has('form-action'),
      explicitWorkerSource: directives.has('worker-src'),
      requiresTrustedTypes,
      policyNameRestriction: !policyNames
        ? 'unspecified'
        : policyNames.includes('*')
          ? 'wildcard'
          : 'listed',
      // Never include nonce/hash/source URL/policy-name tokens in report evidence.
      policyNameCount: policyNames?.filter(token => token !== "'allow-duplicates'").length || 0,
      defaultPolicyListed: policyNames?.includes('default') || false,
    };
  });
  const connection = ['connection-allowlist', 'connection-allowlist-report-only'].flatMap(name => {
    const value = normalized[name];
    if (!value) return [];
    const reportOnly = name.endsWith('-report-only');
    const reportToPresent = /;\s*report-to\s*=\s*[a-z*][a-z\d_.*-]*(?:\s*;|\s*$)/i.test(value);
    const reportingEndpointsPresent = Boolean(normalized['reporting-endpoints']?.trim());
    if (!reportToPresent || !reportingEndpointsPresent)
      add(
        'policy-connection-reporting',
        'restrict-outbound-connections',
        { reportOnly, reportToPresent, reportingEndpointsPresent },
        'Configure Reporting-Endpoints and an unquoted report-to endpoint parameter; header presence does not prove endpoint validity or report delivery.',
      );
    if (!reportOnly && !policies.some(policy => policy.disposition === 'enforce'))
      add(
        'policy-connection-fallback',
        'restrict-outbound-connections',
        { enforcedCspObserved: false, browserEnforcementVerified: false },
        'Pair an experimental Connection-Allowlist with CSP restrictions for browsers without network-layer allowlist support; audit form-action and worker-src explicitly.',
      );
    return [
      {
        reportOnly,
        reportToPresent,
        reportingEndpointsPresent,
        syntaxAndEnforcementVerified: false,
      },
    ];
  });
  return {
    coverage: {
      responseHeadersObserved: headers !== undefined,
      trustedTypesApiPresent: dom.trustedTypesApiPresent,
      policies,
      connectionAllowlists: connection,
      activeEnforcementProbed: false,
    },
    findings,
  };
}
