import { test, expect } from './fixtures';
import { goto, MOBILE_MENU_TOGGLE_SEL, optionalVisible } from './helpers';

test(
  'homepage navigation is reachable with the keyboard',
  { tag: ['@full', '@smoke'] },
  async ({ page }) => {
    await goto(page);
    const target = page
      .locator('header a[href], [role="banner"] a[href]')
      .filter({ visible: true })
      .first();
    await expect(target).toBeVisible();
    let reached = false;
    for (let index = 0; index < 40; index++) {
      await page.keyboard.press('Tab');
      if (await target.evaluate(element => document.activeElement === element)) {
        reached = true;
        break;
      }
    }
    expect(reached, 'Header navigation was not reached in 40 Tab steps').toBe(true);
    await expect(target).toBeFocused();
  },
);

test(
  'mobile menu can be dismissed with Escape and returns focus to its toggle',
  { tag: '@full' },
  async ({ page }, testInfo) => {
    await goto(page);
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).filter({ visible: true }).first();
    if (!(await optionalVisible(toggle))) {
      testInfo.annotations.push({
        type: 'not-applicable',
        description: 'No mobile menu toggle at this viewport',
      });
      test.skip(true, 'No mobile menu toggle at this viewport');
    }
    if (testInfo.project.use.hasTouch) await toggle.tap();
    else await toggle.click();
    const drawer = page
      .locator('#menu-drawer, #mobile-menu, .mobile-nav, [class*="nav-drawer"]')
      .first();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(toggle).toBeFocused();
  },
);
