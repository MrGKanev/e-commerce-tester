import { test, expect } from '@playwright/test';
import { readRasterText } from '../tests/ocr';

test('native Tesseract reads rendered canvas text and returns CSS coordinates', async ({
  page,
}) => {
  await page.setContent(
    '<html lang="en"><main><canvas id="banner" width="480" height="120"></canvas></main></html>',
  );
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 480, 120);
    context.fillStyle = 'black';
    context.font = 'bold 64px Arial';
    context.fillText('SALE', 20, 85);
  });
  const report = await readRasterText(page, 'en', ['en'], {
    enabled: true,
    selector: 'canvas',
    maxImages: 1,
    minConfidence: 50,
    tessdataPath: '',
  });
  expect(report.samples.some(sample => /SALE/i.test(sample.text))).toBe(true);
  expect(report.stats.imagesChecked).toBe(1);
  expect(report.stats.engine).toMatch(/tesseract/i);
  expect(report.samples[0].rect.width).toBeGreaterThan(0);
});
