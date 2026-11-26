// Sources and why this is a separate owned-browser calibration:
// https://developer.chrome.com/docs/capabilities/web-apis/reporting-api (debug delay)
// https://playwright.dev/docs/browsers#chromium-new-headless-mode (full Chromium)
// https://www.w3.org/TR/reporting-1/#try-delivery (CORS, same-origin credentials)
// Count actual receiver receipt; Queued/Pending alone is not delivery. Trust only
// this temporary fixture key; never transplant these debug flags into store runs.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test as base, expect, chromium } from '@playwright/test';
import { resolveSiteSettings } from '../config/site-settings';
import { observeSecurityScenario } from '../tests/security-monitoring';
import { inspectDocumentPolicies } from '../tests/modern-web-policy';

type TlsMaterial = { key: Buffer; cert: Buffer; spki: string };
const test = base.extend<Record<never, never>, { tlsMaterial: TlsMaterial }>({
  tlsMaterial: [
    async ({}, use) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-reporting-tls-'));
      try {
        const keyFile = path.join(directory, 'key.pem'),
          certFile = path.join(directory, 'cert.pem');
        execFileSync(
          'openssl',
          [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            keyFile,
            '-out',
            certFile,
            '-subj',
            '/CN=localhost',
            '-days',
            '1',
            '-addext',
            'subjectAltName=IP:127.0.0.1,DNS:localhost',
          ],
          { stdio: 'ignore', timeout: 15000 },
        );
        const cert = fs.readFileSync(certFile),
          key = fs.readFileSync(keyFile);
        const spki = createHash('sha256')
          .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }))
          .digest('base64');
        await use({ key, cert, spki });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  browser: [
    async ({ tlsMaterial }, use) => {
      // Trust only this run's ephemeral loopback fixture key, never every certificate.
      const browser = await chromium.launch({
        channel: 'chromium',
        args: [
          '--short-reporting-delay',
          '--ignore-certificate-errors-spki-list=' + tlsMaterial.spki,
        ],
      });
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: 'worker' },
  ],
});

for (const [disposition, statusCode] of [
  ['enforce', 204],
  ['report', 204],
  ['enforce', 503],
] as const)
  test(`native Reporting API upload reaches the owned receiver: ${disposition} HTTP ${statusCode}`, async ({
    page,
    tlsMaterial,
  }, testInfo) => {
    const receipts: Array<{
      type: string;
      directive: string;
      disposition: string;
      responseStatus: number;
    }> = [];
    let scriptRequests = 0,
      postCount = 0,
      optionsCount = 0,
      tlsErrors = 0;
    const policyHeader =
      disposition === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only';
    const policy = "script-src 'none'; report-to owned-group";
    const headers = {
      [policyHeader]: policy,
      'reporting-endpoints': 'owned-group="/private-receiver?token=owned-only"',
    };
    const server = https.createServer(tlsMaterial, (request, response) => {
      const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
      if (pathname === '/private-receiver' && request.method === 'OPTIONS') {
        optionsCount++;
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
        });
        response.end();
      } else if (pathname === '/private-receiver' && request.method === 'POST') {
        postCount++;
        const chunks: Buffer[] = [];
        let bytes = 0;
        request.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= 65536) chunks.push(chunk);
        });
        request.on('end', () => {
          if (bytes <= 65536) {
            try {
              const packets: unknown = JSON.parse(Buffer.concat(chunks).toString());
              if (Array.isArray(packets) && packets.length <= 100)
                for (const packet of packets)
                  if (
                    packet?.type === 'csp-violation' &&
                    String(packet.body?.effectiveDirective).startsWith('script-src') &&
                    ['enforce', 'report'].includes(packet.body?.disposition) &&
                    receipts.length < 200
                  )
                    receipts.push({
                      type: 'csp-violation',
                      directive: 'script-src',
                      disposition: packet.body.disposition,
                      responseStatus: statusCode,
                    });
            } catch {
              /* Invalid bodies cannot count as receipt evidence. */
            }
          }
          response.writeHead(statusCode);
          response.end();
        });
      } else if (pathname === '/asset.js') {
        scriptRequests++;
        response.writeHead(200, { 'content-type': 'application/javascript' });
        response.end('window.ownedScriptExecuted=true;');
      } else if (pathname === '/page') {
        response.writeHead(200, { 'content-type': 'text/html', ...headers });
        response.end(
          '<!doctype html><html lang="en"><title>Owned Reporting API fixture</title><script src="/asset.js?private=owned-script"></script></html>',
        );
      } else {
        response.writeHead(204);
        response.end();
      }
    });
    server.on('tlsClientError', () => tlsErrors++);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    headers['reporting-endpoints'] = `owned-group="${origin}/private-receiver?token=owned-only"`;
    try {
      const session = await page.context().newCDPSession(page);
      const states = new Set<string>();
      const observeState = (packet: { report: { status: string } }) => {
        if (['Queued', 'Pending', 'Success', 'MarkedForRemoval'].includes(packet.report.status))
          states.add(packet.report.status);
      };
      session.on('Network.reportingApiReportAdded', observeState);
      session.on('Network.reportingApiReportUpdated', observeState);
      await session.send('Network.enable');
      await session.send('Network.enableReportingApi', { enable: true });
      const config = resolveSiteSettings({
        url: origin,
        securityMonitoring: { enabled: true, observeMs: 400 },
      }).securityMonitoring;
      const report = await observeSecurityScenario(
        page,
        config,
        {
          site: 'owned-reporting',
          project: 'fixture',
          page: 'home',
          role: 'storefront',
          choice: 'initial',
          profile: 'local',
          locale: 'en-US',
          timezoneId: 'UTC',
        },
        origin + '/page',
      );
      try {
        await expect.poll(() => postCount, { timeout: 10000 }).toBeGreaterThan(0);
      } catch {
        throw new Error(
          'Owned Reporting API receiver has no POST; browser statuses: ' +
            JSON.stringify({ states: [...states], optionsCount, tlsErrors }),
        );
      }
      expect(receipts.length, 'Native POST must contain a recognizable CSP report').toBeGreaterThan(
        0,
      );
      expect(receipts).toContainEqual({
        type: 'csp-violation',
        directive: 'script-src',
        disposition,
        responseStatus: statusCode,
      });
      expect(scriptRequests).toBe(disposition === 'enforce' ? 0 : 1);
      expect(report.stages[0].policy.reportDeliveryVerified).toBe(false);
      expect(report.stages[0].policy.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ disposition })]),
      );
      const authored = await inspectDocumentPolicies(page, headers);
      expect(authored.coverage.policies[0]).toMatchObject({
        reporting: { endpointNameObserved: true, deliveryVerified: false },
      });
      const calibration = {
        ownedFixtureOnly: true,
        channel: 'chromium',
        shortenedReportingDelay: true,
        responseStatus: statusCode,
        receipts,
        browserStatuses: [...states],
        productionDeliveryVerified: false,
      };
      await testInfo.attach('reporting-api-calibration.json', {
        body: JSON.stringify(calibration),
        contentType: 'application/json',
      });
      expect(JSON.stringify({ report, authored, calibration })).not.toMatch(
        /owned-group|private-receiver|owned-only|owned-script|ownedScriptExecuted/,
      );
    } finally {
      try {
        await page.goto('about:blank');
      } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  });

for (const variant of [
  'missing-name',
  'default-only',
  'case-mismatch',
  'non-string',
  'opaque-url',
] as const)
  test(`reporting configuration stays document scoped with positive controls: ${variant}`, async ({
    page,
    tlsMaterial,
  }, testInfo) => {
    const counts = { before: 0, after: 0, negative: 0, invalid: 0 };
    let origin = '';
    const policy = "script-src 'none'; report-to owned-group";
    const negativeHeaders: Record<string, string> = {};
    const server = https.createServer(tlsMaterial, (request, response) => {
      const pathname = new URL(request.url!, 'https://127.0.0.1').pathname;
      if (pathname === '/receiver' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 65536) chunks.push(chunk);
        });
        request.on('end', () => {
          try {
            if (size > 65536) throw new Error('limit');
            const packets: unknown = JSON.parse(Buffer.concat(chunks).toString());
            if (!Array.isArray(packets) || packets.length > 100) throw new Error('batch');
            for (const packet of packets) {
              if (
                packet?.type !== 'csp-violation' ||
                !String(packet.body?.effectiveDirective).startsWith('script-src')
              )
                throw new Error('type');
              const document = new URL(packet.body.documentURL);
              if (document.origin !== origin) throw new Error('origin');
              if (document.pathname === '/before') counts.before++;
              else if (document.pathname === '/after') counts.after++;
              else if (document.pathname === '/negative') counts.negative++;
              else throw new Error('document');
            }
          } catch {
            counts.invalid++;
          }
          response.writeHead(204);
          response.end();
        });
      } else if (['/before', '/after', '/negative'].includes(pathname)) {
        response.writeHead(200, {
          'content-type': 'text/html',
          'content-security-policy': policy,
          ...(pathname === '/negative'
            ? negativeHeaders
            : { 'reporting-endpoints': `owned-group="${origin}/receiver?token=private-control"` }),
        });
        response.end(
          '<!doctype html><html lang="en"><title>Owned document isolation</title><script src="/asset.js?token=private-asset"></script></html>',
        );
      } else {
        response.writeHead(204);
        response.end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    negativeHeaders['reporting-endpoints'] = {
      'missing-name': `other="${origin}/receiver?token=private-other"`,
      'default-only': `default="${origin}/receiver?token=private-default"`,
      'case-mismatch': `owned-group="${origin}/receiver?token=private-case"`,
      'non-string': 'owned-group=?1',
      'opaque-url': 'owned-group="data:text/plain,private-opaque"',
    }[variant];
    if (variant === 'case-mismatch')
      negativeHeaders['content-security-policy'] = "script-src 'none'; report-to OWNED-GROUP";
    const control = await page.context().newPage();
    try {
      await control.goto(origin + '/before');
      await expect.poll(() => counts.before, { timeout: 10000 }).toBeGreaterThan(0);
      await control.close();
      const config = resolveSiteSettings({
        url: origin,
        securityMonitoring: { enabled: true, observeMs: 400 },
      }).securityMonitoring;
      const report = await observeSecurityScenario(
        page,
        config,
        {
          site: 'owned-isolation',
          project: 'fixture',
          page: 'negative',
          role: 'storefront',
          choice: 'initial',
          profile: 'local',
          locale: 'en-US',
          timezoneId: 'UTC',
        },
        origin + '/negative',
      );
      expect(report.stages[0].policy.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ disposition: 'enforce' })]),
      );
      const authored = await inspectDocumentPolicies(page, {
        'content-security-policy': policy,
        ...negativeHeaders,
      });
      const expectedName = variant === 'non-string' ? null : variant === 'opaque-url';
      expect(authored.coverage.policies[0]).toMatchObject({
        reporting: {
          endpointNameObserved: expectedName,
          endpointUrlValidityVerified: false,
          deliveryVerified: false,
        },
      });
      const after = await page.context().newPage();
      await after.goto(origin + '/after');
      await expect.poll(() => counts.after, { timeout: 10000 }).toBeGreaterThan(0);
      // A bounded negative observation bracketed by real uploads, never a global
      // claim that no delayed report could arrive after this fixture closes.
      expect(counts.negative).toBe(0);
      expect(counts.invalid).toBe(0);
      expect(report.stages[0].policy.reportDeliveryVerified).toBe(false);
      const calibration = {
        ownedFixtureOnly: true,
        variant,
        counts,
        negativeObservationBounded: true,
        productionDeliveryVerified: false,
      };
      expect(JSON.stringify({ calibration, authored, report })).not.toMatch(
        /private-control|private-asset|private-other|private-default|private-case|private-opaque|OWNED-GROUP/,
      );
      await testInfo.attach('reporting-api-isolation.json', {
        body: JSON.stringify(calibration),
        contentType: 'application/json',
      });
      await after.close();
    } finally {
      try {
        await page.goto('about:blank');
      } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  });

for (const cors of ['allowed', 'missing-origin', 'wrong-origin', 'missing-header'] as const)
  test(`cross-origin reporting preflight and cookies: ${cors}`, async ({
    page,
    tlsMaterial,
  }, testInfo) => {
    let sourceOrigin = '',
      receiverOrigin = '';
    const evidence = {
      before: 0,
      after: 0,
      cross: 0,
      preflights: 0,
      invalidReports: 0,
      preflightContractValid: true,
      preflightCookieSeen: false,
      crossCookieSeen: false,
      beforeCookieSeen: false,
      afterCookieSeen: false,
    };
    const receive = (
      request: import('node:http').IncomingMessage,
      response: import('node:http').ServerResponse,
      cross: boolean,
    ) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 65536) chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          if (
            size > 65536 ||
            request.headers['content-type']?.split(';')[0] !== 'application/reports+json'
          )
            throw new Error('format');
          const packets: unknown = JSON.parse(Buffer.concat(chunks).toString());
          if (!Array.isArray(packets) || packets.length > 100) throw new Error('batch');
          for (const packet of packets) {
            if (
              packet?.type !== 'csp-violation' ||
              !String(packet.body?.effectiveDirective).startsWith('script-src')
            )
              throw new Error('type');
            const document = new URL(packet.body.documentURL);
            if (document.origin !== sourceOrigin) throw new Error('origin');
            const cookieSeen = Boolean(request.headers.cookie);
            if (cross && document.pathname === '/cross') {
              evidence.cross++;
              evidence.crossCookieSeen ||= cookieSeen;
            } else if (!cross && document.pathname === '/before') {
              evidence.before++;
              evidence.beforeCookieSeen ||= cookieSeen;
            } else if (!cross && document.pathname === '/after') {
              evidence.after++;
              evidence.afterCookieSeen ||= cookieSeen;
            } else throw new Error('document');
          }
        } catch {
          evidence.invalidReports++;
        }
        response.writeHead(204, cross ? { 'access-control-allow-origin': sourceOrigin } : {});
        response.end();
      });
    };
    const receiver = https.createServer(tlsMaterial, (request, response) => {
      if (new URL(request.url!, 'https://127.0.0.1').pathname !== '/receiver') {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.method === 'OPTIONS') {
        evidence.preflights++;
        evidence.preflightCookieSeen ||= Boolean(request.headers.cookie);
        evidence.preflightContractValid &&=
          request.headers.origin === sourceOrigin &&
          request.headers['access-control-request-method'] === 'POST' &&
          String(request.headers['access-control-request-headers'])
            .toLowerCase()
            .split(',')
            .map(item => item.trim())
            .includes('content-type');
        response.writeHead(204, {
          ...(cors === 'missing-origin'
            ? {}
            : {
                'access-control-allow-origin':
                  cors === 'wrong-origin' ? 'https://127.0.0.1:1' : sourceOrigin,
              }),
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers':
            cors === 'missing-header' ? 'x-unrelated' : 'content-type',
        });
        response.end();
      } else if (request.method === 'POST') receive(request, response, true);
      else {
        response.writeHead(405);
        response.end();
      }
    });
    const source = https.createServer(tlsMaterial, (request, response) => {
      const pathname = new URL(request.url!, 'https://127.0.0.1').pathname;
      if (pathname === '/same-receiver' && request.method === 'POST') {
        receive(request, response, false);
        return;
      }
      if (['/before', '/after', '/cross'].includes(pathname)) {
        const endpoint =
          pathname === '/cross'
            ? receiverOrigin + '/receiver?private=cross-token'
            : sourceOrigin + '/same-receiver?private=same-token';
        response.writeHead(200, {
          'content-type': 'text/html',
          'content-security-policy': "script-src 'none'; report-to owned-cors-group",
          'reporting-endpoints': `owned-cors-group="${endpoint}"`,
        });
        response.end(
          '<!doctype html><html lang="en"><title>Owned cross-origin reporting</title><script src="/asset.js?private=cors-asset"></script></html>',
        );
      } else {
        response.writeHead(204);
        response.end();
      }
    });
    const listen = (server: https.Server) =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    try {
      await listen(receiver);
      await listen(source);
      sourceOrigin = `https://127.0.0.1:${(source.address() as AddressInfo).port}`;
      receiverOrigin = `https://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
      expect(sourceOrigin).not.toBe(receiverOrigin);
      // Host cookies are eligible at either port: omission cannot be attributed
      // to a different domain, path, SameSite rule, or absent cookie setup.
      await page.context().addCookies([
        {
          name: 'owned_reporting_cookie',
          value: 'private-cookie-token',
          url: sourceOrigin,
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      await page.goto(sourceOrigin + '/before');
      await expect.poll(() => evidence.before, { timeout: 10000 }).toBeGreaterThan(0);
      expect(evidence.beforeCookieSeen).toBe(true);
      const config = resolveSiteSettings({
        url: sourceOrigin,
        securityMonitoring: { enabled: true, observeMs: 400 },
      }).securityMonitoring;
      const report = await observeSecurityScenario(
        page,
        config,
        {
          site: 'owned-cors',
          project: 'fixture',
          page: 'cross',
          role: 'storefront',
          choice: 'initial',
          profile: 'local',
          locale: 'en-US',
          timezoneId: 'UTC',
        },
        sourceOrigin + '/cross',
      );
      await expect.poll(() => evidence.preflights, { timeout: 10000 }).toBeGreaterThan(0);
      if (cors === 'allowed')
        await expect.poll(() => evidence.cross, { timeout: 10000 }).toBeGreaterThan(0);
      await page.goto(sourceOrigin + '/after');
      await expect.poll(() => evidence.after, { timeout: 10000 }).toBeGreaterThan(0);
      expect(evidence.afterCookieSeen).toBe(true);
      expect(evidence.preflightContractValid).toBe(true);
      expect(evidence.preflightCookieSeen).toBe(false);
      expect(evidence.crossCookieSeen).toBe(false);
      expect(evidence.invalidReports).toBe(0);
      if (cors !== 'allowed') expect(evidence.cross).toBe(0);
      expect(report.stages[0].policy.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ disposition: 'enforce' })]),
      );
      expect(report.stages[0].policy.reportDeliveryVerified).toBe(false);
      const calibration = {
        ownedFixtureOnly: true,
        cors,
        evidence,
        negativeObservationBounded: true,
        productionDeliveryVerified: false,
      };
      expect(JSON.stringify({ calibration, report })).not.toMatch(
        /private-cookie-token|owned_reporting_cookie|cross-token|same-token|cors-asset|owned-cors-group/,
      );
      await testInfo.attach('reporting-api-cors.json', {
        body: JSON.stringify(calibration),
        contentType: 'application/json',
      });
    } finally {
      try {
        await page.goto('about:blank');
      } finally {
        for (const server of [source, receiver]) server.closeAllConnections();
        await Promise.all(
          [source, receiver].map(
            server => new Promise<void>(resolve => server.close(() => resolve())),
          ),
        );
      }
    }
  });
