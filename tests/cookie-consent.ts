import { expect, errors, type Page } from '@playwright/test';
import type { SiteSettings } from '../config/site-settings';
import { controlEvent } from '../config/control-events';

// Match accept actions, never arbitrary buttons inside a consent container.
export const DEFAULT_CONSENT_SELECTOR = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#didomi-notice-agree-button',
  '#accept-cookies',
  '#cookie-accept',
  '.cc-btn.cc-allow',
  'button[id*="accept"][id*="cookie"]',
  'button[id*="cookie"][id*="accept"]',
  'button[class*="cookie"][class*="accept"]',
  'button[class*="accept"][class*="cookie"]',
  'button:text-is("Accept all")',
  'button:text-is("Accept All")',
  'button:text-is("Accept all cookies")',
  'button:text-is("Allow all")',
  'button:text-is("Allow all cookies")',
  'button:text-is("Приемам всички")',
  'button:text-is("Приемам всички бисквитки")',
  'button:text-is("Разрешаване на всички")',
  'button:text-is("Съгласен съм")',
  'button:text-is("Приемам")',
  'button:text-is("Приемане")',
  '[data-cookiebanner] button:text-is("Accept")',
  '[data-cookie-consent] button:text-is("Accept")',
  '.cookie-banner button:text-is("Accept")',
  '.cookie-consent button:text-is("Accept")',
].join(', ');
export function consentSelector(settings: SiteSettings) {
  return settings.selectors.consentAccept || DEFAULT_CONSENT_SELECTOR;
}
export function consentButton(page: Page, settings: SiteSettings) {
  const scope = settings.cookieConsent.frameSelector
    ? page.frameLocator(settings.cookieConsent.frameSelector)
    : page;
  return scope.locator(consentSelector(settings)).filter({ visible: true }).first();
}
export async function acceptCookieConsent(
  page: Page,
  settings: SiteSettings,
  appearanceTimeout = 0,
): Promise<'accepted' | 'absent' | 'disabled'> {
  if (settings.cookieConsent.mode === 'none') return 'disabled';
  const button = consentButton(page, settings);
  if (appearanceTimeout > 0) {
    try {
      await button.waitFor({ state: 'visible', timeout: appearanceTimeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError) || page.isClosed()) throw error;
      controlEvent({
        type: 'consent',
        title: 'Cookie consent: no accept button detected',
        url: page.url(),
      });
      return 'absent';
    }
  } else if (!(await button.isVisible())) return 'absent';
  await button.click();
  await expect(button, 'Consent action did not dismiss the banner').toBeHidden();
  controlEvent({
    type: 'consent',
    title: 'Cookie consent: accept action completed',
    url: page.url(),
  });
  return 'accepted';
}
