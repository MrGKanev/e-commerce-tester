// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// responsive-table: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// progress-ring: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/progress-ring.md
// Check exposed structural relationships/counts without changing the DOM.
// Hidden explicit header targets remain resolvable; no AT speech/completion claim.
import type { Page } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

/** Passive bounded table/progress samples; no focus, scrolling, state changes or resource requests. */
export async function inspectDataWidgets(page: Page) {
  const snapshot = await page.evaluate(() => {
    const limit = 20;
    const cellLimit = 200;
    const headerTokenLimit = 64;
    const headerAttributeLimit = 8192;
    const spanRowLimit = 100,
      spanColumnLimit = 128,
      spanSlotLimit = 4096,
      columnStructureLimit = 256;
    const findings: WebFinding[] = [];
    const selector = (el: Element, structural = false): string => {
      if (!structural && el.id) return '#' + CSS.escape(el.id);
      const parent = el.parentElement;
      if (!parent) return el.localName;
      const peers = [...parent.children].filter(peer => peer.localName === el.localName);
      return `${selector(parent, structural)} > ${el.localName}:nth-of-type(${peers.indexOf(el) + 1})`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
        if (getComputedStyle(ancestor).contentVisibility === 'hidden') return false;
      }
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.display !== 'none' &&
        s.visibility === 'visible' &&
        !el.closest('[hidden],[inert],[aria-hidden="true"]')
      );
    };
    const named = (el: Element) =>
      Boolean(
        el.getAttribute('title')?.trim() ||
        el.getAttribute('aria-label')?.trim() ||
        (el.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .some(id => document.getElementById(id)?.textContent?.trim()) ||
        (el instanceof HTMLProgressElement && el.labels?.length),
      );
    const add = (
      rule: string,
      guide: string,
      el: Element,
      evidence: Record<string, unknown>,
      recommendation: string,
      structural = false,
    ) =>
      findings.push({
        rule,
        guide,
        severity: 'warning',
        selector: selector(el, structural),
        evidence,
        recommendation,
      });
    // Count only IDs actually referenced by the bounded cell sample. Hidden duplicate
    // targets still make a document ID ambiguous; unrelated duplicates are out of scope.
    const targetCounts = new Map<string, number>();
    const targetCount = (id: string) => {
      if (!targetCounts.has(id))
        targetCounts.set(id, document.querySelectorAll('#' + CSS.escape(id)).length);
      return targetCounts.get(id)!;
    };
    // Sources: HTML table-model row processing/overlap and row-group boundaries:
    // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-processing-rows
    // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-processing-row-groups
    // Skip occupied starting slots, then inspect the complete new rectangle.
    // IDL spans supply browser normalization; rowspan=0 ends at its row group.
    // Restrict to fully rendered native groups and a bounded logical row grid.
    // Non-native/hidden layouts or limits are unknown, not store failures.
    // This is structural occupancy, not CSS box overlap or header/AT association.
    const inspectSpans = (table: HTMLTableElement, ownCells: HTMLTableCellElement[]) => {
      const unknownGrid = (reason: string) => ({
        status: 'unverified',
        reason,
        uncoveredSlots: null,
        declaredColumns: null,
        columnGroups: null,
        columnElements: null,
        columnStructureLimit,
        rowsWithoutAnchors: null,
        declaredRows: null,
        modeledRows: null,
        impliedRows: null,
        columnsWithoutAnchors: null,
        headerAssociationsVerified: false,
        renderedGapsVerified: false,
      });
      const unknownGroupScopes = (reason: string) => ({
        status: 'unverified',
        reason,
        rowGroupHeaders: null,
        columnGroupHeaders: null,
        unanchoredColumnGroupHeaders: null,
        rowGroupCandidatePairs: null,
        columnGroupCandidatePairs: null,
        explicitHeadersCells: null,
        emptyGroupHeaders: null,
        pairLimit: cellLimit * cellLimit,
        headerTextLimit: headerAttributeLimit,
        completeHeaderAssociationsVerified: false,
        speechVerified: false,
      });
      const unknownHeaderScan = (reason: string) => ({
        status: 'unverified',
        reason,
        automaticCells: null,
        explicitHeadersCells: null,
        rowHeaderCells: null,
        columnHeaderCells: null,
        autoRowHeaders: null,
        autoColumnHeaders: null,
        rowScanPairs: null,
        columnScanPairs: null,
        scannedPairs: null,
        automaticDataCells: null,
        dataCellsWithScannedHeaders: null,
        dataCellsWithoutScannedHeaders: null,
        slotVisits: null,
        workUnits: null,
        cells: null,
        workLimit: 100000,
        headerTextLimit: headerAttributeLimit,
        completeHeaderAssociationsVerified: false,
        speechVerified: false,
      });
      const unknownHeaderAssignments = (reason: string) => ({
        status: 'unverified',
        reason,
        assignedPairs: null,
        automaticPairs: null,
        explicitPairs: null,
        explicitCells: null,
        automaticCells: null,
        dataCells: null,
        dataCellsWithHeaders: null,
        dataCellsWithoutHeaders: null,
        explicitDataTargets: null,
        cells: null,
        tokenLimit: headerTokenLimit,
        attributeLimit: headerAttributeLimit,
        structuralAssignmentSubsetVerified: false,
        accessibilityTreeVerified: false,
        speechVerified: false,
      });
      const unknown = (reason: string) => ({
        status: 'unverified',
        reason,
        overlapPlacements: null,
        modeledRows: null,
        impliedRows: null,
        modelRowLimit: spanRowLimit,
        slotAssignments: null,
        gridCoverage: unknownGrid(reason),
        groupScopes: unknownGroupScopes(reason),
        headerScan: unknownHeaderScan(reason),
        headerAssignments: unknownHeaderAssignments(reason),
        automaticHeaderAssociationsVerified: false,
        otherTableModelErrorsVerified: false,
        renderedOverlapVerified: false,
      });
      if (document.compatMode !== 'CSS1Compat') return unknown('non-standards-document');
      if (ownCells.length > cellLimit || table.rows.length > spanRowLimit)
        return unknown('cell-or-row-limit');
      if (
        !['table', 'inline-table'].includes(getComputedStyle(table).display) ||
        table.matches('[role="grid"],[role="treegrid"]')
      )
        return unknown('non-native-table-layout');
      const groups = [...table.children].filter(
        (el): el is HTMLTableSectionElement => el instanceof HTMLTableSectionElement,
      );
      if (groups.length > spanRowLimit) return unknown('row-group-limit');
      if (!groups.length || [...table.children].some(el => el.localName === 'tr'))
        return unknown('unsupported-row-group-structure');
      const groupedCells: HTMLTableCellElement[] = [];
      const pending: Array<{ cell: HTMLTableCellElement; evidence: Record<string, unknown> }> = [];
      const occupancyRows: Array<Map<number, HTMLTableCellElement>> = [];
      const columnAnchors = new Set<number>();
      const placements = new Map<
        HTMLTableCellElement,
        {
          groupIndex: number;
          row: number;
          column: number;
          width: number;
          height: number;
        }
      >();
      let slotAssignments = 0,
        checkedRows = 0,
        impliedRows = 0,
        gridWidth = 0,
        rowsWithoutAnchors = 0;
      // HTML defers tfoot processing until all other groups, even if authored
      // earlier. Retain DOM groupIndex in evidence but use logical row order.
      const orderedGroups = [
        ...groups.filter(group => group.localName !== 'tfoot'),
        ...groups.filter(group => group.localName === 'tfoot'),
      ];
      for (const group of orderedGroups) {
        const groupIndex = groups.indexOf(group);
        if (
          !['table-row-group', 'table-header-group', 'table-footer-group'].includes(
            getComputedStyle(group).display,
          )
        )
          return unknown('non-native-or-hidden-group');
        const rows = [...group.rows];
        // Sources: HTML row processing grows y_height for positive spans;
        // ending a row group grows rowspan=0 cells through that implied tail.
        // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
        // Precompute final group height before placing cells: positive extents
        // depend only on row indices, not column placement. This makes zero
        // spans cover the same future slots as native downward growth. Never
        // allocate using an unbounded authored span; cap total logical rows.
        let groupHeight = rows.length;
        for (const [rowIndex, row] of rows.entries()) {
          if (
            row.parentElement !== group ||
            getComputedStyle(row).display !== 'table-row' ||
            getComputedStyle(row).visibility !== 'visible'
          )
            return unknown('non-native-or-hidden-row');
          for (const cell of row.cells) {
            if (
              cell.closest('table') !== table ||
              !visible(cell) ||
              getComputedStyle(cell).display !== 'table-cell'
            )
              return unknown('non-native-or-hidden-cell');
            if (cell.rowSpan > 0) groupHeight = Math.max(groupHeight, rowIndex + cell.rowSpan);
          }
        }
        if (groupHeight > spanRowLimit - occupancyRows.length) return unknown('model-row-limit');
        const groupImpliedRows = groupHeight - rows.length;
        impliedRows += groupImpliedRows;
        rowsWithoutAnchors += groupImpliedRows;
        const grid = Array.from(
          { length: groupHeight },
          () => new Map<number, HTMLTableCellElement>(),
        );
        const rowBase = occupancyRows.length;
        occupancyRows.push(...grid);
        for (const [rowIndex, row] of rows.entries()) {
          checkedRows++;
          if (!row.cells.length) rowsWithoutAnchors++;
          let column = 0;
          for (const cell of row.cells) {
            groupedCells.push(cell);
            const width = cell.colSpan;
            const height = cell.rowSpan === 0 ? groupHeight - rowIndex : cell.rowSpan;
            while (grid[rowIndex].has(column)) column++;
            if (column + width > spanColumnLimit) return unknown('column-limit');
            if (slotAssignments + width * height > spanSlotLimit) return unknown('slot-limit');
            placements.set(cell, { groupIndex, row: rowBase + rowIndex, column, width, height });
            let overlappingSlotCount = 0;
            for (let y = rowIndex; y < rowIndex + height; y++) {
              for (let x = column; x < column + width; x++) {
                if (grid[y].has(x)) overlappingSlotCount++;
                else grid[y].set(x, cell);
              }
            }
            slotAssignments += width * height;
            if (overlappingSlotCount)
              pending.push({
                cell,
                evidence: {
                  groupIndex,
                  rowIndex,
                  column,
                  normalizedRowSpan: height,
                  normalizedColSpan: width,
                  overlappingSlotCount,
                  nativeModelSubset: true,
                },
              });
            columnAnchors.add(column);
            column += width;
            gridWidth = Math.max(gridWidth, column);
          }
        }
      }
      if (
        groupedCells.length !== ownCells.length ||
        ownCells.some(cell => !groupedCells.includes(cell))
      )
        return unknown('unsupported-cell-ownership');
      // Buffer until the complete bounded model succeeds. A later exclusion must
      // not leave warnings based on an incomplete table model. No cell text/IDs.
      for (const { cell, evidence } of pending)
        add(
          'table-span-overlap',
          'responsive-table',
          cell,
          evidence,
          'Review overlapping rowspan/colspan slots in this bounded native HTML table model; keep spans within a non-overlapping row-group grid and verify header relationships separately.',
          true,
        );
      // Source: HTML forming-a-table step 9. Only leading column groups
      // establish the initial width. A group's span is ignored when it has col
      // children; native IDL span reflects the parsed/defaulted 1..1000 range.
      // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
      // Column boxes may have zero height: validate native display/visibility,
      // not the ordinary cell visible() geometry test. Hidden/collapsed/late or
      // malformed programmatic structures remain unknown, never store errors.
      const inspectColumns = () => {
        const unverified = (reason: string) => ({
          status: 'unverified' as const,
          reason,
          declaredColumns: 0,
          columnGroups: 0,
          columnElements: 0,
          ranges: [] as Array<{ start: number; end: number }>,
        });
        let declaredColumns = 0,
          columnGroups = 0,
          columnElements = 0,
          visited = 0;
        const ranges: Array<{ start: number; end: number }> = [];
        let rowsStarted = false;
        const native = (el: Element, display: string) => {
          const style = getComputedStyle(el);
          return (
            style.display === display &&
            style.visibility === 'visible' &&
            !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
            style.contentVisibility !== 'hidden'
          );
        };
        for (const child of table.children) {
          if (++visited > columnStructureLimit) return unverified('column-structure-limit');
          if (['thead', 'tbody', 'tfoot', 'tr'].includes(child.localName)) rowsStarted = true;
          if (child.localName === 'col') return unverified('unsupported-column-ownership');
          if (child.localName !== 'colgroup') continue;
          if (rowsStarted) return unverified('late-column-group');
          if (!(child instanceof HTMLTableColElement) || !native(child, 'table-column-group'))
            return unverified('non-native-or-hidden-column');
          columnGroups++;
          const start = declaredColumns;
          const cols: HTMLTableColElement[] = [];
          for (const column of child.children) {
            if (++visited > columnStructureLimit) return unverified('column-structure-limit');
            if (column.localName === 'col' && column instanceof HTMLTableColElement)
              cols.push(column);
            else if (!['script', 'template'].includes(column.localName))
              return unverified('unsupported-column-structure');
          }
          if (!cols.length) declaredColumns += child.span;
          else
            for (const column of cols) {
              if (!native(column, 'table-column')) return unverified('non-native-or-hidden-column');
              columnElements++;
              declaredColumns += column.span;
              if (declaredColumns > spanColumnLimit) return unverified('declared-column-limit');
            }
          if (declaredColumns > spanColumnLimit) return unverified('declared-column-limit');
          ranges.push({ start, end: declaredColumns });
        }
        return {
          status: 'observed' as const,
          declaredColumns,
          columnGroups,
          columnElements,
          ranges,
        };
      };
      const columns = inspectColumns();
      // HTML's complete-grid authoring requirement and forming-a-table step 20
      // are different checks: an uncovered slot is not an empty cell, and a row
      // fully covered by a previous rowspan may still lack an anchored cell.
      // Sources: https://html.spec.whatwg.org/multipage/tables.html#the-table-element
      // https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
      // Only publish after the bounded span and column models succeed.
      // Overlapping/unsupported column models remain unknown.
      // No text/IDs, CSS gap or screen-reader/header inference is collected.
      const gridCoverage = pending.length
        ? unknownGrid('overlapping-model')
        : columns.status === 'unverified'
          ? unknownGrid(columns.reason)
          : !Math.max(gridWidth, columns.declaredColumns) || !occupancyRows.length
            ? unknownGrid('zero-dimension-grid')
            : (() => {
                gridWidth = Math.max(gridWidth, columns.declaredColumns);
                const uncoveredSlots = occupancyRows.reduce(
                  (sum, row) => sum + gridWidth - row.size,
                  0,
                );
                const columnsWithoutAnchors = gridWidth - columnAnchors.size;
                const evidence = {
                  checkedRows: occupancyRows.length,
                  declaredRows: checkedRows,
                  modeledRows: occupancyRows.length,
                  impliedRows,
                  checkedColumns: gridWidth,
                  uncoveredSlots,
                  rowsWithoutAnchors,
                  columnsWithoutAnchors,
                  nativeModelSubset: true,
                  declaredColumns: columns.declaredColumns,
                  columnGroups: columns.columnGroups,
                  columnElements: columns.columnElements,
                  columnStructureLimit,
                };
                if (uncoveredSlots)
                  add(
                    'table-grid-gap',
                    'responsive-table',
                    table,
                    evidence,
                    'Review uncovered slots in this bounded native table grid. Explicit empty td/th cells count as covered; CSS spacing is not an uncovered slot.',
                    true,
                  );
                if (rowsWithoutAnchors || columnsWithoutAnchors)
                  add(
                    'table-grid-anchors',
                    'responsive-table',
                    table,
                    evidence,
                    'Review rows or columns with no cell anchored in them, as defined by the HTML table model. Coverage by a previous span is different from anchoring.',
                    true,
                  );
                return {
                  status: 'observed',
                  ...evidence,
                  headerAssociationsVerified: false,
                  renderedGapsVerified: false,
                };
              })();
      // Sources: scope constraints and header assignment steps 3, 5/6, 4/6:
      // https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope
      // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
      // These are ONLY group-scope candidate pairs, not the row/column/Auto
      // scanning algorithm or accessibility-tree/speech proof. Explicit headers
      // (even empty) bypass automatic candidates; empty headers and self are
      // excluded. A spanning cell is grouped by its anchor, not its last slot.
      const groupAssignments = new Map<HTMLTableCellElement, Set<HTMLTableCellElement>>();
      const scanAssignments = new Map<HTMLTableCellElement, Set<HTMLTableCellElement>>();
      const inspectGroupScopes = () => {
        if (pending.length) return unknownGroupScopes('overlapping-model');
        if (columns.status === 'unverified') return unknownGroupScopes(columns.reason);
        const headers = [...placements.keys()].filter(
          cell =>
            cell.localName === 'th' && ['rowgroup', 'colgroup'].includes(cell.scope.toLowerCase()),
        );
        const nonempty = new Set<HTMLTableCellElement>();
        for (const header of headers) {
          if (header.children.length) nonempty.add(header);
          else {
            const content = header.textContent || '';
            if (content.length > headerAttributeLimit)
              return unknownGroupScopes('header-content-limit');
            if (/[^\t\n\f\r ]/.test(content)) nonempty.add(header);
          }
        }
        const groupAt = (column: number) =>
          columns.ranges.findIndex(range => column >= range.start && column < range.end);
        const columnMembership = new Map(
          [...placements].map(([cell, anchor]) => [cell, groupAt(anchor.column)] as const),
        );
        let rowGroupHeaders = 0,
          columnGroupHeaders = 0,
          unanchoredColumnGroupHeaders = 0;
        for (const header of headers) {
          if (header.scope.toLowerCase() === 'rowgroup') rowGroupHeaders++;
          else {
            columnGroupHeaders++;
            const anchor = placements.get(header)!;
            if (columnMembership.get(header)! < 0) {
              unanchoredColumnGroupHeaders++;
              add(
                'table-header-colgroup-anchor',
                'responsive-table',
                header,
                {
                  groupIndex: anchor.groupIndex,
                  row: anchor.row,
                  column: anchor.column,
                  normalizedColSpan: anchor.width,
                  declaredColumnGroups: columns.columnGroups,
                  declaredColumns: columns.declaredColumns,
                },
                'Review scope=colgroup on a header anchored outside every declared column group. Colspan does not create a colgroup; a cell spanning several groups is associated by its starting slot.',
                true,
              );
            }
          }
        }
        let rowGroupCandidatePairs = 0,
          columnGroupCandidatePairs = 0,
          explicitHeadersCells = 0;
        for (const [cell, principal] of placements) {
          if (cell.hasAttribute('headers')) {
            explicitHeadersCells++;
            continue;
          }
          const selected = new Set<HTMLTableCellElement>();
          groupAssignments.set(cell, selected);
          for (const header of headers) {
            if (header === cell || !nonempty.has(header)) continue;
            const anchor = placements.get(header)!;
            if (
              anchor.column > principal.column + principal.width - 1 ||
              anchor.row > principal.row + principal.height - 1
            )
              continue;
            if (header.scope.toLowerCase() === 'rowgroup') {
              if (anchor.groupIndex === principal.groupIndex) {
                rowGroupCandidatePairs++;
                selected.add(header);
              }
            } else {
              const group = columnMembership.get(cell)!;
              if (group >= 0 && group === columnMembership.get(header)) {
                columnGroupCandidatePairs++;
                selected.add(header);
              }
            }
          }
        }
        return {
          status: 'observed',
          rowGroupHeaders,
          columnGroupHeaders,
          unanchoredColumnGroupHeaders,
          rowGroupCandidatePairs,
          columnGroupCandidatePairs,
          explicitHeadersCells,
          emptyGroupHeaders: headers.length - nonempty.size,
          pairLimit: cellLimit * cellLimit,
          headerTextLimit: headerAttributeLimit,
          completeHeaderAssociationsVerified: false,
          speechVerified: false,
        };
      };
      const groupScopes = inspectGroupScopes();
      // Source: HTML assigning-header-cells: west/north scans, opaque header
      // blocks and Auto orientation rules. Do not replace this with nearest-th
      // geometry. Keep this evidence separate; headerAssignments merges the bounded lists below.
      // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
      // All text/element references remain private. Output numeric cell positions
      // and deduplicated counts only. Limits are local scope, not store errors.
      const inspectHeaderScan = () => {
        if (pending.length) return unknownHeaderScan('overlapping-model');
        if (columns.status === 'unverified') return unknownHeaderScan(columns.reason);
        const dataRows = new Set<number>(),
          dataColumns = new Set<number>();
        for (const [row, slots] of occupancyRows.entries())
          for (const [column, cell] of slots) {
            if (cell.localName === 'td') {
              dataRows.add(row);
              dataColumns.add(column);
            }
          }
        const rowHeaders = new Set<HTMLTableCellElement>(),
          columnHeaders = new Set<HTMLTableCellElement>();
        const nonempty = new Set<HTMLTableCellElement>();
        let autoRowHeaders = 0,
          autoColumnHeaders = 0;
        for (const [cell, anchor] of placements) {
          if (cell.localName !== 'th') continue;
          const scope = cell.scope.toLowerCase();
          const auto = !['row', 'col', 'rowgroup', 'colgroup'].includes(scope);
          const noDataRows = Array.from({ length: anchor.height }, (_, i) => anchor.row + i).every(
            row => !dataRows.has(row),
          );
          const noDataColumns = Array.from(
            { length: anchor.width },
            (_, i) => anchor.column + i,
          ).every(column => !dataColumns.has(column));
          const column = scope === 'col' || (auto && noDataRows);
          const row = scope === 'row' || (auto && !column && noDataColumns);
          if (column) {
            columnHeaders.add(cell);
            if (auto) autoColumnHeaders++;
          }
          if (row) {
            rowHeaders.add(cell);
            if (auto) autoRowHeaders++;
          }
          if (!row && !column) continue;
          if (cell.children.length) nonempty.add(cell);
          else {
            const text = cell.textContent || '';
            if (text.length > headerAttributeLimit)
              return unknownHeaderScan('header-content-limit');
            if (/[^\t\n\f\r ]/.test(text)) nonempty.add(cell);
          }
        }
        let workUnits = 0,
          slotVisits = 0;
        const exhausted = Symbol('header-scan-work-limit');
        const spend = () => {
          if (++workUnits > 100000) throw exhausted;
        };
        const scan = (
          principal: HTMLTableCellElement,
          x: number,
          y: number,
          vertical: boolean,
          found: Set<HTMLTableCellElement>,
        ) => {
          const opaque = new Set<HTMLTableCellElement>();
          let inBlock = principal.localName === 'th';
          const block = new Set<HTMLTableCellElement>(inBlock ? [principal] : []);
          while (true) {
            if (vertical) y--;
            else x--;
            if (x < 0 || y < 0) return;
            spend();
            slotVisits++;
            const cell = occupancyRows[y]?.get(x);
            if (!cell) continue; // Missing slots do not terminate scanning.
            if (cell.localName === 'th') {
              inBlock = true;
              block.add(cell);
              const anchor = placements.get(cell)!;
              let blocked = !(vertical ? columnHeaders : rowHeaders).has(cell);
              if (!blocked)
                for (const other of opaque) {
                  spend();
                  const previous = placements.get(other)!;
                  if (
                    vertical
                      ? previous.column === anchor.column && previous.width === anchor.width
                      : previous.row === anchor.row && previous.height === anchor.height
                  ) {
                    blocked = true;
                    break;
                  }
                }
              if (!blocked) found.add(cell);
            } else if (inBlock) {
              inBlock = false;
              for (const header of block) opaque.add(header);
              block.clear();
            }
          }
        };
        let automaticCells = 0,
          explicitHeadersCells = 0,
          rowScanPairs = 0,
          columnScanPairs = 0,
          scannedPairs = 0,
          automaticDataCells = 0,
          dataCellsWithScannedHeaders = 0;
        const cells: Array<Record<string, number | string>> = [];
        try {
          for (const [cell, anchor] of placements) {
            if (cell.hasAttribute('headers')) {
              explicitHeadersCells++;
              continue;
            }
            automaticCells++;
            const rowFound = new Set<HTMLTableCellElement>(),
              colFound = new Set<HTMLTableCellElement>();
            if (rowHeaders.size)
              for (let y = anchor.row; y < anchor.row + anchor.height; y++)
                scan(cell, anchor.column, y, false, rowFound);
            if (columnHeaders.size)
              for (let x = anchor.column; x < anchor.column + anchor.width; x++)
                scan(cell, x, anchor.row, true, colFound);
            for (const found of [rowFound, colFound])
              for (const header of found)
                if (header === cell || !nonempty.has(header)) found.delete(header);
            const selected = new Set([...rowFound, ...colFound]);
            scanAssignments.set(cell, selected);
            const count = selected.size;
            rowScanPairs += rowFound.size;
            columnScanPairs += colFound.size;
            scannedPairs += count;
            if (cell.localName === 'td') {
              automaticDataCells++;
              if (count) dataCellsWithScannedHeaders++;
            }
            cells.push({
              row: anchor.row,
              column: anchor.column,
              kind: cell.localName,
              rowHeaders: rowFound.size,
              columnHeaders: colFound.size,
              headers: count,
            });
          }
        } catch (error) {
          if (error === exhausted) return unknownHeaderScan('header-scan-work-limit');
          throw error;
        }
        return {
          status: 'observed',
          automaticCells,
          explicitHeadersCells,
          rowHeaderCells: rowHeaders.size,
          columnHeaderCells: columnHeaders.size,
          autoRowHeaders,
          autoColumnHeaders,
          rowScanPairs,
          columnScanPairs,
          scannedPairs,
          automaticDataCells,
          dataCellsWithScannedHeaders,
          dataCellsWithoutScannedHeaders: automaticDataCells - dataCellsWithScannedHeaders,
          slotVisits,
          workUnits,
          workLimit: 100000,
          headerTextLimit: headerAttributeLimit,
          cells,
          completeHeaderAssociationsVerified: false,
          speechVerified: false,
        };
      };
      const headerScan = inspectHeaderScan();
      // Source: the complete assignment algorithm uses explicit headers INSTEAD
      // of automatic scanning, then removes empty/self targets and duplicates.
      // https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
      // Native first-ID lookup is intentional, including malformed duplicate IDs.
      // Authoring diagnostics (non-th targets/cycles/duplicate IDs) remain separate:
      // the processing algorithm can select a td, and does not expand chains.
      // Only this bounded structural subset is verified, never AX or AT speech.
      const inspectHeaderAssignments = () => {
        if (pending.length) return unknownHeaderAssignments('overlapping-model');
        if (columns.status === 'unverified') return unknownHeaderAssignments(columns.reason);
        if (groupScopes.status !== 'observed')
          return unknownHeaderAssignments('group-scope-unverified');
        if (headerScan.status !== 'observed')
          return unknownHeaderAssignments('header-scan-unverified');
        let assignedPairs = 0,
          automaticPairs = 0,
          explicitPairs = 0,
          explicitCells = 0,
          automaticCells = 0,
          dataCells = 0,
          dataCellsWithHeaders = 0,
          explicitDataTargets = 0;
        const cells: Array<Record<string, number | string>> = [];
        const emptyCache = new Map<HTMLTableCellElement, boolean>();
        for (const [cell, anchor] of placements) {
          const explicit = cell.hasAttribute('headers');
          const selected = new Set<HTMLTableCellElement>();
          if (explicit) {
            explicitCells++;
            const raw = cell.getAttribute('headers') || '';
            if (raw.length > headerAttributeLimit)
              return unknownHeaderAssignments('headers-attribute-limit');
            const tokens = raw.split(/[\t\n\f\r ]+/).filter(Boolean);
            if (tokens.length > headerTokenLimit)
              return unknownHeaderAssignments('headers-token-limit');
            for (const id of tokens) {
              const target = document.getElementById(id);
              if (
                target instanceof HTMLTableCellElement &&
                target !== cell &&
                target.closest('table') === table
              ) {
                if (!placements.has(target))
                  return unknownHeaderAssignments('target-outside-model');
                selected.add(target);
              }
            }
          } else {
            automaticCells++;
            for (const target of scanAssignments.get(cell) || []) selected.add(target);
            for (const target of groupAssignments.get(cell) || []) selected.add(target);
          }
          for (const target of selected) {
            if (target === cell) {
              selected.delete(target);
              continue;
            }
            if (!emptyCache.has(target)) {
              if (target.children.length) emptyCache.set(target, false);
              else {
                const content = target.textContent || '';
                if (content.length > headerAttributeLimit)
                  return unknownHeaderAssignments('target-content-limit');
                emptyCache.set(target, !/[^\t\n\f\r ]/.test(content));
              }
            }
            if (emptyCache.get(target)) selected.delete(target);
          }
          const count = selected.size;
          assignedPairs += count;
          if (explicit) {
            explicitPairs += count;
            explicitDataTargets += [...selected].filter(target => target.localName === 'td').length;
          } else automaticPairs += count;
          if (cell.localName === 'td') {
            dataCells++;
            if (count) dataCellsWithHeaders++;
          }
          cells.push({
            row: anchor.row,
            column: anchor.column,
            kind: cell.localName,
            source: explicit ? 'explicit' : 'automatic',
            headers: count,
          });
        }
        return {
          status: 'observed',
          assignedPairs,
          automaticPairs,
          explicitPairs,
          explicitCells,
          automaticCells,
          dataCells,
          dataCellsWithHeaders,
          dataCellsWithoutHeaders: dataCells - dataCellsWithHeaders,
          explicitDataTargets,
          cells,
          tokenLimit: headerTokenLimit,
          attributeLimit: headerAttributeLimit,
          structuralAssignmentSubsetVerified: true,
          accessibilityTreeVerified: false,
          speechVerified: false,
        };
      };
      const headerAssignments = inspectHeaderAssignments();

      return {
        status: 'observed',
        gridCoverage,
        groupScopes,
        headerScan,
        headerAssignments,
        overlapPlacements: pending.length,
        slotAssignments,
        checkedRows,
        modeledRows: occupancyRows.length,
        impliedRows,
        modelRowLimit: spanRowLimit,
        automaticHeaderAssociationsVerified: false,
        otherTableModelErrorsVerified: false,
        renderedOverlapVerified: false,
      };
    };
    const allTables = [...document.querySelectorAll<HTMLTableElement>('table')].filter(
      el => visible(el) && !el.matches('[role="presentation"],[role="none"]'),
    );
    const tables = allTables.slice(0, limit).map(table => {
      const ownCells = [...table.querySelectorAll<HTMLTableCellElement>('th,td')].filter(
        cell => cell.closest('table') === table,
      );
      const sampledCells = ownCells.slice(0, cellLimit);
      const cells = sampledCells.filter(visible);
      const headerCount = ownCells.filter(cell => cell.localName === 'th').length;
      const rows = [...table.rows].filter(row => row.closest('table') === table);
      const dataIntentExplicit = table.getAttribute('role') === 'table' || Boolean(table.caption);
      let invalidReferences = 0;
      let ambiguousReferences = 0;
      let duplicateReferenceTokens = 0;
      let cyclicRenderedHeaders = 0;
      let headerGraphLimited = ownCells.length > cellLimit;
      let referenceLimitedCells = 0;
      // Source: https://html.spec.whatwg.org/multipage/tables.html#attr-tdth-headers
      // headers is a unique ASCII-space-separated token set, not JavaScript \s:
      // NBSP is part of an ID. A th must not target itself, including transitively.
      // Bound both attributes and graph nodes; unknown edges never invent cycles.
      const references = new Map<HTMLTableCellElement, string[] | null>();
      for (const cell of sampledCells) {
        const raw = cell.getAttribute('headers') || '';
        const tokens =
          raw.length <= headerAttributeLimit ? raw.split(/[\t\n\f\r ]+/).filter(Boolean) : null;
        if (!tokens || tokens.length > headerTokenLimit) {
          references.set(cell, null);
          referenceLimitedCells++;
          headerGraphLimited = true;
        } else references.set(cell, tokens);
      }
      const headers = sampledCells.filter(cell => cell.localName === 'th');
      const headerSet = new Set(headers);
      const edges = new Map<HTMLTableCellElement, HTMLTableCellElement[]>();
      for (const header of headers) {
        const targets: HTMLTableCellElement[] = [];
        for (const id of new Set(references.get(header) || [])) {
          const target = document.getElementById(id);
          if (targetCount(id) > 1) {
            headerGraphLimited = true;
            continue;
          }
          if (
            !(target instanceof HTMLTableCellElement) ||
            target.localName !== 'th' ||
            target.closest('table') !== table
          )
            continue;
          if (!headerSet.has(target)) {
            headerGraphLimited = true;
            continue;
          }
          targets.push(target);
        }
        edges.set(header, targets);
      }
      const targetsSelf = (origin: HTMLTableCellElement) => {
        const pending = [...(edges.get(origin) || [])];
        const visited = new Set<HTMLTableCellElement>();
        while (pending.length) {
          const target = pending.pop()!;
          if (target === origin) return true;
          if (visited.has(target)) continue;
          visited.add(target);
          pending.push(...(edges.get(target) || []));
        }
        return false;
      };
      for (const cell of cells) {
        const scope = cell.getAttribute('scope');
        if (
          cell.localName === 'th' &&
          scope &&
          !['row', 'col', 'rowgroup', 'colgroup'].includes(scope.toLowerCase())
        )
          add(
            'table-header-scope',
            'responsive-table',
            cell,
            { recognizedScopeKeyword: false, browserAutoFallback: true },
            'Review the authored header scope: use row, col, rowgroup or colgroup when an explicit relationship is intended. The browser falls back to contextual Auto for unknown values; this is not proof that associations fail.',
          );
        const tokens = references.get(cell);
        if (!tokens?.length) continue;
        const ids = [...new Set(tokens)];
        const repeated = tokens.length - ids.length;
        if (repeated) {
          duplicateReferenceTokens += repeated;
          add(
            'table-header-reference-duplicate',
            'responsive-table',
            cell,
            { duplicateTokenCount: repeated, uniqueReferenceCount: ids.length },
            'Use each explicit headers token once. Duplicate tokens violate the authored token-set syntax; they do not prove duplicate screen-reader announcements.',
            true,
          );
        }
        if (cell.localName === 'th' && targetsSelf(cell)) {
          cyclicRenderedHeaders++;
          add(
            'table-header-cycle',
            'responsive-table',
            cell,
            {
              selfTargeted: true,
              directSelfReference: (edges.get(cell) || []).includes(cell),
              sampledGraph: true,
            },
            'Remove direct or transitive self-targeting in explicit table-header relationships. Keep an acyclic hierarchy and verify complex associations with assistive technology.',
            true,
          );
        }
        const ambiguous = [...new Set(ids)].filter(id => targetCount(id) > 1);
        if (ambiguous.length) {
          ambiguousReferences += ambiguous.length;
          add(
            'table-header-reference-ambiguous',
            'responsive-table',
            cell,
            { ambiguousReferenceCount: ambiguous.length, uniqueTargetVerified: false },
            'Give each explicitly referenced header a unique document ID and update headers references; verify the resulting associations with assistive technology.',
          );
        }
        const invalid = ids.filter(id => {
          const target = document.getElementById(id);
          return !target || target.localName !== 'th' || target.closest('table') !== table;
        });
        if (invalid.length) {
          invalidReferences += invalid.length;
          add(
            'table-header-reference',
            'responsive-table',
            cell,
            {
              referenceCount: ids.length,
              invalidReferenceCount: invalid.length,
              resolvedWithinSameTable: false,
            },
            'Point each explicit headers token to a th in this same table; inspect spanning/grouped headers in the accessibility tree.',
          );
        }
      }
      if (
        dataIntentExplicit &&
        rows.length > 1 &&
        rows.some(row => row.cells.length > 1) &&
        !headerCount
      )
        add(
          'table-header-structure',
          'responsive-table',
          table,
          {
            explicitTableRole: table.getAttribute('role') === 'table',
            captionPresent: Boolean(table.caption),
            rows: rows.length,
            headerCount,
            dataPurposeUnverified: true,
          },
          'Review this declared/captioned multi-cell table for semantic row/column headers; do not apply data-table semantics to intentional layout content.',
        );
      let clipped = false;
      let scrollContainer: HTMLElement | null = null;
      const tableRect = table.getBoundingClientRect();
      for (
        let parent = table.parentElement;
        parent && parent !== document.body && parent !== document.documentElement;
        parent = parent.parentElement
      ) {
        const s = getComputedStyle(parent);
        const r = parent.getBoundingClientRect();
        if (
          !scrollContainer &&
          ['auto', 'scroll'].includes(s.overflowX) &&
          parent.scrollWidth > parent.clientWidth + 3
        )
          scrollContainer = parent;
        if (
          !scrollContainer &&
          ['hidden', 'clip'].includes(s.overflowX) &&
          parent.scrollWidth > parent.clientWidth + 3 &&
          (tableRect.right > r.right + 3 || tableRect.left < r.left - 3)
        )
          clipped = true;
      }
      if (clipped)
        add(
          'table-clipped-content',
          'responsive-table',
          table,
          { clippedByAncestor: true, alternativeRepresentationVerified: false },
          'Keep all table content reachable at this width, through an accessible scroller, responsive representation or equivalent alternative.',
        );
      return {
        selector: selector(table),
        rows: rows.length,
        headerCount,
        sampledCells: sampledCells.length,
        renderedSampledCells: cells.length,
        cellsTruncated: ownCells.length > cellLimit,
        invalidReferences,
        ambiguousReferences,
        duplicateReferenceTokens,
        cyclicRenderedHeaders,
        headerGraphNodes: headers.length,
        headerGraphLimited,
        referenceLimitedCells,
        headerAssociationsAndSpeechVerified: false,
        spanOccupancy: inspectSpans(table, ownCells),
        clippedByAncestor: clipped,
        horizontalScrollContainer: Boolean(scrollContainer),
        scrollContainerHasName: scrollContainer ? named(scrollContainer) : null,
        scrollContainerExplicitTabStop: scrollContainer ? scrollContainer.tabIndex >= 0 : null,
        keyboardScrollVerified: false,
        viewportWidth: innerWidth,
      };
    });
    const allProgress = [
      ...document.querySelectorAll<HTMLElement>('progress,[role="progressbar"]'),
    ].filter(visible);
    const progress = allProgress.slice(0, limit).map(el => {
      const native = el instanceof HTMLProgressElement;
      const conic = getComputedStyle(el).backgroundImage.includes('conic-gradient');
      const svgCircle = Boolean(
        el.querySelector('svg circle') || (el instanceof SVGElement && el.querySelector('circle')),
      );
      const ringCandidate = conic || svgCircle;
      const guide = ringCandidate ? 'progress-ring' : 'progress';
      const number = (attribute: string, fallback: number) => {
        const value = el.getAttribute(attribute);
        if (value === null) return fallback;
        return value.trim() ? Number(value) : NaN;
      };
      const min = native ? 0 : number('aria-valuemin', 0);
      const max = native ? el.max : number('aria-valuemax', 100);
      const hasValue = native ? el.hasAttribute('value') : el.hasAttribute('aria-valuenow');
      const value = hasValue ? (native ? el.value : number('aria-valuenow', NaN)) : null;
      const validRange = Number.isFinite(min) && Number.isFinite(max) && min <= max;
      const invalidCurrent =
        value !== null && (!Number.isFinite(value) || value < min || value > max);
      if (
        !native &&
        (ringCandidate || el.getAttribute('role') === 'progressbar') &&
        (!validRange || invalidCurrent)
      )
        add(
          'progress-range-semantics',
          guide,
          el,
          {
            ringCandidate,
            validRange,
            currentValuePresent: hasValue,
            currentValueInRange: !invalidCurrent,
          },
          'Expose finite ordered progress bounds and an in-range determinate value; omit aria-valuenow while indeterminate instead of inventing a numeric value.',
        );
      if (ringCandidate && !named(el))
        add(
          'progress-ring-name',
          'progress-ring',
          el,
          { ringCandidate: true, detectableNamePresent: false },
          'Give the semantic progress element an accessible name; decorative ring graphics alone do not name the task.',
        );
      return {
        selector: selector(el),
        native,
        ringCandidate,
        ringDetection: conic ? 'conic-gradient' : svgCircle ? 'svg-circle' : 'not-identified',
        namePresent: named(el),
        determinate: hasValue,
        validRange,
        currentValueInRange: !invalidCurrent,
        nativeValueClampingApplied:
          native && hasValue ? Number(el.getAttribute('value')) !== el.value : false,
        valueTextPresent: Boolean(el.getAttribute('aria-valuetext')?.trim()),
        completionAndAnnouncementUnverified: true,
      };
    });
    return {
      schemaVersion: 1,
      coverage: {
        tables: allTables.length,
        progressIndicators: allProgress.length,
        ringCandidates: progress.filter(item => item.ringCandidate).length,
        tableLimit: limit,
        progressLimit: limit,
        cellLimit,
        headerTokenLimit,
        headerAttributeLimit,
        spanRowLimit,
        spanGroupLimit: spanRowLimit,
        spanColumnLimit,
        spanSlotLimit,
        tableSampleTruncated: allTables.length > limit,
        progressSampleTruncated: allProgress.length > limit,
        passive: true,
        scope: 'current-main-document-light-dom',
      },
      observations: { tables, progress },
      findings,
    };
  });
  return { ...snapshot, url: safeAuditUrl(page.url()) };
}
