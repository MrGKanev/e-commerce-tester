import { test, expect } from '@playwright/test';
import { canContinueWidgetProbe } from '../tests/modern-web-probe-continuation';

test('continuation classifier distinguishes lost ownership from untouched exclusions and restored advisories', () => {
  expect(canContinueWidgetProbe({ observations: [] })).toBe(true);
  expect(canContinueWidgetProbe({ continuationSafe: false, observations: [] })).toBe(false);
  expect(canContinueWidgetProbe({ networkDependent: true, observations: [] })).toBe(false);
  expect(canContinueWidgetProbe({ observations: [{ status: 'not-probed', keysSent: 0 }] })).toBe(
    true,
  );
  expect(canContinueWidgetProbe({ observations: [{ status: 'not-probed', keysSent: 1 }] })).toBe(
    false,
  );
  expect(canContinueWidgetProbe({ observations: [{ status: 'unverified' }] })).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restored: false, restoration: { status: 'restored' } }],
    }),
  ).toBe(true);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restoration: { status: 'not-restored' } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', cleanup: { status: 'unverified' } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', restoration: { closed: false } }],
    }),
  ).toBe(false);
  expect(
    canContinueWidgetProbe({
      observations: [
        { status: 'observed', optional: { status: 'unverified' }, restoration: { closed: true } },
      ],
    }),
  ).toBe(true);
  expect(
    canContinueWidgetProbe({
      observations: [{ status: 'observed', scrollRestoration: { status: 'restored' } }],
      focusRestoration: { status: 'not-restored' },
    }),
  ).toBe(false);
});

