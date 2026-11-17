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
