// Rule sources (implementation rationale; see docs/MODERN-WEB.md for remaining gaps):
// forms: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
// autofill-sign-in-form: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/autofill-sign-in-form.md
// Observe authored field purposes and constraints without signing in or submitting.
// Autofill hints are not evidence that an OS/password manager completed a workflow.
import type { Page } from '@playwright/test';
import type { WebFinding } from './modern-web';
import { safeAuditUrl } from './modern-web';

/** Passive semantic hints. Canonical field names are only heuristics, never a business contract. */
export async function inspectFormPurposes(page: Page) {
  const snapshot = await page.evaluate(() => {
    const findings: WebFinding[] = [];
    const visible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility === 'visible'
      );
    };
    const selector = (el: Element): string => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parent = el.parentElement;
      if (!parent) return el.localName;
      const peers = [...parent.children].filter(child => child.localName === el.localName);
      return `${selector(parent)} > ${el.localName}:nth-of-type(${peers.indexOf(el) + 1})`;
    };
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
    const tokens = (el: Element) =>
      (el.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/);
    const addressPurposes = [
      'name',
      'given-name',
      'family-name',
      'street-address',
      'address-line1',
      'address-line2',
      'address-line3',
      'address-level1',
      'address-level2',
      'address-level3',
      'address-level4',
      'country',
      'country-name',
      'postal-code',
      'organization',
      'tel',
      'email',
    ];
    const addressNames: Record<string, string[]> = {
      address1: ['address-line1', 'street-address'],
      addressline1: ['address-line1', 'street-address'],
      address2: ['address-line2'],
      addressline2: ['address-line2'],
      address3: ['address-line3'],
      streetaddress: ['street-address', 'address-line1'],
      city: ['address-level2'],
      postcode: ['postal-code'],
      postalcode: ['postal-code'],
      zipcode: ['postal-code'],
      country: ['country', 'country-name'],
      state: ['address-level1'],
      province: ['address-level1'],
    };
    const controls = [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      ),
    ].filter(
      el =>
        !el.matches(':disabled') &&
        !el.closest('[inert]') &&
        !((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) &&
        visible(el) &&
        !(
          el instanceof HTMLInputElement &&
          ['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file'].includes(
            el.type,
          )
        ),
    );
    let addressControls = 0;
    const purposes: Array<Record<string, unknown>> = [];
    for (const control of controls) {
      const authored = tokens(control);
      const normalized = control.name
        .toLowerCase()
        .replace(/[\[\]_-]/g, '')
        .replace(/^(?:shipping|billing)/, '');
      const expected = addressNames[normalized];
      const address = Boolean(
        expected ||
        authored.some(token => /^(?:street-address|address-|country|postal-code)/.test(token)),
      );
      if (!address) continue;
      addressControls++;
      const purpose = authored.find(token => addressPurposes.includes(token)) || null;
      purposes.push({
        selector: selector(control),
        purpose,
        inferredFromCanonicalName: Boolean(expected),
        hasStableIdentifier: Boolean(control.id || control.name),
      });
      if (expected && !expected.some(token => authored.includes(token)))
        add(
          'address-autocomplete-purpose',
          'autofill-address-form',
          control,
          {
            expectedPurposes: expected,
            recognizedPurpose: purpose,
            inferredFromCanonicalName: true,
            businessPurposeVerified: false,
          },
          'Review the purpose inferred from this canonical address field name and provide a matching autocomplete token if it collects address data.',
        );
      if (purpose && !control.id && !control.name)
        add(
          'address-autofill-identifier',
          'autofill-address-form',
          control,
          { recognizedPurpose: purpose, stableIdentifierPresent: false },
          'Give address controls a stable name or id so browsers can associate saved address data.',
        );
    }
    const newPasswords = controls.filter(
      (control): control is HTMLInputElement =>
        control instanceof HTMLInputElement &&
        control.type === 'password' &&
        tokens(control).includes('new-password'),
    );
    for (const password of newPasswords) {
      if (!password.form || (!password.name && !password.id))
        add(
          'signup-autofill-structure',
          'autofill-sign-up-form',
          password,
          {
            newPasswordHint: true,
            formPresent: Boolean(password.form),
            stableIdentifierPresent: Boolean(password.id || password.name),
            signUpVersusResetUnverified: true,
          },
          'Keep a new-password control in a form with a stable name or id; verify the intended sign-up or password-reset workflow.',
        );
      if (!password.form) continue;
      const identifiers = controls.filter(
        control =>
          control.form === password.form &&
          control instanceof HTMLInputElement &&
          (control.type === 'email' || tokens(control).includes('username')),
      );
      for (const identifier of identifiers) {
        if (!tokens(identifier).includes('username'))
          add(
            'signup-username-autofill',
            'autofill-sign-up-form',
            identifier,
            {
              newPasswordInForm: true,
              emailIdentifierCandidate: true,
              usernameHint: false,
              accountPurposeVerified: false,
            },
            'If this email identifies the new account, mark it autocomplete="username" so password managers pair it with the new password.',
          );
        if (identifier.spellcheck)
          add(
            'signup-identifier-spellcheck',
            'autofill-sign-up-form',
            identifier,
            { newPasswordInForm: true, identifierSpellcheckEnabled: true },
            'Disable spellcheck on account identifiers so spelling corrections do not change the intended identifier.',
          );
      }
    }
    return {
      findings,
      coverage: {
        addressControls,
        newPasswordControls: newPasswords.length,
        autofillBehaviorVerified: false,
        purposes,
      },
    };
  });
  return { schemaVersion: 1, url: safeAuditUrl(page.url()), ...snapshot };
}
