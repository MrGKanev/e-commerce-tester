import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { BASE, goto } from './helpers';
test(
  'third-party script inventory',
  { tag: ['@full', '@smoke', '@audit'] },
  async ({ page }, info) => {
    if (!readSiteSettings().monitorScripts)
      info.annotations.push({
        type: 'not-applicable',
        description: 'Third-party monitoring disabled',
      });
    test.skip(!readSiteSettings().monitorScripts, 'Third-party monitoring is disabled');
    const scripts = new Set<string>();
    const documentErrors: number[] = [];
    page.on('response', response => {
      if (
        response.request().isNavigationRequest() &&
        response.frame() === page.mainFrame() &&
        response.status() >= 400
      )
        documentErrors.push(response.status());
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (
        request.resourceType() === 'script' &&
        /^https?:$/.test(url.protocol) &&
        url.origin !== new URL(BASE).origin
      )
        scripts.add(url.origin + url.pathname);
    });
    await goto(page);
    await page.waitForLoadState('load');
    expect(documentErrors, 'Script inventory requires a successful document response').toEqual([]);
    expect(new URL(page.url()).origin, 'Script inventory must remain on the configured store').toBe(
      new URL(BASE).origin,
    );
    await info.attach('third-party-scripts.json', {
      body: JSON.stringify({
        complete: true,
        scripts: [...scripts].sort(),
        project: info.project.name,
      }),
      contentType: 'application/json',
    });
  },
);
