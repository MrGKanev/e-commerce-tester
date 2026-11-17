import { test, expect } from '../tests/fixtures';
import { inspectComponents } from '../tests/modern-web-components';

const url = 'http://127.0.0.1:45996/components';
async function fixture(page: import('@playwright/test').Page, body = '') {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Component fixture</title></head><body><main><h1>Component fixture</h1>${body}</main></body></html>`,
    }),
  );
  await page.goto(url);
}

test('open-shadow ARIA relationships resolve in their own tree and evidence omits labels and ids', async ({
  page,
}) => {
  await fixture(page, '<p id="private-outside">private-label</p><x-control></x-control>');
  await page.evaluate(() => {
    const root = document.querySelector('x-control')!.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<button aria-labelledby="private-outside">Action</button><input aria-describedby="private-outside" aria-label="private-input">';
  });
  const report = await inspectComponents(page);
  expect(report.coverage).toMatchObject({
    openShadowRoots: 1,
    relationships: 2,
    nativeShadowControls: 2,
  });
  expect(report.findings.filter(f => f.rule === 'shadow-aria-reference')).toHaveLength(2);
  expect(JSON.stringify(report)).not.toMatch(/private-outside|private-label|private-input/);
  expect(report.findings.every(f => f.severity === 'warning')).toBe(true);
});

test('same-tree labels, slotted button names and outward element reflection avoid false warnings', async ({
  page,
}) => {
  await fixture(
    page,
    '<p id="outside">External name</p><x-control><span>Projected button name</span></x-control>',
  );
  await page.evaluate(() => {
    const root = document.querySelector('x-control')!.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<label for="inner">Input</label><input id="inner"><button><slot></slot></button><button id="reflected"></button>';
    const target = root.getElementById('reflected')!;
    if (Reflect.has(target, 'ariaLabelledByElements'))
      target.ariaLabelledByElements = [document.getElementById('outside')!];
    else target.setAttribute('aria-label', 'Fallback external name');
  });
  const report = await inspectComponents(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.nativeShadowControls).toBe(3);
});

test('nested open roots are inspected while closed roots and private internals remain unobservable', async ({
  page,
}) => {
  await fixture(
    page,
    '<x-outer></x-outer><x-closed></x-closed><x-internals aria-label="Host control"></x-internals>',
  );
  await page.evaluate(() => {
    const outer = document.querySelector('x-outer')!.attachShadow({ mode: 'open' });
    outer.innerHTML = '<x-inner></x-inner>';
    outer.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML = '<button></button>';
    document.querySelector('x-closed')!.attachShadow({ mode: 'closed' }).innerHTML =
      '<button></button>';
    if ('attachInternals' in HTMLElement.prototype) {
      customElements.define(
        'x-internals',
        class extends HTMLElement {
          constructor() {
            super();
            const internals = this.attachInternals();
            internals.role = 'switch';
            internals.ariaChecked = 'false';
          }
        },
      );
    }
  });
  const report = await inspectComponents(page);
  expect(report.coverage).toMatchObject({
    openShadowRoots: 2,
    closedRootsUnobservable: true,
    internalsStateRead: false,
  });
  expect(report.findings.map(f => f.rule)).toEqual(['shadow-native-control-name']);
});

test('form-collection membership exposes disabled internal focus leaks without submission or value reads', async ({
  page,
}) => {
  await fixture(
    page,
    '<form><fieldset disabled><x-bad name="private-field"></x-bad><x-good name="private-good"></x-good></fieldset></form>',
  );
  await page.evaluate(() => {
    if (
      !('attachInternals' in HTMLElement.prototype) ||
      !('setFormValue' in ElementInternals.prototype)
    )
      return;
    for (const [name, safe] of [
      ['x-bad', false],
      ['x-good', true],
    ] as const) {
      customElements.define(
        name,
        class extends HTMLElement {
          static formAssociated = true;
          constructor() {
            super();
            this.attachInternals().setFormValue('private-value');
            this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML =
              '<button type="button">Option</button>';
          }
          formDisabledCallback(disabled: boolean) {
            if (safe) this.shadowRoot!.querySelector('button')!.disabled = disabled;
          }
        },
      );
    }
  });
  const report = await inspectComponents(page);
  if (report.coverage.formAssociatedApiPresent) {
    expect(report.coverage.formParticipants).toBe(2);
    expect(report.findings.map(f => f.rule)).toEqual(['component-disabled-focus']);
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disabled: true,
          enabledInternalTabStops: 1,
          valueAndValidityUnverified: true,
        }),
        expect.objectContaining({ disabled: true, enabledInternalTabStops: 0 }),
      ]),
    );
  } else expect(report.coverage.formParticipants).toBe(0);
  expect(JSON.stringify(report)).not.toMatch(/private-field|private-good|private-value/);
});

test('host ID references cannot point inward into their own shadow tree', async ({ page }) => {
  await fixture(page, '<x-control aria-labelledby="internal-label"></x-control>');
  await page.evaluate(() => {
    document.querySelector('x-control')!.attachShadow({ mode: 'open' }).innerHTML =
      '<span id="internal-label">Name</span><button aria-label="Action">Action</button>';
  });
  const report = await inspectComponents(page);
  expect(report.findings.map(f => f.rule)).toEqual(['shadow-aria-reference']);
  expect(report.findings[0].evidence).toMatchObject({
    attribute: 'aria-labelledby',
    missingInOwnTree: 1,
  });
});

test('bounded traversal and absent features retain explicit unsupported and truncated scope', async ({
  page,
}) => {
  await fixture(page);
  const empty = await inspectComponents(page);
  expect(empty.findings).toEqual([]);
  expect(empty.coverage).toMatchObject({
    openShadowRoots: 0,
    formParticipants: 0,
    scanTruncated: false,
  });
  await page.evaluate(() => {
    for (let index = 0; index < 55; index++) {
      const host = document.createElement('x-node');
      host.attachShadow({ mode: 'open' }).innerHTML = '<button aria-label="Action">Action</button>';
      document.body.append(host);
    }
  });
  const limited = await inspectComponents(page);
  expect(limited.coverage).toMatchObject({
    openShadowRoots: 50,
    rootLimit: 50,
    scanTruncated: true,
  });
  expect(limited.findings).toEqual([]);
  await page.evaluate(() => {
    delete (Element.prototype as Partial<Element>).attachShadow;
  });
  expect((await inspectComponents(page)).coverage.shadowDomSupported).toBe(false);
});

test('deep naming and large documents remain bounded without inventing missing-name findings', async ({
  page,
}) => {
  await fixture(page, '<x-control></x-control>');
  await page.evaluate(() => {
    const root = document.querySelector('x-control')!.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    root.append(button);
    let current: HTMLElement = button;
    for (let index = 0; index < 60; index++) {
      const child = document.createElement('span');
      current.append(child);
      current = child;
    }
    current.textContent = 'Deep name';
  });
  const names = await inspectComponents(page);
  expect(names.coverage.nameInspectionTruncated).toBe(true);
  expect(names.findings).toEqual([]);
  await page.evaluate(() => {
    for (let index = 0; index < 2100; index++) document.body.append(document.createElement('div'));
  });
  const large = await inspectComponents(page);
  expect(large.coverage).toMatchObject({
    visitedElements: 2000,
    elementLimit: 2000,
    scanTruncated: true,
  });
});

test('image input and descendant SVG accessible names avoid shadow naming false positives', async ({
  page,
}) => {
  await fixture(page, '<x-search></x-search>');
  await page.evaluate(() => {
    document.querySelector('x-search')!.attachShadow({ mode: 'open' }).innerHTML =
      '<input type="image" alt="Search" width="32" height="32"><button><svg role="img" aria-label="Search" width="32" height="32"></svg></button>';
  });
  await expect(page.getByRole('button', { name: 'Search' })).toHaveCount(2);
  const report = await inspectComponents(page);
  expect(report.findings.filter(finding => finding.rule === 'shadow-native-control-name')).toEqual(
    [],
  );
});
