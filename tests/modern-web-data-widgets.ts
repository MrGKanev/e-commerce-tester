import type { Page } from '@playwright/test';
import { safeAuditUrl, type WebFinding } from './modern-web';

/** Passive bounded table/progress samples; no focus, scrolling, state changes or resource requests. */
export async function inspectDataWidgets(page: Page) {
  const snapshot = await page.evaluate(() => {
    const limit = 20;
    const cellLimit = 200;
    const findings: WebFinding[] = [];
    const selector = (el: Element): string => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parent = el.parentElement;
      if (!parent) return el.localName;
      const peers = [...parent.children].filter(peer => peer.localName === el.localName);
      return `${selector(parent)} > ${el.localName}:nth-of-type(${peers.indexOf(el) + 1})`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
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
    ) =>
      findings.push({
        rule,
        guide,
        severity: 'warning',
        selector: selector(el),
        evidence,
        recommendation,
      });
    const allTables = [...document.querySelectorAll<HTMLTableElement>('table')].filter(
      el => visible(el) && !el.matches('[role="presentation"],[role="none"]'),
    );
    const tables = allTables.slice(0, limit).map(table => {
      const ownCells = [...table.querySelectorAll<HTMLTableCellElement>('th,td')].filter(
        cell => cell.closest('table') === table,
      );
      const cells = ownCells.slice(0, cellLimit);
      const headerCount = ownCells.filter(cell => cell.localName === 'th').length;
      const rows = [...table.rows].filter(row => row.closest('table') === table);
      const dataIntentExplicit = table.getAttribute('role') === 'table' || Boolean(table.caption);
      let invalidReferences = 0;
      for (const cell of cells) {
        const ids = (cell.getAttribute('headers') || '').split(/\s+/).filter(Boolean);
        if (!ids.length) continue;
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
        sampledCells: cells.length,
        cellsTruncated: ownCells.length > cellLimit,
        invalidReferences,
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
