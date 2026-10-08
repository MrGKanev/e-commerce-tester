import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { SiteSettings } from '../config/site-settings';

const execute = promisify(execFile);
type Options = SiteSettings['spelling']['ocr'];
export type OcrSample = {
  text: string;
  source: string;
  language: string;
  component: string;
  locator: string;
  rect: { x: number; y: number; width: number; height: number };
};
const engines = new Map<string, Promise<string>>();
const cache = new Map<string, string>();

export async function probeOCR(options: Options, languages: ('bg' | 'en')[]) {
  const codes = languages.map(language => (language === 'bg' ? 'bul' : 'eng'));
  const key = options.tessdataPath + ':' + codes.join('+');
  if (!engines.has(key))
    engines.set(
      key,
      (async () => {
        const extra = options.tessdataPath ? ['--tessdata-dir', options.tessdataPath] : [];
        try {
          const listed = await execute('tesseract', ['--list-langs', ...extra], {
            encoding: 'utf8',
            timeout: 20000,
          });
          const available = listed.stdout.split(/\r?\n/).map(line => line.trim());
          if (codes.some(code => !available.includes(code)))
            throw new Error(
              `Required local OCR models missing: ${codes.filter(code => !available.includes(code)).join(', ')}`,
            );
          const version = await execute('tesseract', ['--version'], {
            encoding: 'utf8',
            timeout: 20000,
          });
          return version.stdout.split(/\r?\n/)[0];
        } catch (error) {
          throw new Error(
            `Local OCR requires Tesseract and the requested local models: ${(error as Error).message}`,
          );
        }
      })(),
    );
  return engines.get(key)!;
}

export async function readRasterText(
  page: Page,
  fallbackLanguage: string,
  languages: ('bg' | 'en')[],
  options: Options,
  excludeSelectors: string[] = [],
) {
  const samples: OcrSample[] = [];
  const stats = {
    enabled: options.enabled,
    engine: '',
    imagesChecked: 0,
    wordsRecognized: 0,
    lowConfidenceSkipped: 0,
  };
  if (!options.enabled) return { samples, stats };
  stats.engine = await probeOCR(options, languages);
  const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const images = page.locator(options.selector).filter({ visible: true });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'store-ocr-'));
  try {
    for (
      let index = 0;
      index < (await images.count()) && stats.imagesChecked < options.maxImages;
      index++
    ) {
      const image = images.nth(index);
      if (
        await image.evaluate(
          (element, excluded) =>
            !!element.closest('[hidden], [aria-hidden="true"]') ||
            excluded.some(selector => element.closest(selector)),
          excludeSelectors,
        )
      )
        continue;
      const initial = await image.boundingBox();
      if (!initial || initial.width < 40 || initial.height < 12) continue;
      await image.scrollIntoViewIfNeeded();
      const pixels = await image.screenshot({ animations: 'disabled', scale: 'css' });
      const box = await image.boundingBox();
      if (!box) throw new Error('OCR element disappeared during capture');
      const details = await image.evaluate(element => {
        const owner =
          element.closest('[data-component]') ||
          element.closest('header, footer') ||
          element.closest('main, nav, form');
        return {
          language: element.closest('[lang]')?.getAttribute('lang'),
          component:
            owner?.getAttribute('data-component') || owner?.tagName.toLowerCase() || 'body',
          x: scrollX,
          y: scrollY,
        };
      });
      const key = createHash('sha256')
        .update(pixels)
        .update(languages.join('+'))
        .update(options.tessdataPath)
        .digest('hex');
      let tsv = cache.get(key);
      if (!tsv) {
        const file = path.join(directory, `${index}.png`);
        await fs.writeFile(file, pixels);
        const extra = options.tessdataPath ? ['--tessdata-dir', options.tessdataPath] : [];
        const result = await execute(
          'tesseract',
          [
            file,
            'stdout',
            ...extra,
            '-l',
            languages.map(language => (language === 'bg' ? 'bul' : 'eng')).join('+'),
            '--psm',
            '11',
            'tsv',
          ],
          { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
        );
        tsv = result.stdout;
        cache.set(key, tsv);
      }
      stats.imagesChecked++;
      for (const row of tsv.split(/\r?\n/).slice(1)) {
        const cells = row.split('\t');
        if (cells.length < 12 || cells[0] !== '5' || !cells[11].trim()) continue;
        if (!/\p{L}/u.test(cells[11]) || /\d/.test(cells[11])) continue;
        const confidence = Number(cells[10]);
        if (!Number.isFinite(confidence) || confidence < options.minConfidence) {
          stats.lowConfidenceSkipped++;
          continue;
        }
        const [left, top, width, height] = cells.slice(6, 10).map(Number);
        if (![left, top, width, height].every(Number.isFinite))
          throw new Error('Malformed OCR coordinates');
        stats.wordsRecognized++;
        samples.push({
          text: cells.slice(11).join('\t'),
          source: 'ocr',
          language: details.language || fallbackLanguage,
          component: details.component,
          locator: `${options.selector} >> nth=${index}`,
          rect: { x: box.x + details.x + left, y: box.y + details.y + top, width, height },
        });
      }
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await page.evaluate(position => scrollTo(position.x, position.y), originalScroll);
  }
  return { samples, stats };
}
