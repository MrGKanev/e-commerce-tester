import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../tests/fixtures';
import { auditCurrentPage } from '../tests/shared-page-audit';

for (const headersAvailable of [true, false])
  test(`shared audits keep one document visit; response headers ${headersAvailable ? 'available' : 'unavailable'}`, async ({
    page,
  }, testInfo) => {
    let navigations = 0;
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest()) navigations++;
      return route.fulfill({
        contentType: 'text/html',
        headers: {
          'content-security-policy-report-only': 'report-to owned-private-group',
          'reporting-endpoints': 'other="/owned-private-receiver?token=owned-private-value"',
        },
        body: '<!doctype html><html lang="en"><head><title>Local shared page</title><link rel="canonical" href="http://127.0.0.1:45986/"></head><body><main><h1>Local shared page</h1><p>Welcome to the store.</p><table><caption>Sizes</caption><colgroup span="2"></colgroup><tr><th id="page-group" colspan="2" scope="colgroup">Group</th></tr><tr><th id="page-size" headers="page-group" scope="col">Size</th><th id="page-length" headers="page-group" scope="col">Length</th></tr><tr><td headers="page-group page-size">Small</td><td headers="page-group page-length">Ten</td></tr></table><table><caption>Availability</caption><tr><th scope="col">Size</th><th scope="col">Availability</th></tr><tr><td>Small</td><td>Available</td></tr></table><table><caption>Implied tail</caption><tr><th rowspan="3" scope="rowgroup">Period</th><td rowspan="3">Value</td></tr></table></main></body></html>',
      });
    });
    const response = await page.goto('http://127.0.0.1:45986/');
    await auditCurrentPage(
      page,
      testInfo,
      'en',
      headersAvailable ? await response?.allHeaders() : undefined,
    );
    expect(navigations).toBe(1);
    expect(testInfo.attachments.some(attachment => attachment.name === 'accessibility.json')).toBe(
      true,
    );
    expect(testInfo.attachments.some(attachment => attachment.name === 'spelling.json')).toBe(true);
    expect(
      testInfo.attachments.some(attachment => attachment.name === 'shared-page-evidence'),
    ).toBe(true);
    expect(testInfo.attachments.some(attachment => attachment.name === 'modern-web.json')).toBe(
      true,
    );
    expect(testInfo.attachments.some(attachment => attachment.name === 'modern-web.txt')).toBe(
      true,
    );
    const attachment = testInfo.attachments.find(item => item.name === 'modern-web.json')!;
    const evidence = JSON.parse(attachment.body!.toString());
    // Source: https://html.spec.whatwg.org/multipage/tables.html#attr-tdth-headers
    // Pages uses the same passive bounded graph without refetching or probing UI.
    expect(evidence.dataWidgets.observations.tables[0]).toMatchObject({
      headerGraphNodes: 3,
      cyclicRenderedHeaders: 0,
      duplicateReferenceTokens: 0,
      headerGraphLimited: false,
      headerAssociationsAndSpeechVerified: false,
      spanOccupancy: {
        status: 'observed',
        overlapPlacements: 0,
        groupScopes: {
          status: 'observed',
          columnGroupHeaders: 1,
          columnGroupCandidatePairs: 0,
          explicitHeadersCells: 4,
          unanchoredColumnGroupHeaders: 0,
          completeHeaderAssociationsVerified: false,
        },
        gridCoverage: {
          status: 'observed',
          declaredColumns: 2,
          columnGroups: 1,
          columnElements: 0,
          uncoveredSlots: 0,
          rowsWithoutAnchors: 0,
          columnsWithoutAnchors: 0,
        },
        automaticHeaderAssociationsVerified: false,
        otherTableModelErrorsVerified: false,
      },
    });
    // Source: https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
    // Serialize observed simple and declared-column grids
    // through Pages without a second document visit or any active probing.
    expect(evidence.dataWidgets.observations.tables[1].spanOccupancy.gridCoverage).toMatchObject({
      status: 'observed',
      checkedRows: 2,
      checkedColumns: 2,
      uncoveredSlots: 0,
      rowsWithoutAnchors: 0,
      columnsWithoutAnchors: 0,
      headerAssociationsVerified: false,
      renderedGapsVerified: false,
    });
    // Source: west/north header scanning does not replace explicit headers.
    // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
    expect(evidence.dataWidgets.observations.tables[0].spanOccupancy.headerScan).toMatchObject({
      status: 'observed',
      explicitHeadersCells: 4,
      scannedPairs: 0,
    });
    expect(evidence.dataWidgets.observations.tables[1].spanOccupancy.headerScan).toMatchObject({
      status: 'observed',
      columnScanPairs: 2,
      automaticDataCells: 2,
      dataCellsWithScannedHeaders: 2,
      completeHeaderAssociationsVerified: false,
      speechVerified: false,
    });
    // Source: final header assignment after explicit precedence and set cleanup.
    // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
    expect(
      evidence.dataWidgets.observations.tables[0].spanOccupancy.headerAssignments,
    ).toMatchObject({
      status: 'observed',
      assignedPairs: 6,
      explicitPairs: 6,
      explicitCells: 4,
      dataCellsWithHeaders: 2,
      structuralAssignmentSubsetVerified: true,
      accessibilityTreeVerified: false,
    });
    expect(
      evidence.dataWidgets.observations.tables[1].spanOccupancy.headerAssignments,
    ).toMatchObject({ status: 'observed', assignedPairs: 2, automaticPairs: 2 });
    expect(
      evidence.dataWidgets.observations.tables[2].spanOccupancy.headerAssignments,
    ).toMatchObject({ status: 'observed', assignedPairs: 1, automaticPairs: 1 });
    // HTML group closure creates two logical rows without DOM tr elements.
    // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
    expect(evidence.dataWidgets.observations.tables[2].spanOccupancy).toMatchObject({
      status: 'observed',
      checkedRows: 1,
      modeledRows: 3,
      impliedRows: 2,
      groupScopes: {
        status: 'observed',
        rowGroupHeaders: 1,
        rowGroupCandidatePairs: 1,
        speechVerified: false,
      },
      gridCoverage: {
        checkedRows: 3,
        declaredRows: 1,
        modeledRows: 3,
        impliedRows: 2,
        uncoveredSlots: 0,
        rowsWithoutAnchors: 2,
      },
    });
    expect(evidence.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'table-grid-anchors',
          severity: 'warning',
          evidence: expect.objectContaining({
            modeledRows: 3,
            impliedRows: 2,
            rowsWithoutAnchors: 2,
          }),
        }),
      ]),
    );
    if (headersAvailable) {
      expect(evidence.documentPolicies).toMatchObject({
        responseHeadersObserved: true,
        policies: [
          expect.objectContaining({
            disposition: 'report',
            reporting: expect.objectContaining({
              endpointNameObserved: false,
              deliveryVerified: false,
            }),
          }),
        ],
      });
      expect(evidence.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule: 'policy-csp-reporting-endpoint', severity: 'warning' }),
        ]),
      );
    } else {
      expect(evidence.documentPolicies).toMatchObject({
        responseHeadersObserved: false,
        policies: [],
      });
      expect(
        evidence.findings.some(
          (finding: { rule: string }) => finding.rule === 'policy-csp-reporting-endpoint',
        ),
      ).toBe(false);
    }
    expect(JSON.stringify(evidence)).not.toMatch(
      /owned-private-group|owned-private-receiver|owned-private-value/,
    );
  });

for (const finalMatches of [true, false])
  test(`redirected shared audit uses only final response policy: endpoint match ${finalMatches}`, async ({
    page,
  }, testInfo) => {
    let documentRequests = 0;
    let origin = '';
    // Real loopback redirects: Playwright routes do not re-intercept every hop.
    const server = http.createServer((request, response) => {
      if (request.url === '/start') {
        documentRequests++;
        response.writeHead(302, {
          location: '/final',
          'content-security-policy-report-only': 'report-to private-redirect',
          'reporting-endpoints': `${finalMatches ? 'unrelated' : 'private-redirect'}="/private-before?token=private-redirect-token"`,
        });
        response.end();
      } else if (request.url === '/final') {
        documentRequests++;
        response.writeHead(200, {
          'content-type': 'text/html',
          'content-security-policy-report-only': 'report-to private-final',
          'reporting-endpoints': `${finalMatches ? 'private-final' : 'unrelated'}="/private-after?token=private-final-token"`,
        });
        response.end(
          `<!doctype html><html lang="en"><head><title>Local shared page</title><link rel="canonical" href="${origin}/final"></head><body><main><h1>Local shared page</h1><p>Welcome to the store.</p></main></body></html>`,
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
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await page.goto(origin + '/start');
      expect(response?.url()).toBe(origin + '/final');
      expect(response?.request().redirectedFrom()).not.toBeNull();
      await auditCurrentPage(page, testInfo, 'en', await response?.allHeaders());
      // Two redirect-chain requests, with no audit-triggered revisit or refetch.
      expect(documentRequests).toBe(2);
      const attachment = testInfo.attachments.find(item => item.name === 'modern-web.json')!;
      const evidence = JSON.parse(attachment.body!.toString());
      expect(evidence.documentPolicies).toMatchObject({
        responseHeadersObserved: true,
        policies: [
          expect.objectContaining({
            reporting: expect.objectContaining({
              endpointNameObserved: finalMatches,
              deliveryVerified: false,
            }),
          }),
        ],
      });
      expect(
        evidence.findings.some(
          (finding: { rule: string }) => finding.rule === 'policy-csp-reporting-endpoint',
        ),
      ).toBe(!finalMatches);
      expect(JSON.stringify(evidence)).not.toMatch(
        /private-redirect|private-final|private-before|private-after/,
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
