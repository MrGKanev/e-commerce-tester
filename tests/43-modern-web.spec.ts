import { inspectTooltips } from './modern-web-tooltips';
import { inspectDialogScroll } from './modern-web-dialog-scroll';
import { inspectWidgets } from './modern-web-widgets';
import { test, expect } from './fixtures';
import { configuredPages } from './inventory';
import { waitForContent } from './helpers';
import { inspectModernWeb, attachModernWeb } from './modern-web';
import { prepareInteractionProbe, inspectInteractions } from './modern-web-interactions';
import { inspectPresentation } from './modern-web-presentation';

for (const entry of configuredPages())
  test(
    `modern web — ${entry.type}: ${new URL(entry.url).pathname}${new URL(entry.url).search}`,
    { tag: ['@full', '@modern-web'] },
    async ({ page }, testInfo) => {
      const isolation = await prepareInteractionProbe(page);
      const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'Modern Web page must load').toBeLessThan(400);
      await waitForContent(page);
      const report = await inspectModernWeb(page, await response?.allHeaders());
      await attachModernWeb(report, testInfo);
      await isolation.freeze();
      const dialogScroll = await inspectDialogScroll(page);
      Object.assign(dialogScroll.coverage, isolation.counts(), {
        networkDependentStatesUnverified:
          isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
      });
      await attachModernWeb(dialogScroll, testInfo, 'modern-web-dialog-scroll');
      const interactions = await inspectInteractions(page);
      Object.assign(interactions.coverage, isolation.counts(), {
        networkDependentStatesUnverified:
          isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
      });
      await attachModernWeb(interactions, testInfo, 'modern-web-interactions');
      const widgets = await inspectWidgets(page);
      Object.assign(widgets.coverage, isolation.counts(), {
        networkDependentStatesUnverified:
          isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
      });
      await attachModernWeb(widgets, testInfo, 'modern-web-widgets');
      const tooltips = await inspectTooltips(page);
      Object.assign(tooltips.coverage, isolation.counts(), {
        networkDependentStatesUnverified:
          isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
      });
      await attachModernWeb(tooltips, testInfo, 'modern-web-tooltips');
      const presentation = await inspectPresentation(page);
      Object.assign(presentation.coverage, isolation.counts(), {
        networkDependentStatesUnverified:
          isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
      });
      await attachModernWeb(presentation, testInfo, 'modern-web-presentation');
      expect(
        report.findings.filter(finding => finding.severity === 'error'),
        'Broken form description references; see modern-web.txt for evidence and fixes',
      ).toEqual([]);
    },
  );
