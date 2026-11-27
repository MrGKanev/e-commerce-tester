import type { Page, TestInfo, Request, Response } from '@playwright/test';
import { expect } from './fixtures';
import { BASE } from './helpers';

/** Install before navigation; finish the initial-load sample before later probes. */
export function observeScriptInventory(page: Page) {
  const scripts = new Set<string>(),
    documentErrors: number[] = [];
  const response = (response: Response) => {
    if (
      response.request().isNavigationRequest() &&
      response.frame() === page.mainFrame() &&
      response.status() >= 400
    )
      documentErrors.push(response.status());
  };
  const request = (request: Request) => {
    const url = new URL(request.url());
    if (
      request.resourceType() === 'script' &&
      /^https?:$/.test(url.protocol) &&
      url.origin !== new URL(BASE).origin
    )
      scripts.add(url.origin + url.pathname);
  };
  page.on('response', response);
  page.on('request', request);
  return async (info: TestInfo) => {
    try {
      await page.waitForLoadState('load');
      expect(documentErrors, 'Script inventory requires a successful document response').toEqual(
        [],
      );
      expect(
        new URL(page.url()).origin,
        'Script inventory must remain on the configured store',
      ).toBe(new URL(BASE).origin);
      await info.attach('third-party-scripts.json', {
        body: JSON.stringify({
          complete: true,
          scripts: [...scripts].sort(),
          project: info.project.name,
        }),
        contentType: 'application/json',
      });
    } finally {
      page.off('response', response);
      page.off('request', request);
    }
  };
}
