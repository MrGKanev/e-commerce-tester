'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  sanitizeArtifact,
  stringifyArtifact,
  redactText,
  createLogRedactor,
  privateResultsFile,
  publishResults,
} = require('./artifact-privacy');
const hash = 'a'.repeat(64);
test('structured output redacts credential/PII keys without mutating configuration or security signatures', () => {
  const input = {
    headers: { Authorization: 'Bearer private-auth', 'Set-Cookie': 'session=private-cookie' },
    email: 'private@example.test',
    access_token: 'private-token',
    password: 'private-password',
    scripts: [
      { key: `external:https://cdn.test:${hash}:main`, sha256: hash, urlHash: hash, bytes: 58 },
    ],
    scope: { site: 'fixture', page: 'checkout', choice: 'reject' },
    artifacts: [{ path: 'files/owner@example.test.png', contentType: 'image/png' }],
    signatureHash: hash,
    count: 4,
  };
  const before = JSON.stringify(input),
    clean = sanitizeArtifact(input);
  assert.doesNotMatch(
    JSON.stringify(clean),
    /private-auth|private-cookie|private@example|private-token|private-password/,
  );
  assert.deepEqual(clean.scripts, input.scripts);
  assert.deepEqual(clean.scope, input.scope);
  assert.deepEqual(clean.artifacts, input.artifacts);
  assert.equal(clean.signatureHash, hash);
  assert.equal(clean.count, 4);
  assert.equal(JSON.stringify(input), before);
});
test('URLs omit credentials and fingerprint every query value/fragment with stable distinct labels', () => {
  const first = redactText(
    'goto https://private-user:private-password@store.test/a?token=private-token&query=private-email#private-fragment',
  );
  const second = redactText(
    'goto https://store.test/a?token=another-token&query=private-email#private-fragment',
  );
  assert.doesNotMatch(first, /private-|another-token/);
  assert.match(first, /https:\/\/store.test\/a\?token=redacted-[a-f0-9]{64}/);
  assert.notEqual(first, second);
  assert.equal(redactText(first), first);
  assert.equal(redactText('https://store.test/product'), 'https://store.test/product');
});
test('text diagnostics mask header/assignment/Bearer/JWT/email patterns and stabilize', () => {
  const value =
    'Cookie: session=private-cookie; another=private-secret\nAuthorization: Bearer private-auth\npassword="private pass" email private@example.test token=private-token\neyJabc.eyJdef.signature\n';
  const clean = redactText(value);
  assert.doesNotMatch(clean, /private|eyJabc/);
  assert.equal(redactText(clean), clean);
});
test('encoded textual attachments and buffer stdout are filtered while binary artifacts are left explicit', () => {
  const text = {
    email: 'private@example.test',
    url: 'https://store.test/?unknown=private-unknown',
    sha256: hash,
  };
  const input = {
    attachments: [
      {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(text)).toString('base64'),
      },
      { contentType: 'image/png', body: Buffer.from([0xff, 0xfe, 0]).toString('base64') },
    ],
    stdout: [{ buffer: Buffer.from('token=private-buffer\n').toString('base64') }],
  };
  const clean = sanitizeArtifact(input);
  const decoded = Buffer.from(clean.attachments[0].body, 'base64').toString();
  assert.doesNotMatch(decoded, /private/);
  assert.equal(JSON.parse(decoded).sha256, hash);
  assert.doesNotMatch(Buffer.from(clean.stdout[0].buffer, 'base64').toString(), /private-buffer/);
  assert.equal(clean.attachments[1].body, input.attachments[1].body);
});
test('log chunks retain split UTF-8 and secrets only until line boundaries and fail closed for oversized lines', () => {
  let output = '';
  const stream = createLogRedactor(chunk => {
    output += chunk;
  }, 100);
  for (const chunk of [
    'Authorization: Bear',
    'er private-auth\nmail private@',
    'example.test\nURL https://store.test/?token=private-',
    'token\n',
    'x'.repeat(101),
    'private-overlong\n',
    'password=private-final',
  ])
    stream.write(Buffer.from(chunk));
  stream.write('\n');
  const unicode = Buffer.from('Статус\n');
  stream.write(unicode.subarray(0, 1));
  stream.write(unicode.subarray(1));
  stream.write('password=private-final-again');
  stream.end();
  assert.match(output, /Статус/);
  assert.doesNotMatch(output, /private-/);
  assert.match(output, /redacted oversized log line/);
  assert.match(output, /redacted-[a-f0-9]{64}/);
});
test('privacy serialization fails closed for cycles rather than silently publishing raw data', () => {
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => stringifyArtifact(cycle), /cycles/);
});
test('raw built-in results remain in a private staging directory until atomic filtered publication', t => {
  const input = privateResultsFile();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-output-'));
  const output = path.join(root, 'results.json');
  t.after(() => {
    fs.rmSync(path.dirname(input), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(path.dirname(input)).mode & 0o777, 0o700);
  fs.writeFileSync(
    input,
    JSON.stringify({ errors: [{ message: 'token=private-published' }], sha256: hash }),
  );
  assert.equal(fs.existsSync(output), false);
  publishResults(input, output);
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /private-published/);
  assert.equal(JSON.parse(fs.readFileSync(output)).sha256, hash);
  assert.throws(() => publishResults(input, input), /privately|staged/);
  fs.writeFileSync(input, '{broken');
  fs.rmSync(output);
  assert.throws(() => publishResults(input, output));
  assert.equal(fs.existsSync(output), false);
});

test('already safe origin strings, frame keys and full security signatures remain byte-for-byte stable', () => {
  const scope = {
    site: 'fixture',
    project: 'Mobile Chrome',
    page: 'checkout',
    role: 'checkout',
    choice: 'reject',
    stage: 'reject',
    profile: 'bg',
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
  };
  const security = {
    schemaVersion: 1,
    scope,
    scripts: [
      {
        key: `external:https://cdn.test:${hash}:frame:${hash}`,
        sha256: hash,
        urlHash: hash,
        origin: 'https://cdn.test',
        context: `frame:${hash}`,
        bytes: 12,
      },
    ],
    payment: {
      documents: ['https://store.test'],
      forms: ['https://store.test'],
      formActions: [`https://store.test:${hash}`],
      frames: ['https://pay.test'],
      cardFields: 0,
      overlayCardFields: 0,
    },
    destinations: [
      {
        origin: 'wss://socket.test',
        key: 'websocket:CONNECT:wss://socket.test:page-websocket',
        urlHash: hash,
      },
    ],
    coverage: { complete: true },
  };
  assert.equal(JSON.stringify(sanitizeArtifact(security)), JSON.stringify(security));
  for (const origin of [
    'https://store.test',
    'https://store.test/',
    'http://localhost:8000',
    'wss://socket.test',
  ])
    assert.equal(redactText(origin), origin);
});
test('quoted JSON-like log assignments and malformed text attachment fallback mask secrets', () => {
  for (const value of [
    '{"token":"sentinel-secret","password":"sentinel-pass"}',
    "{'access_token':'sentinel-secret', 'email':'sentinel-mail'}",
    '{"token":"sentinel-secret",',
  ]) {
    assert.doesNotMatch(redactText(value), /sentinel-/);
    const clean = sanitizeArtifact({
      contentType: 'text/plain',
      body: Buffer.from(value).toString('base64'),
    });
    assert.doesNotMatch(Buffer.from(clean.body, 'base64').toString(), /sentinel-/);
  }
});
test('structural limits inside encoded JSON fail closed rather than reverting to free-form raw text', () => {
  let value = { token: 'sentinel-deep' };
  for (let index = 0; index < 105; index++) value = { child: value };
  assert.throws(
    () =>
      sanitizeArtifact({
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(value)).toString('base64'),
      }),
    /limits/,
  );
});
test('configuration imports and worker inheritance reuse one private staging directory per output', t => {
  const output = path.join(os.tmpdir(), 'privacy-stage-fixture-' + process.pid + '.json');
  const first = privateResultsFile(output),
    second = privateResultsFile(output);
  t.after(() => fs.rmSync(path.dirname(first), { recursive: true, force: true }));
  assert.equal(first, second);
});
