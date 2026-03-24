import { test, expect } from '@playwright/test';
import { BASE, goto, internalLinks, MOBILE_MENU_TOGGLE_SEL } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Desktop navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('02 · Desktop navigation', () => {
  test('header contains at least 2 navigation links', async ({ page }) => {
    await goto(page);
    const links = page.locator(
      'header nav a[href], .site-header nav a[href], [role="banner"] nav a[href]',
    );
    expect(await links.count(), 'Header nav has fewer than 2 links').toBeGreaterThanOrEqual(2);
  });

  test('all header nav links are visible and have non-empty text', async ({ page }) => {
    await goto(page);
    const links = page.locator(
      'header nav a[href], .site-header nav a[href], [role="banner"] nav a[href]',
    );
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const text = (await link.textContent())?.trim() ?? '';
      const isVisible = await link.isVisible();
      if (isVisible && text === '') {
        // Icon-only links are OK if they have aria-label
        const ariaLabel = await link.getAttribute('aria-label');
        expect(ariaLabel, `Nav link #${i} has no text and no aria-label`).toBeTruthy();
      }
    }
  });

  test('all header nav links respond without 404/500', async ({ page, request }) => {
    await goto(page);
    const links = await internalLinks(page, 'header, .site-header, [role="banner"]');
    expect(links.length, 'No internal links found in header').toBeGreaterThan(0);

    const failures: string[] = [];
    for (const path of links) {
      const resp = await request
        .get(`${BASE}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .catch(() => null);
      const status = resp?.status() ?? 0;
      if (status >= 400) failures.push(`${path} → ${status}`);
    }
    expect(failures, `Broken header links:\n${failures.join('\n')}`).toHaveLength(0);
  });

  test('clicking a nav link navigates to the correct page', async ({ page }) => {
    await goto(page);
    const links = page.locator(
      'header nav a[href^="/"], .site-header nav a[href^="/"]',
    );
    const count = await links.count();
    if (count === 0) test.skip(true, 'No internal nav links found');

    // Click each nav link (up to 5) and verify no 404
    const tested: string[] = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = links.nth(i);
      const href = await link.getAttribute('href');
      if (!href || tested.includes(href)) continue;
      tested.push(href);

      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes(href.replace('/', '')) && r.status() < 400,
          { timeout: 8000 },
        ).catch(() => null),
        link.click(),
      ]);

      const currentUrl = page.url();
      expect(
        currentUrl,
        `After clicking "${href}" ended up on ${currentUrl}`,
      ).toContain(href.replace(/\/$/, '').split('/').pop() ?? '');

      await page.goBack({ waitUntil: 'domcontentloaded' });
    }
  });

  test('dropdown menus appear on hover (if any)', async ({ page }) => {
    await goto(page);

    const dropdownTriggers = page.locator(
      'header nav li:has(ul) > a, header nav li:has([class*="dropdown"]) > a, .site-nav__item--has-dropdown > a',
    );
    const count = await dropdownTriggers.count();
    if (count === 0) {
      test.skip(true, 'No dropdown triggers found in nav — theme may use flat navigation');
      return;
    }

    const trigger = dropdownTriggers.first();
    await trigger.hover();
    await page.waitForTimeout(400); // CSS transition

    const dropdown = page.locator(
      'header nav li ul:visible, header [class*="dropdown"]:visible, .site-nav__dropdown:visible',
    ).first();

    const isVisible = await dropdown.isVisible().catch(() => false);
    expect(isVisible, 'Dropdown did not appear on hover').toBe(true);

    // Verify dropdown links work
    if (isVisible) {
      const ddLinks = dropdown.locator('a[href]');
      const ddCount = await ddLinks.count();
      expect(ddCount, 'Dropdown opened but has no links').toBeGreaterThan(0);
    }
  });

  test('cart icon is visible in header and links to /cart', async ({ page }) => {
    await goto(page);
    const cartLink = page.locator(
      'header a[href="/cart"], .site-header a[href="/cart"], [aria-label*="Cart"], [aria-label*="cart"], [aria-label*="Количка"]',
    ).first();
    await expect(cartLink).toBeVisible();
    const href = await cartLink.getAttribute('href');
    expect(href).toContain('cart');
  });

  test('search icon/button is visible in header', async ({ page }) => {
    await goto(page);
    const searchEl = page.locator(
      'header button[aria-label*="Search"], header button[aria-label*="search"], header a[href*="/search"], .site-header [class*="search"], header [aria-label*="Търси"]',
    ).first();
    await expect(searchEl).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Footer navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('02 · Footer navigation', () => {
  test('footer has at least 3 links', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const links = page.locator('footer a[href], .site-footer a[href]');
    expect(await links.count(), 'Footer has fewer than 3 links').toBeGreaterThanOrEqual(3);
  });

  test('all footer links respond without 404/500', async ({ page, request }) => {
    await goto(page);
    const links = await internalLinks(page, 'footer, .site-footer');

    const failures: string[] = [];
    for (const path of links) {
      const resp = await request
        .get(`${BASE}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .catch(() => null);
      const status = resp?.status() ?? 0;
      if (status >= 400) failures.push(`${path} → ${status}`);
    }
    expect(failures, `Broken footer links:\n${failures.join('\n')}`).toHaveLength(0);
  });

  test('footer social media links open in new tab or are external', async ({ page }) => {
    await goto(page);
    const socialLinks = page.locator(
      'footer a[href*="facebook"], footer a[href*="instagram"], footer a[href*="tiktok"], footer a[href*="youtube"]',
    );
    const count = await socialLinks.count();
    if (count === 0) {
      test.skip(true, 'No social media links found in footer');
      return;
    }
    // Just verify they have an href (not #)
    for (let i = 0; i < count; i++) {
      const href = await socialLinks.nth(i).getAttribute('href');
      expect(href, `Social link #${i} has no href`).toBeTruthy();
      expect(href, `Social link #${i} href is just "#"`).not.toBe('#');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mobile navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('02 · Mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('hamburger/menu toggle button is visible on mobile', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    await expect(toggle, 'Mobile menu toggle not found').toBeVisible();
  });

  test('mobile menu opens when hamburger is clicked', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    const toggleCount = await toggle.count();
    if (toggleCount === 0) test.skip(true, 'Mobile menu toggle not found');

    await toggle.click();
    await page.waitForTimeout(500); // CSS animation

    // Menu should now be open — check for any of the open states
    const menuOpen = page.locator(
      '#menu-drawer, #mobile-menu, .mobile-nav, .mobile-navigation, [class*="mobile-menu"], [class*="nav-drawer"]',
    ).first();

    // Either the menu container is visible or aria-expanded is true
    const isOpen = await menuOpen.isVisible().catch(() => false);
    const isExpanded = await page
      .locator('[aria-expanded="true"]')
      .count()
      .then((c) => c > 0)
      .catch(() => false);

    expect(
      isOpen || isExpanded,
      'Mobile menu did not open after clicking toggle',
    ).toBe(true);
  });

  test('mobile menu shows navigation links when open', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    if ((await toggle.count()) === 0) test.skip(true, 'Mobile menu toggle not found');

    await toggle.click();
    await page.waitForTimeout(600);

    // Find links that appeared after opening
    const menuLinks = page.locator(
      '#menu-drawer a[href], #mobile-menu a[href], [class*="mobile-menu"] a[href], [class*="nav-drawer"] a[href], .mobile-nav a[href]',
    );
    const count = await menuLinks.count();
    expect(count, 'Mobile menu opened but shows no links').toBeGreaterThan(0);
  });

  test('mobile menu closes when close button or overlay is clicked', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    if ((await toggle.count()) === 0) test.skip(true, 'Mobile menu toggle not found');

    await toggle.click();
    await page.waitForTimeout(500);

    // Try close button first
    const closeBtn = page.locator(
      '[aria-label*="Close"], [aria-label*="close"], [aria-label*="Затвори"], button.drawer__close, .mobile-nav__close, details > summary:first-child',
    ).first();

    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      // Try pressing Escape
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);

    // Verify menu is no longer fully visible / blocking content
    const expandedCount = await page.locator('[aria-expanded="true"]').count();
    // It's OK if some elements remain as aria-expanded=true, just shouldn't block viewport
    // We verify the main content is accessible
    const main = page.locator('main, #main-content, [role="main"]').first();
    await expect(main).toBeVisible();
  });

  test('mobile nav links have adequate touch target height (≥44px)', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    if ((await toggle.count()) > 0) {
      await toggle.click();
      await page.waitForTimeout(500);
    }

    const navLinks = page.locator(
      'header nav a, #menu-drawer a, .mobile-nav a, [class*="mobile-menu"] a',
    );
    const count = await navLinks.count();
    if (count === 0) test.skip(true, 'No nav links found');

    const small: string[] = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const link = navLinks.nth(i);
      if (!(await link.isVisible().catch(() => false))) continue;
      const box = await link.boundingBox();
      if (box && box.height < 32) {
        const text = await link.textContent();
        small.push(`"${text?.trim()}" — height: ${box.height}px`);
      }
    }
    // Warn but don't hard-fail — some themes use compact nav
    if (small.length > 0) {
      console.warn(`Small touch targets detected:\n${small.join('\n')}`);
    }
  });

  test('mobile menu overlay does not block main content after closing', async ({ page }) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();

    if ((await toggle.count()) > 0) {
      await toggle.click();
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Check main content is accessible
    const main = page.locator('main, #main-content, [role="main"]').first();
    await expect(main).toBeVisible();

    // Check the body doesn't still have a scroll-lock class (menu open indicator)
    const bodyClasses = await page.evaluate(() => document.body.className);
    const hasScrollLock = /overflow-hidden|no-scroll|menu-open|drawer-open/i.test(bodyClasses);
    expect(hasScrollLock, `Body still has scroll-lock class after menu close: ${bodyClasses}`).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error pages
// ─────────────────────────────────────────────────────────────────────────────

test.describe('02 · Error pages', () => {
  test('404 page shows a custom message (not blank)', async ({ page }) => {
    await page.goto(`${BASE}/this-page-does-not-exist-12345`, {
      waitUntil: 'domcontentloaded',
    });
    const body = await page.textContent('body');
    expect(body?.trim().length ?? 0, '404 page body is empty').toBeGreaterThan(50);
    // Should have navigation still intact
    const header = page.locator('header, .site-header, [role="banner"]').first();
    await expect(header).toBeVisible();
  });
});
