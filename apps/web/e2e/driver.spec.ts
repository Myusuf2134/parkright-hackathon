/**
 * Driver app against a scripted backend (no API process). These pin the safety rules:
 * only fresh OPEN is offered, a lost space is withdrawn out loud, demo data is labelled.
 */
import { expect, test } from '@playwright/test';
import { APP, Backend, V4 } from './fixtures.ts';

const openBays = (page: import('@playwright/test').Page) => page.locator('[data-bay][aria-disabled=false]');
/** Unselectable bays are aria-disabled but still tappable, so they can explain why. Playwright won't
 *  click aria-disabled elements on its own, hence force. */
const tapBay = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-bay=${id}]`).click({ force: true });

test('Explore answers with the confirmed-open count only', async ({ page }) => {
  const be = new Backend(page, { ...V4, A6: 'STALE' }, { scenario: true });
  await be.install();
  await page.goto(APP);
  // V4 has 7 open; A6 is now "OPEN but stale", which must not count.
  await expect(page.getByTestId('open-count')).toHaveText('6');
  await expect(page.getByTestId('prov-live')).toBeVisible();
  await expect(page.getByText('Simulated garage').first()).toBeVisible();
});

test('only fresh OPEN spaces can be chosen; others explain why', async ({ page }) => {
  const be = new Backend(page, { ...V4, A6: 'STALE' });
  await be.install();
  await page.goto(APP);
  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(12);
  const ids = await openBays(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-bay')).sort());
  expect(ids).toEqual(['A2', 'A4', 'B1', 'B4', 'B5', 'B6']);
  await tapBay(page, 'A5');
  await expect(page.getByTestId('bay-note')).toContainText("A5 can't be confirmed right now");
  await tapBay(page, 'A6');
  await expect(page.getByTestId('bay-note')).toContainText('no recent camera view');
  await tapBay(page, 'A1');
  await expect(page.getByTestId('bay-note')).toContainText('A1 is occupied');
  await expect(page.getByTestId('chosen')).toHaveText('A2'); // suggested, unchanged by those taps
});

test('a chosen space that stops being open is withdrawn with a message', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto(APP);
  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  await page.locator('[data-bay=B4]').click();
  await expect(page.getByTestId('chosen')).toHaveText('B4');
  be.update({ B4: 'UNCERTAIN' });
  await expect(page.getByTestId('toast')).toContainText('B4 is no longer confirmed open');
  await expect(page.locator('[data-bay=B4]')).toHaveAttribute('aria-disabled', 'true');
});

test('disconnect shows nothing as available and recovers', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto(APP);
  await expect(page.getByTestId('open-count')).toHaveText('7');
  be.disconnect();
  await expect(page.getByTestId('reconnecting')).toBeVisible();
  await expect(page.getByTestId('open-count')).toHaveText('—');
  await expect(page.getByTestId('ticks').locator('i:not(.u)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Go/ })).toBeDisabled();
  be.reconnect();
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
  await expect(page.getByTestId('reconnecting')).toHaveCount(0);
});

test('Go rechecks the space first and refuses a stale answer', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  be.spaceOverride.A2 = 'OCCUPIED'; // the fresh read disagrees with the socket
  await page.goto(APP);
  await page.getByTestId('go').click();
  await expect(page.getByTestId('toast')).toContainText('A2 is no longer confirmed open');
  await expect(page.getByTestId('trip')).toHaveCount(0);
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'space');
});

test('trip watches the space, warns when taken and offers the next one', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto(APP);
  await page.getByTestId('go').click();
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'ok');
  await expect(page.getByText('Demo guidance · not live directions')).toBeVisible();
  await expect(page.getByTestId('trip-title')).toHaveText('A2 is still open');
  be.update({ A2: 'OCCUPIED' });
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'taken');
  await expect(page.getByTestId('trip-title')).toHaveText('A2 was just taken');
  await expect(page.getByTestId('switch')).toHaveText('Switch to A4');
  await page.getByTestId('switch').click();
  await expect(page.getByTestId('trip-title')).toHaveText('A4 is still open');
  be.disconnect();
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'paused');
});

test('accessible and EV spaces need the matching setting; a permit unlocks nothing', async ({ page }) => {
  const be = new Backend(page);
  be.designations = { B6: 'accessible', B5: 'ev', B4: 'reserved' };
  await be.install();
  await page.goto(APP);
  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  for (const id of ['B4', 'B5', 'B6']) await expect(page.locator(`[data-bay=${id}]`)).toHaveAttribute('aria-disabled', 'true');
  await tapBay(page, 'B4');
  await expect(page.getByTestId('bay-note')).toContainText('never offers reserved');
  // Turn on everything in You, including the self-reported permit.
  await page.getByRole('button', { name: 'Back to garage details' }).click();
  await page.getByRole('button', { name: 'Close garage details' }).click();
  await page.getByTestId('tab-you').click();
  await page.getByRole('switch', { name: 'Accessible placard' }).click();
  await page.getByRole('switch', { name: /Student permit/ }).click();
  await expect(page.getByText('Self-reported · not verified')).toBeVisible();
  await page.getByTestId('vehicle-card').click();
  await page.getByTestId('vehicle-ev').click();
  await page.getByTestId('tab-explore').click();
  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay=B6]')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('[data-bay=B5]')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('[data-bay=B4]')).toHaveAttribute('aria-disabled', 'true');
});

test('demo data is labelled everywhere it appears', async ({ page }) => {
  const be = new Backend(page, V4, { scenario: true });
  await be.install();
  await page.goto(APP);
  await expect(page.getByTestId('search').locator('[data-demo]')).toHaveText('Demo');
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('scenario-pill')).toContainText('Demo');
  // Every estimate in the hero says where it came from; the schedule and departure are demo.
  const hero = page.getByTestId('arrival-hero');
  await expect(hero.locator('[data-source=demo]')).toHaveCount(2);
  await expect(page.getByTestId('parkline').locator('[data-source=simulated]')).toBeVisible();
  await page.getByTestId('find-near').click();
  await expect(page.getByTestId('explore')).toBeVisible();
});

test('without demo mode nothing pretends to be a schedule', async ({ page }) => {
  const be = new Backend(page, V4, { scenario: false });
  await be.install();
  await page.goto(APP);
  await expect(page.getByText('Search a campus building')).toBeVisible();
  await expect(page.locator('[data-demo]')).toHaveCount(0);
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('plan-empty')).toContainText("aren't connected yet");
});

test('no personal names in the UI', async ({ page }) => {
  const be = new Backend(page, V4, { scenario: true });
  await be.install();
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  for (const tab of ['explore', 'plan', 'you']) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.locator('body')).not.toContainText('Mahdi');
  }
});

test.describe('splash', () => {
  test('first launch plays the full sequence, then gets out of the way', async ({ page }) => {
    await new Backend(page).install();
    await page.goto('/app/?device=iphone15');
    await expect(page.getByTestId('splash')).toHaveAttribute('data-variant', 'full');
    await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 4000 });
    await expect(page.getByTestId('open-count')).toHaveText('7');
    // A new session for a returning driver gets the short version.
    const second = await page.context().newPage();
    await new Backend(second).install();
    await second.goto('/app/?device=iphone15');
    await expect(second.getByTestId('splash')).toHaveAttribute('data-variant', 'short');
    await expect(second.getByTestId('splash')).toHaveCount(0, { timeout: 1600 });
  });

  test('reduced motion gets a crossfade', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 393, height: 852 } });
    const page = await ctx.newPage();
    await new Backend(page).install();
    await page.goto('/app/');
    await expect(page.getByTestId('splash')).toHaveAttribute('data-variant', 'reduced');
    await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 1600 });
    await ctx.close();
  });

  test('tap skips it', async ({ page }) => {
    await new Backend(page).install();
    await page.goto('/app/?splash=full');
    await page.getByTestId('splash').click();
    await expect(page.getByTestId('splash')).toHaveCount(0);
  });
});

test('legacy screens keep their routes', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto('/?classic=1');
  await expect(page.getByRole('button', { name: /ParkRight Virtual Garage/ })).toBeVisible();
});

test('no horizontal overflow on any screen', async ({ page }) => {
  await new Backend(page, V4, { scenario: true }).install();
  await page.goto(APP);
  const check = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
  await check();
  for (const tab of ['plan', 'you', 'explore']) { await page.getByTestId(`tab-${tab}`).click(); await check(); }
  await page.getByTestId('view-spaces').click(); await check();
  await page.getByTestId('choose-space').click(); await check();
});
