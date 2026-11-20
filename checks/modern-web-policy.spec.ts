// Contract sources: CSP3 fallback lists and Reporting API endpoint processing.
// https://www.w3.org/TR/CSP3/#directive-fallback-list
// https://www.w3.org/TR/reporting-1/#process-header
// These fixtures distinguish authored syntax from browser enforcement/receipt;
// malformed/unsupported inputs stay unverified and source tokens never leave reports.
import { test, expect } from '../tests/fixtures';
import { inspectDocumentPolicies } from '../tests/modern-web-policy';
import { inspectModernWeb } from '../tests/modern-web';

const url = 'http://127.0.0.1:45996/policies';
async function fixtureDocument(
  page: import('@playwright/test').Page,
  headers: Record<string, string> = {},
  extra = '',
) {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      headers,
      body: `<!doctype html><html lang="en"><head><title>Policy fixture</title>${extra}</head><body><main><h1>Policy fixture</h1></main></body></html>`,
    }),
  );
  return page.goto(url);
}

test('policy evidence distinguishes report-only, enforcement and unavailable response headers', async ({
  page,
}) => {
  await fixtureDocument(page);
  const unknown = await inspectDocumentPolicies(page);
  expect(unknown.coverage).toMatchObject({
    responseHeadersObserved: false,
    policies: [],
    connectionAllowlists: [],
    activeEnforcementProbed: false,
  });
  expect(unknown.findings).toEqual([]);
  const report = await inspectDocumentPolicies(page, {
    'Content-Security-Policy-Report-Only':
      "require-trusted-types-for 'script'; trusted-types *; connect-src *",
    'Content-Security-Policy':
      "default-src 'self'; form-action 'self'; worker-src 'self'; require-trusted-types-for 'script'; trusted-types reviewed-policy",
  });
  expect(report.findings).toEqual([]);
  expect(report.coverage.policies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ disposition: 'report', broadConnect: true }),
      expect.objectContaining({
        disposition: 'enforce',
        connectSource: 'default-src',
        explicitFormAction: true,
        explicitWorkerSource: true,
        policyNameRestriction: 'listed',
      }),
    ]),
  );
  expect(JSON.stringify(report)).not.toContain('reviewed-policy');
});

test('policy advisories are limited to authored risky combinations and omit source tokens', async ({
  page,
}) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'content-security-policy':
      "require-trusted-types-for 'script'; trusted-types *; script-src 'nonce-do-not-record' https://api.example.test/private?key=secret",
    'connection-allowlist': '(response-origin "https://api.example.test/private?key=secret")',
  });
  expect(report.findings.map(f => f.rule)).toEqual([
    'policy-trusted-types-wildcard',
    'policy-connection-reporting',
  ]);
  expect(report.findings.every(f => f.severity === 'warning')).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/do-not-record|api\.example|key=secret/);
});

test('connection allowlist needs cross-browser fallback but is not itself mandatory', async ({
  page,
}) => {
  await fixtureDocument(page);
  expect((await inspectDocumentPolicies(page, {})).findings).toEqual([]);
  const headers = {
    'connection-allowlist': '(response-origin); report-to=conn-reports',
    'reporting-endpoints': 'conn-reports="https://report.example.test/secret"',
  };
  expect((await inspectDocumentPolicies(page, headers)).findings.map(f => f.rule)).toEqual([
    'policy-connection-fallback',
  ]);
  const reportOnly = await inspectDocumentPolicies(page, {
    'connection-allowlist-report-only': headers['connection-allowlist'],
    'reporting-endpoints': headers['reporting-endpoints'],
  });
  expect(reportOnly.findings).toEqual([]);
  const fallback = await inspectDocumentPolicies(page, {
    ...headers,
    'content-security-policy': "default-src 'self'; form-action 'self'; worker-src 'self'",
  });
  expect(fallback.findings).toEqual([]);
});

test('ambiguous combined CSP is unverified and duplicate directives use first occurrence', async ({
  page,
}) => {
  await fixtureDocument(page);
  const combined = await inspectDocumentPolicies(page, {
    'content-security-policy': "connect-src 'none', connect-src *",
  });
  expect(combined.coverage.policies[0]).toMatchObject({
    parseStatus: 'comma-containing-policy-unverified',
  });
  const duplicate = await inspectDocumentPolicies(page, {
    'content-security-policy': "connect-src 'self'; connect-src *",
  });
  expect(duplicate.coverage.policies[0]).toMatchObject({ broadConnect: false });
});

test('meta policies remain distinct and are included in shared passive evidence', async ({
  page,
}) => {
  await fixtureDocument(
    page,
    {},
    '<meta http-equiv="Content-Security-Policy" content="connect-src &apos;none&apos;; form-action &apos;self&apos;">',
  );
  const report = await inspectModernWeb(page);
  expect(report.documentPolicies.policies).toEqual([
    expect.objectContaining({
      source: 'meta',
      connectSource: 'connect-src',
      explicitFormAction: true,
    }),
  ]);
});

test('owned fixture calibrates benign sink rejection without probing live-page sinks', async ({
  page,
}) => {
  const headers = {
    'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'",
  };
  await fixtureDocument(page, headers);
  const result = await page.evaluate(() => {
    const element = document.createElement('div');
    try {
      // Owned fixture only: harmless markup, no script, URL, event handler or DOM insertion.
      element.innerHTML = '<p>Benign calibration</p>';
      return { rejected: false, text: element.textContent };
    } catch (error) {
      return { rejected: error instanceof TypeError, text: element.textContent };
    }
  });
  const report = await inspectDocumentPolicies(page, headers);
  expect(report.coverage.policies[0]).toMatchObject({ requiresTrustedTypes: true });
  if (report.coverage.trustedTypesApiPresent) expect(result.rejected).toBe(true);
  else expect(result.text).toBe('Benign calibration');
  expect(report.coverage.activeEnforcementProbed).toBe(false);
});

test('CSP directive names and broad connection schemes are case insensitive', async ({ page }) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'Content-Security-Policy': 'CONNECT-SRC HTTPS: WSS:',
    'Content-Security-Policy-Report-Only': 'DEFAULT-SRC HTTP: WS:',
  });
  expect(report.coverage.policies).toEqual([
    expect.objectContaining({
      disposition: 'enforce',
      connectSource: 'connect-src',
      broadConnect: true,
      connectSourceExpressionCount: 2,
    }),
    expect.objectContaining({
      disposition: 'report',
      connectSource: 'default-src',
      broadConnect: true,
      connectSourceExpressionCount: 2,
    }),
  ]);
  expect(report.findings).toEqual([]);
});

test('duplicate CSP directives keep the first value and report only token-free counts', async ({
  page,
}) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'content-security-policy':
      "CONNECT-SRC 'self'; connect-src HTTPS:; report-to private-report; REPORT-TO private-other; trusted-types private-policy",
  });
  expect(report.coverage.policies[0]).toMatchObject({
    directiveCount: 3,
    duplicateDirectiveCount: 2,
    connectSourceExpressionCount: 1,
    broadConnect: false,
  });
  expect(JSON.stringify(report)).not.toMatch(/private-report|private-other|private-policy/);
  expect(report.findings.map(f => f.rule)).toEqual(['policy-csp-reporting-endpoint']);
});

test('empty CSP connection sources remain distinct from absent directives and override defaults', async ({
  page,
}) => {
  await fixtureDocument(page);
  for (const [value, source, count] of [
    ['default-src HTTPS:; connect-src;', 'connect-src', 0],
    ['default-src;', 'default-src', 0],
    ["script-src 'self'", 'unrestricted-by-this-policy', null],
  ] as const) {
    const report = await inspectDocumentPolicies(page, { 'content-security-policy': value });
    expect(report.coverage.policies[0]).toMatchObject({
      connectSource: source,
      connectSourceExpressionCount: count,
      broadConnect: false,
    });
    expect(report.coverage.activeEnforcementProbed).toBe(false);
    expect(report.findings).toEqual([]);
  }
});

test('CSP source-list fallback distinguishes workers, frames, scripts and form actions', async ({
  page,
}) => {
  await fixtureDocument(page);
  const cases = [
    [
      "default-src 'none'",
      'default-src',
      'default-src',
      'default-src',
      'unrestricted-by-this-policy',
    ],
    [
      "default-src 'none'; script-src 'self'",
      'script-src',
      'default-src',
      'script-src',
      'unrestricted-by-this-policy',
    ],
    [
      "default-src 'none'; script-src 'self'; child-src https:",
      'script-src',
      'child-src',
      'child-src',
      'unrestricted-by-this-policy',
    ],
    [
      'child-src https:; frame-src; worker-src; script-src; form-action',
      'script-src',
      'frame-src',
      'worker-src',
      'form-action',
    ],
  ] as const;
  for (const [value, script, frame, worker, form] of cases) {
    const report = await inspectDocumentPolicies(page, { 'content-security-policy': value });
    expect(report.coverage.policies[0]).toMatchObject({
      sourceLists: {
        'script-src': { source: script },
        'script-src-elem': { source: script },
        'script-src-attr': { source: script },
        'frame-src': { source: frame },
        'worker-src': { source: worker },
        'form-action': { source: form },
      },
    });
    expect(report.findings).toEqual([]);
  }
});

test('CSP source evidence preserves empty overrides, separate policies and token privacy', async ({
  page,
}) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'content-security-policy':
      "DEFAULT-SRC HTTPS:; SCRIPT-SRC 'nonce-private-token' 'strict-dynamic' https://private.example/secret; script-src *; script-src-elem; script-src-attr 'none'; worker-src WSS:; form-action *",
    'content-security-policy-report-only': "child-src 'none'; connect-src; frame-src *",
  });
  expect(report.coverage.policies[0]).toMatchObject({
    disposition: 'enforce',
    duplicateDirectiveCount: 1,
    sourceLists: {
      'script-src': {
        source: 'script-src',
        sourceExpressionCount: 3,
        wildcardPresent: false,
        enforcementVerified: false,
      },
      'script-src-elem': { source: 'script-src-elem', sourceExpressionCount: 0 },
      'script-src-attr': { source: 'script-src-attr', sourceExpressionCount: 1 },
      'connect-src': { source: 'default-src', broadSchemePresent: true },
      'worker-src': { source: 'worker-src', broadSchemePresent: true },
      'form-action': { source: 'form-action', wildcardPresent: true },
    },
  });
  expect(report.coverage.policies[1]).toMatchObject({
    disposition: 'report',
    sourceLists: {
      'script-src': { source: 'unrestricted-by-this-policy', sourceExpressionCount: null },
      'worker-src': { source: 'child-src', sourceExpressionCount: 1 },
      'frame-src': { source: 'frame-src', wildcardPresent: true },
      'connect-src': { source: 'connect-src', sourceExpressionCount: 0 },
    },
  });
  expect(JSON.stringify(report)).not.toMatch(
    /private-token|private\.example|secret|strict-dynamic/,
  );
  const ambiguous = await inspectDocumentPolicies(page, {
    'content-security-policy': "default-src 'none', script-src *",
  });
  expect(ambiguous.coverage.policies[0]).not.toHaveProperty('sourceLists');
});

test('CSP reporting matches exact endpoint names without exporting names or URLs', async ({
  page,
}) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'Reporting-Endpoints':
      'private-group="https://reports.example/private?token=never-export,part", other="/relative-report"',
    'Content-Security-Policy':
      "script-src 'none'; report-to private-group; report-uri /private-fallback",
    'Content-Security-Policy-Report-Only': "connect-src 'none'; report-to missing-private-group",
  });
  expect(report.coverage.policies[0]).toMatchObject({
    reporting: {
      reportToPresent: true,
      reportToTokenCount: 1,
      reportUriPresent: true,
      endpointDictionaryStatus: 'observed',
      endpointNameObserved: true,
      endpointUrlValidityVerified: false,
      deliveryVerified: false,
    },
  });
  expect(report.coverage.policies[1]).toMatchObject({
    disposition: 'report',
    reporting: { endpointNameObserved: false },
  });
  expect(report.findings.map(f => [f.rule, f.severity])).toEqual([
    ['policy-csp-reporting-endpoint', 'warning'],
  ]);
  expect(JSON.stringify(report)).not.toMatch(
    /private-group|reports\.example|never-export|relative-report|private-fallback/,
  );
});

test('CSP reporting distinguishes absent, legacy, meta and malformed report-to contracts', async ({
  page,
}) => {
  await fixtureDocument(page);
  const missing = await inspectDocumentPolicies(page, {
    'content-security-policy': 'report-to private-name',
  });
  expect(missing.findings.map(f => f.rule)).toEqual(['policy-csp-reporting-endpoint']);
  const legacy = await inspectDocumentPolicies(page, {
    'content-security-policy': 'report-to private-name',
    'report-to': '{"group":"private-name","endpoints":[{"url":"https://private.example/secret"}]}',
  });
  expect(legacy.findings).toEqual([]);
  expect(legacy.coverage.policies[0]).toMatchObject({
    reporting: { legacyReportToHeaderPresent: true, deliveryVerified: false },
  });
  for (const policy of [
    'report-to',
    'report-to one two',
    'report-to "quoted"',
    'report-uri /legacy-only',
    "script-src 'self'",
  ]) {
    const report = await inspectDocumentPolicies(page, { 'content-security-policy': policy });
    expect(report.findings).toEqual([]);
    expect(report.coverage.policies[0]).toMatchObject({
      reporting: { endpointNameObserved: null, deliveryVerified: false },
    });
  }
  await page.evaluate(() => {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = 'report-to private-meta; report-uri /private-meta';
    document.head.append(meta);
  });
  const meta = await inspectDocumentPolicies(page, {});
  expect(meta.findings).toEqual([]);
  expect(meta.coverage.policies[0]).toMatchObject({
    source: 'meta',
    reporting: { metaReportingIgnored: true, endpointNameObserved: null },
  });
  expect(JSON.stringify({ legacy, meta })).not.toMatch(
    /private-name|private-meta|private\.example|secret/,
  );
});

test('unsupported reporting dictionaries stay unverified and never invent missing-name warnings', async ({
  page,
}) => {
  await fixtureDocument(page);
  for (const value of [
    '',
    'private="/report",',
    'private="/report", private="/other"',
    'private="/report";parameter=?1',
    'private=?1',
    'private=("/report")',
    'Private="/report"',
    'private="unterminated',
    'private="bad\\q"',
    'x'.repeat(65537),
    Array.from({ length: 101 }, (_, i) => `group${i}="/report"`).join(','),
  ]) {
    const report = await inspectDocumentPolicies(page, {
      'content-security-policy': 'report-to private',
      'reporting-endpoints': value,
    });
    expect(report.findings).toEqual([]);
    expect(report.coverage.policies[0]).toMatchObject({
      reporting: {
        endpointDictionaryStatus: 'unverified',
        endpointNameObserved: null,
        deliveryVerified: false,
      },
    });
  }
  const combined = await inspectDocumentPolicies(page, {
    'content-security-policy': 'report-to private, report-to other',
    'reporting-endpoints': 'private="/report"',
  });
  expect(combined.coverage.policies[0]).not.toHaveProperty('reporting');
});

test('reporting dictionary escapes and exact-case names keep first CSP directive semantics', async ({
  page,
}) => {
  await fixtureDocument(page);
  const report = await inspectDocumentPolicies(page, {
    'reporting-endpoints': 'private="https://reports.example/a\\\\b\\"c", final="/endpoint"',
    'content-security-policy': 'REPORT-TO final; report-to missing',
    'content-security-policy-report-only': 'report-to FINAL',
  });
  expect(report.coverage.policies[0]).toMatchObject({
    duplicateDirectiveCount: 1,
    reporting: { endpointDictionaryStatus: 'observed', endpointNameObserved: true },
  });
  expect(report.coverage.policies[1]).toMatchObject({ reporting: { endpointNameObserved: false } });
  expect(report.findings).toHaveLength(1);
  expect(JSON.stringify(report)).not.toMatch(/reports\.example|\/endpoint|FINAL/);
});

// Reporting API resolves endpoint URI references against the document response URL,
// not an authored <base>. A parsed HTTP URL still does not verify TLS or delivery.
// https://www.w3.org/TR/reporting-1/#process-header
for (const [endpoint, status, warning] of [
  ['/private-relative?token=never-export', 'http-url', false],
  ['https://reports.example/private?token=never-export', 'http-url', false],
  ['data:text/plain,never-export', 'non-http-url', true],
  ['javascript:never-export', 'non-http-url', true],
  ['https://[invalid-host', 'invalid-url', true],
] as const)
  test(`selected reporting endpoint URL is inspected without fetching: ${status} ${endpoint.split(':')[0]}`, async ({
    page,
  }) => {
    await fixtureDocument(page, {}, '<base href="ftp://unrelated.example/">');
    expect(await page.evaluate(() => document.baseURI.startsWith('ftp:'))).toBe(true);
    let requests = 0;
    page.context().on('request', () => requests++);
    const report = await inspectDocumentPolicies(page, {
      'content-security-policy-report-only': 'report-to reviewed',
      'reporting-endpoints': `reviewed="${endpoint}"`,
    });
    expect(report.coverage.policies[0]).toMatchObject({
      reporting: {
        endpointNameObserved: true,
        endpointUrlParseStatus: status,
        endpointUrlValidityVerified: false,
        deliveryVerified: false,
      },
    });
    expect(report.findings.some(f => f.rule === 'policy-csp-reporting-url')).toBe(warning);
    expect(requests).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(
      /never-export|reports\.example|invalid-host|unrelated\.example|private-relative/,
    );
  });
