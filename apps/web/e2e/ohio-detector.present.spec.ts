/**
 * Presentation (/present/) on the detector-like Ohio run: the real V5 app beside the AI view,
 * both reading the same facility, with open detection off and nothing invented as OPEN.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test('split demo: same facility on both sides, honest site label and occupied-only state', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/present/');
  await expect(page.getByTestId('presentation')).toHaveAttribute('data-mode', 'split');
  await expect(page.getByTestId('pz-site-title')).toHaveText('Ohio Union North Garage-inspired');
  await expect(page.getByTestId('pz-simulation')).toHaveText('Simulation');
  await expect(page.getByTestId('pz-disclaimer')).toContainText('Not an official or exact digital twin');

  // Student side: the real V5 app, embedded.
  const app = page.frameLocator('[data-testid=pz-app]');
  await expect(app.getByTestId('open-disabled')).toBeVisible({ timeout: 15_000 });

  // AI side: the four-step flow, the detector named honestly, the judge metrics.
  await expect(page.getByTestId('pipeline-flow').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('pz-detector')).toHaveAttribute('data-kind', 'scripted');
  await expect(page.getByTestId('pz-noframe')).toContainText('not NVIDIA A2');
  await expect(page.getByTestId('pz-m-cameras')).toContainText('8');
  await expect(page.getByTestId('pz-m-spaces')).toContainText('72');
  await expect(page.getByTestId('pz-m-spaces')).toContainText('simulated spaces');
  await expect(page.getByTestId('pz-m-open')).toHaveCount(0); // no "0 confirmed open"
  await expect(page.getByTestId('pz-open-disabled')).toContainText('Open-space confirmation not enabled');
  await expect(page.getByTestId('pz-open-disabled')).toContainText('Occupied spaces are detected; empty spaces remain unconfirmed.');
  await expect(page.locator('.pz-map [data-state=open]')).toHaveCount(0);

  // Both sides agree on what is occupied.
  await expect(async () => {
    const student = (await app.getByTestId('occupied-count').textContent())?.trim();
    const ai = (await page.getByTestId('pz-m-occ').locator('b').textContent())?.trim();
    expect(student).toBeTruthy();
    expect(ai).toBe(student);
  }).toPass({ timeout: 10_000 });
});

test('modes: student only, live AI only, and the garage tour shows the whole title', async ({ page }) => {
  await page.goto('/present/?mode=ai');
  await expect(page.getByTestId('pz-ai')).toBeVisible();
  await expect(page.getByTestId('pz-student')).toHaveCount(0);
  await page.getByTestId('pz-mode-student').click();
  await expect(page.getByTestId('pz-ai')).toHaveCount(0);
  await expect(page).toHaveURL(/mode=student/);
  await page.getByTestId('pz-tour-garage').click();
  const app = page.frameLocator('[data-testid=pz-app]');
  await expect(app.getByTestId('garage-title')).toHaveText('Ohio Union North Garage-inspired', { timeout: 15_000 });
  await expect(app.getByTestId('site-disclaimer')).toContainText('Not an official or exact digital twin');
  await page.keyboard.press('2');
  await expect(page.getByTestId('presentation')).toHaveAttribute('data-mode', 'split');
});

test('the legacy demo screen keeps its route, with the compact flow instead of seven stages', async ({ page }) => {
  await page.goto('/?record=1');
  await expect(page.getByTestId('pipeline-flow').locator('li')).toHaveCount(4);
  await expect(page.locator('.d-steps')).toHaveCount(0);
  await expect(page.locator('.demo')).toHaveAttribute('data-step', /[1-7]/);
});
