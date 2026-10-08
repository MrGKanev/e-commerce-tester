'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { createServer } = require('node:http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-p2-'));
(async () => {
try {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t10\t60\t20\t95\theloowww\n';
  fs.writeFileSync(path.join(bin, 'tesseract'), '#!/usr/bin/env node\nif(process.argv.includes("--list-langs")) process.stdout.write("eng\\nbul\\n"); else if(process.argv.includes("--version")) process.stdout.write("tesseract fake-test\\n"); else process.stdout.write(' + JSON.stringify(tsv) + ');\n', { mode: 0o755 });
  let acceptedFindings = [];
  for (const mode of ['report', 'strict', 'accepted']) {
    const dir = path.join(root, mode);
    fs.mkdirSync(dir);
    const settings = { locale: 'en-US', capabilities: { newsletter: false }, inventory: { discoverProducts: true, pages: [{ path: '/about', type: 'static', language: 'en' }] }, spelling: { mode: mode === 'accepted' ? 'strict' : mode, ocr: { enabled: true }, allowWords: ['Zerno'], acceptedFindings: mode === 'accepted' ? acceptedFindings : [] } };
    const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config=checks/p2.config.ts'], {
      stdio: 'inherit', env: { ...process.env, STORE_URL: 'http://127.0.0.1:45983', SITE_SLUG: 'p2-local', SITE_SETTINGS_JSON: JSON.stringify(settings),
        PATH: bin + path.delimiter + process.env.PATH, P2_STRICT: mode !== 'report' ? '1' : '', P2_ACCEPTED: mode === 'accepted' ? '1' : '', P2_METADATA_FILE: path.join(dir, 'run-metadata.json'), PAGE_INVENTORY_FILE: path.join(dir, 'page-inventory.json'),
        TEST_DELAY_MS: '0', TEST_JITTER_MS: '0', REQUEST_DELAY_MS: '0', REQUEST_JITTER_MS: '0' },
    });
    assert.equal(result.status, 0, `${mode} checks must pass`);
    const spelling = JSON.parse(fs.readFileSync(path.join(dir, 'spelling.json')));
    assert.ok(spelling.findings.length > 0);
    if (mode === 'report') acceptedFindings = spelling.findings.map(finding => finding.id);
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'run-metadata.json')));
    assert.equal(metadata.configuration.locale, 'en-US');
    if (mode === 'report') assert.ok(metadata.scenarios.some(s => s.notApplicable));
  }
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<html lang="en"><body><header><a href="/">Home</a><button aria-label="Menu" aria-controls="mobile-menu" aria-expanded="false" id="toggle">Menu</button></header><main>Offline keyboard fixture</main><nav id="mobile-menu" hidden><a href="/">Menu home</a></nav><script>
      const toggle = document.getElementById('toggle'); const menu = document.getElementById('mobile-menu');
      toggle.onclick = () => { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); menu.querySelector('a').focus(); };
      document.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
    </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config=checks/keyboard.config.ts'], {
        stdio: 'inherit', env: { ...process.env, STORE_URL: `http://127.0.0.1:${server.address().port}`, SITE_SLUG: 'p2-keyboard-local', SITE_SETTINGS_JSON: '{}',
          TEST_DELAY_MS: '0', TEST_JITTER_MS: '0', REQUEST_DELAY_MS: '0', REQUEST_JITTER_MS: '0' },
      });
      child.on('error', reject); child.on('exit', resolve);
    });
    assert.equal(status, 0, 'Production keyboard tests must pass on both desktop and touch contexts');
  } finally { await new Promise(resolve => server.close(resolve)); }
  const languages = spawnSync('tesseract', ['--list-langs'], { encoding: 'utf8' });
  if (languages.status === 0 && languages.stdout.split(/\r?\n/).includes('eng')) {
    const native = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config=checks/ocr.config.ts'], { stdio: 'inherit' });
    assert.equal(native.status, 0, 'Installed native OCR must recognize the local canvas fixture');
  } else console.log('Native OCR check skipped: local Tesseract/eng model unavailable; mocked OCR pipeline was verified.');
  console.log('P2 offline acceptance passed: DOM spelling, strict/report, inventory, mobile touch, capability skips and merged artifacts.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
