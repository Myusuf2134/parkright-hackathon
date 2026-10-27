/** Arrival Intelligence on the Plan screen, with the scripted backend (deterministic demo scenarios). */
import { expect, test, type Page } from '@playwright/test';
import { Backend, V4 } from './fixtures.ts';

const plan = async (page: Page, scenario: string, opts: { demo?: boolean } = { demo: true }) => {
  const be = new Backend(page, V4, { scenario: opts.demo });
  await be.install();
  await page.goto(`/app/?device=iphone15&splash=off&arrival=${scenario}`);
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('plan')).toHaveAttribute('data-arrival', scenario);
  return be;
};

test('normal day: next class, 9:58 departure, calm', async ({ page }) => {
  await plan(page, 'normal');
  await expect(page.getByTestId('course')).toHaveText('CSE 2421');
  await expect(page.getByTestId('building')).toHaveText('Dreese Laboratories');
  await expect(page.getByTestId('leave-at')).toHaveText('9:58AM');
  await expect(page.getByTestId('arrival-note')).toHaveText('Parking and walking time included.');
  await expect(page.getByTestId('calm')).toBeVisible();
  await expect(page.locator('[data-testid^=alert-]')).toHaveCount(0);
});

test('traffic: only the on-route crash shows; unrelated events are filtered and explained', async ({ page }) => {
  await plan(page, 'traffic');
  await expect(page.getByTestId('leave-at')).toHaveText('9:46AM');
  await expect(page.getByTestId('alert-route-crash')).toBeVisible();
  await expect(page.getByTestId('alert-closure-elsewhere')).toHaveCount(0);
  await expect(page.getByTestId('alert-other-class')).toHaveCount(0);
  await page.getByTestId('filtered').getByRole('button').click();
  await expect(page.getByTestId('filtered')).toContainText('Not on your route');
  await expect(page.getByTestId('filtered')).toContainText('not yours');
});

test('busy elsewhere: five events checked, none shown, departure unchanged', async ({ page }) => {
  await plan(page, 'quiet');
  await expect(page.locator('[data-testid^=alert-]')).toHaveCount(0);
  await expect(page.getByTestId('filtered')).toContainText('5 other updates checked');
  await expect(page.getByTestId('leave-at')).toHaveText('9:58AM');
});

test('switching scenarios updates the departure in place', async ({ page }) => {
  await plan(page, 'normal');
  await page.getByTestId('scenario-pill').click();
  await page.getByTestId('scenario-weather').click();
  await expect(page.getByTestId('leave-at')).toHaveText('9:50AM');
  await expect(page.getByTestId('alert-snow')).toBeVisible();
});

test('class canceled: no departure, trip can be removed and restored', async ({ page }) => {
  await plan(page, 'canceled');
  await expect(page.getByTestId('departure-not-needed')).toBeVisible();
  await expect(page.getByTestId('leave-at')).toHaveCount(0);
  await page.getByTestId('remove-trip').click();
  await expect(page.getByTestId('trip-removed')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('arrival-hero')).toBeVisible();
});

test('room change: new building, and Explore follows it', async ({ page }) => {
  await plan(page, 'moved');
  await expect(page.getByTestId('building')).toHaveText('Engineering Annex');
  await expect(page.getByTestId('leave-at')).toHaveText('9:55AM');
  await page.getByTestId('find-near').click();
  await expect(page.getByTestId('search')).toContainText('Engineering Annex');
  await expect(page.getByTestId('search')).toContainText('Leave 9:55 AM');
});

test('missing data: says unavailable instead of guessing', async ({ page }) => {
  await plan(page, 'missing');
  await expect(page.getByTestId('departure-unavailable')).toContainText("won't guess");
  await expect(page.getByTestId('leave-at')).toHaveCount(0);
});

test('alerts can be dismissed', async ({ page }) => {
  await plan(page, 'construction');
  await page.getByRole('button', { name: /Dismiss: Roadwork/ }).click();
  await expect(page.getByTestId('alert-entrance-work')).toHaveCount(0);
});

test('parking semantics are live: no confirmed space raises a live alert; disconnect pauses it', async ({ page }) => {
  const be = await plan(page, 'normal');
  await expect(page.getByTestId('parkline')).toContainText('7 confirmed open');
  be.update(Object.fromEntries(Object.keys(V4).map((k) => [k, 'OCCUPIED'])) as typeof V4);
  await expect(page.getByTestId('alert-parking-none')).toBeVisible();
  await expect(page.getByTestId('alert-parking-none').locator('[data-source=live]')).toBeVisible();
  await expect(page.getByTestId('leave-at')).toHaveText('9:58AM'); // never later because parking is uncertain
  be.disconnect();
  await expect(page.getByTestId('alert-parking-paused')).toBeVisible();
  await expect(page.getByTestId('parkline')).toContainText('Live parking paused');
});

test('without demo mode, Plan says schedules are not connected and offers a labelled preview', async ({ page }) => {
  await plan(page, 'normal', { demo: false });
  await expect(page.getByTestId('plan-empty')).toBeVisible();
  await page.getByTestId('preview-demo').click();
  await expect(page.getByTestId('scenario-pill')).toContainText('Demo');
  await expect(page.getByTestId('leave-at')).toHaveText('9:58AM');
});

test('You: vehicle sheet, unverified permit, push not available', async ({ page }) => {
  await new Backend(page).install();
  await page.goto('/app/?device=iphone15&splash=off');
  await page.getByTestId('tab-you').click();
  await page.getByTestId('vehicle-card').click();
  await page.getByTestId('vehicle-ev').click();
  await expect(page.getByTestId('vehicle-card')).toContainText('Electric');
  await page.getByRole('switch', { name: /Student permit/ }).click();
  await expect(page.getByText('Self-reported · not verified')).toBeVisible();
  await expect(page.getByTestId('push-row')).toContainText('Not available');
});
