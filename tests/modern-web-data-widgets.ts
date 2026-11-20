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
      spanSlotLimit = 4096;
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
    // Restrict to fully rendered native groups within declared rows: implicit
    // rows, non-native/hidden layouts or limits are unknown, not store failures.
    // This is structural occupancy, not CSS box overlap or header/AT association.
    const inspectSpans = (table: HTMLTableElement, ownCells: HTMLTableCellElement[]) => {
      const unknown = (reason: string) => ({
        status: 'unverified',
        reason,
        overlapPlacements: null,
        slotAssignments: null,
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
      let slotAssignments = 0,
        checkedRows = 0;
      for (const [groupIndex, group] of groups.entries()) {
        if (
          !['table-row-group', 'table-header-group', 'table-footer-group'].includes(
            getComputedStyle(group).display,
          )
        )
          return unknown('non-native-or-hidden-group');
        const rows = [...group.rows];
        const grid = rows.map(() => new Map<number, HTMLTableCellElement>());
        for (const [rowIndex, row] of rows.entries()) {
          if (
            row.parentElement !== group ||
            getComputedStyle(row).display !== 'table-row' ||
            getComputedStyle(row).visibility !== 'visible'
          )
            return unknown('non-native-or-hidden-row');
          checkedRows++;
          let column = 0;
          for (const cell of [...row.cells]) {
            if (
              cell.closest('table') !== table ||
              !visible(cell) ||
              getComputedStyle(cell).display !== 'table-cell'
            )
              return unknown('non-native-or-hidden-cell');
            groupedCells.push(cell);
            const width = cell.colSpan;
            const height = cell.rowSpan === 0 ? rows.length - rowIndex : cell.rowSpan;
            if (height > rows.length - rowIndex) return unknown('implicit-rows-unverified');
            while (grid[rowIndex].has(column)) column++;
            if (column + width > spanColumnLimit) return unknown('column-limit');
            if (slotAssignments + width * height > spanSlotLimit) return unknown('slot-limit');
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
            column += width;
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
      return {
        status: 'observed',
        overlapPlacements: pending.length,
        slotAssignments,
        checkedRows,
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
