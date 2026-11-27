import { inspectCarousels } from './modern-web-carousel';
import { inspectTooltips } from './modern-web-tooltips';
import { inspectDialogScroll } from './modern-web-dialog-scroll';
import { inspectWidgets } from './modern-web-widgets';
import type { Page, TestInfo } from '@playwright/test';
import { test } from './fixtures';
import { attachModernWeb } from './modern-web';
import { prepareInteractionProbe, inspectInteractions } from './modern-web-interactions';
import { inspectPresentation } from './modern-web-presentation';

export async function auditModernWebProbes(
  page: Page,
  testInfo: TestInfo,
  isolation: Awaited<ReturnType<typeof prepareInteractionProbe>>,
) {
  if (!(await isolation.freeze())) {
    testInfo.annotations.push({
      type: 'unverified',
      description: 'Active probes skipped: a live WebSocket was observed during page load',
    });
    await testInfo.attach('modern-web-probes-skipped.json', {
      body: JSON.stringify({
        status: 'unverified',
        reason: 'live-page-load-websocket',
        applicationResetVerified: false,
      }),
      contentType: 'application/json',
    });

    await test.step.skip(
      'Active probes — live page-load WebSocket cannot be quarantined',
      async () => {},
    );

    return;
  }
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
  const carousels = await inspectCarousels(page);
  Object.assign(carousels.coverage, isolation.counts(), {
    networkDependentStatesUnverified:
      isolation.counts().blockedRequests > 0 || isolation.counts().blockedSockets > 0,
  });
  await attachModernWeb(carousels, testInfo, 'modern-web-carousel');
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
}
