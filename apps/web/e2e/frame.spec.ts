/** Desktop preview: a real iPhone 15 screen (393:852), about 750 px tall, one frame only. */
import { expect, test } from '@playwright/test';
import { APP, Backend } from './fixtures.ts';

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test('the /app/ desktop frame has iPhone 15 proportions and a comfortable height', async ({ page }) => {
  await new Backend(page).install();
  await page.goto(APP.replace('device=iphone15&', ''));
  const box = (await page.getByTestId('driver-app').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(393 / 852, 2);
  expect(box.height).toBeGreaterThanOrEqual(700);
  expect(box.height).toBeLessThanOrEqual(760);
  // Layout stays at the real device size; only the preview is scaled.
  expect(await page.getByTestId('driver-app').evaluate((el) => [el.clientWidth, el.clientHeight])).toEqual([393, 852]);
});

test('shorter windows shrink the preview instead of clipping it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await new Backend(page).install();
  await page.goto(APP.replace('device=iphone15&', ''));
  const box = (await page.getByTestId('driver-app').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  expect(box.width / box.height).toBeCloseTo(393 / 852, 2);
});
