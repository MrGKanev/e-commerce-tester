import type { Page } from '@playwright/test';
import type { WebFinding } from './modern-web';

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
