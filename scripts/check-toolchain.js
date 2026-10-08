'use strict';
const fs = require('node:fs');
const version = require('@playwright/test/package.json').version;
if (require('../package.json').devDependencies['@playwright/test'] !== version) throw new Error('Playwright must be pinned to the installed version');
const imageVersion = /^FROM\s+mcr\.microsoft\.com\/playwright:v([\d.]+)-/mi.exec(fs.readFileSync(require('node:path').join(__dirname, '../Dockerfile'), 'utf8'))?.[1];
if (imageVersion !== version) throw new Error(`Docker image must match Playwright ${version}`);
console.log(`Docker/Playwright versions match: ${version}`);
