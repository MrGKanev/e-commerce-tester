// Source: https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-processing-row-groups
// Row/slot bounds alone do not bound a table containing many empty groups.
// This is a local work limit, not a merchant table-conformance requirement.
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';

test('span occupancy bounds group traversal as well as rows/cells/slots', async ({ page }) => {
  await page.setContent(
    '<!doctype html><table>' + '<tbody><tr><th>Group</th></tr></tbody>'.repeat(100) + '</table>',
  );
  const boundary = await inspectDataWidgets(page);
  expect(boundary.coverage.spanGroupLimit).toBe(100);
  expect(boundary.observations.tables[0].spanOccupancy).toMatchObject({
    status: 'observed',
    overlapPlacements: 0,
    checkedRows: 100,
  });
  await page.setContent(
    '<!doctype html><table><caption>Group limit</caption><tbody><tr><th>Only row</th></tr></tbody>' +
      '<tbody></tbody>'.repeat(100) +
      '</table>',
  );
  const limited = await inspectDataWidgets(page);
  expect(limited.observations.tables[0].spanOccupancy).toMatchObject({
    status: 'unverified',
    reason: 'row-group-limit',
    overlapPlacements: null,
  });
  expect(limited.findings.filter(f => f.rule === 'table-span-overlap')).toEqual([]);
});
