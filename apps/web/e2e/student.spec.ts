/**
 * The student app's whole journey against the real API (e2e/student_api.py): three simulated garages
 * over real WebSockets, plus the demo feed. These use no mocked data.
 */
import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8437';
const APP = '/app/?device=iphone15&splash=off';
const post = (path: string, body?: unknown) => fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test.beforeEach(async () => { await post('/__test/reset'); });

const errors = (page: Page) => {
  const seen: string[] = [];
  // This suite has no directions service; WebKit logs a request cancelled by leaving the page as an error.
  const keep = (text: string) => { if (!text.includes('__routing')) seen.push(text); };
  page.on('console', (m) => { if (m.type() === 'error') keep(m.text()); });
  page.on('pageerror', (e) => keep(String(e)));
  return seen;
};
const list = async (page: Page) => { await page.goto(APP); await page.getByTestId('all-garages').click(); await expect(page.getByTestId('garage-list')).toBeVisible(); };

test('home lists every garage with its source, and recommends only confirmed space', async ({ page }) => {
  const seen = errors(page);
  await list(page);
  await expect(page.getByTestId('garage-row-garage-01')).toContainText('Simulated');
  await expect(page.getByTestId('garage-row-garage-01').getByTestId('row-count')).toHaveText('7');
  await expect(page.getByTestId('garage-row-lane-avenue-garage')).toContainText('Demo feed');
  await expect(page.getByTestId('garage-row-lane-avenue-garage')).toContainText('demo feed');
  // Monitored garages with confirmed space always outrank the demo feed.
  await expect(page.getByTestId('garage-row-lane-avenue-garage')).toHaveAttribute('data-tier', '1');
  await expect(page.locator('[data-tier]').first()).toHaveAttribute('data-tier', '0');
  await expect(page.getByTestId('recommended')).toContainText('confirmed open for you');
  await expect(page.getByTestId('recommended')).toContainText('demo estimate');
  expect(seen).toEqual([]);
});

test('search finds destinations and garages by keyboard and touch; unknown text gets no distances', async ({ page }) => {
  await page.goto(APP);
  await page.getByRole('button', { name: /Destination:|Search for a destination/ }).click();
  const input = page.getByTestId('search-input');
  await input.fill('tuttle');
  await expect(page.getByTestId('search-option').first()).toContainText('stand-in for Tuttle Garage');
  await input.fill('ohio union north');
  await input.press('Enter');
  await expect(page.getByTestId('garage-title')).toContainText('Ohio Union North Garage-inspired');
  await page.getByRole('button', { name: 'Close garage details' }).click();

  await page.getByTestId('search').getByRole('button').first().click();
  await input.fill('Nowhere Hall');
  await input.press('ArrowDown');
  await page.getByTestId('search-option').filter({ hasText: 'Use “Nowhere Hall”' }).click();
  await expect(page.getByTestId('search')).toContainText('Nowhere Hall');
  await page.getByTestId('all-garages').click();
  await expect(page.getByTestId('list-sub')).toContainText("isn't available");
  await expect(page.getByTestId('garage-list')).not.toContainText('min walk');
  await expect(page.getByTestId('recent-destination').first()).toHaveText('Nowhere Hall');

  // Esc closes without choosing anything.
  await page.getByRole('button', { name: 'Close garage list' }).click();
  await page.getByTestId('search').getByRole('button').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search-sheet')).toHaveCount(0);
});

test('garage details: labels, last update, and a floor plan that switches levels', async ({ page }) => {
  await list(page);
  await page.getByTestId('garage-row-demo-deck').getByRole('button').first().click();
  await expect(page.getByTestId('garage-title')).toHaveText('Meridian Two-Level Demo Deck');
  await expect(page.getByTestId('location')).toContainText('Simulated');
  await expect(page.getByTestId('last-updated')).toContainText('ago');
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay=C1]')).toHaveCount(0);
  await page.getByTestId('level-L2').click();
  await expect(page.locator('[data-bay=C1]')).toBeVisible();
  await expect(page.locator('[data-bay=A1]')).toHaveCount(0);
  // D6 is reserved: open or not, it can never be chosen. C4 is UNCERTAIN: never available.
  await post('/__test/states', { 'demo-deck': { D6: 'OPEN' } });
  await expect(page.locator('[data-bay=D6]')).toHaveAttribute('data-state', 'open');
  await expect(page.locator('[data-bay=D6]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-bay=C4]')).toHaveAttribute('data-state', 'uncertain');
  await expect(page.locator('[data-bay=C4]')).toHaveAttribute('aria-disabled', 'true');
});

test('live updates arrive without a refresh, on the list and on the plan', async ({ page }) => {
  await list(page);
  const count = page.getByTestId('garage-row-garage-01').getByTestId('row-count');
  await expect(count).toHaveText('7');
  await post('/__test/states', { 'garage-01': { A2: 'OCCUPIED', A4: 'UNCERTAIN' } });
  await expect(count).toHaveText('5', { timeout: 6000 });
  await page.getByTestId('garage-row-garage-01').getByRole('button').first().click();
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay=B1]')).toHaveAttribute('data-state', 'open');
  await post('/__test/states', { 'garage-01': { B1: 'OCCUPIED' } });
  await expect(page.locator('[data-bay=B1]')).toHaveAttribute('data-state', 'occupied', { timeout: 6000 });
});

test('stale cameras stop counting as available', async ({ page }) => {
  await list(page);
  await expect(page.getByTestId('garage-row-garage-01').getByTestId('row-count')).toHaveText('7');
  await post('/__test/camera', { paused: true });
  await expect(page.getByTestId('garage-row-garage-01').getByTestId('row-count')).toHaveText('0', { timeout: 20000 });
  await expect(page.getByTestId('garage-row-garage-01')).toHaveAttribute('data-tier', '2');
  await expect(page.getByTestId('recommended')).toHaveCount(0);
});

test('filters narrow the list and say so when empty', async ({ page }) => {
  await list(page);
  await page.getByTestId('filter-saved').click();
  await expect(page.getByTestId('list-empty')).toContainText('No saved garages');
  await page.getByTestId('filter-map').click();
  await expect(page.getByTestId('garage-row-lane-avenue-garage')).toHaveCount(0);
  await expect(page.getByTestId('garage-row-demo-deck')).toBeVisible();
  await page.getByTestId('filter-open').click();
  await expect(page.locator('[data-tier="1"]')).toHaveCount(0);
  await expect(page.locator('[data-tier="0"]').first()).toBeVisible();
});

test('favorites, recents and preferences survive a reload', async ({ page }) => {
  await list(page);
  await page.getByTestId('fav-demo-deck').click();
  await page.getByTestId('garage-row-demo-deck').getByRole('button').first().click();
  await expect(page.getByTestId('fav-demo-deck')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close garage details' }).click();
  await page.goto(`${APP}&tab=you`);
  await expect(page.getByTestId('saved-demo-deck')).toBeVisible();
  await page.getByTestId('priority-most-spaces').click();
  await page.getByTestId('maps-google').click();
  await page.getByRole('switch', { name: 'Saved garage alerts' }).click();
  await page.reload();
  await expect(page.getByTestId('priority-most-spaces')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('maps-google')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('switch', { name: 'Saved garage alerts' })).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('tab-explore').click();
  await page.getByTestId('peek-summary').click();
  await expect(page.getByTestId('saved-chip')).toContainText('Meridian Two-Level Demo Deck');
  await page.getByTestId('all-garages').click();
  await expect(page.getByTestId('recent-garage').first()).toHaveText('Meridian Two-Level Demo Deck');
  // Most spaces: the 72-space simulation leads; its walk is longer.
  await expect(page.locator('[data-tier]').first()).toHaveAttribute('data-testid', 'garage-row-ohio-union-sim');
  await page.getByTestId('clear-recents').click();
  await expect(page.getByTestId('recents')).toHaveCount(0);
});

test('directions are real maps links that keep garage and destination; a virtual garage says it has no address', async ({ page }) => {
  await page.goto(`${APP}&tab=you`);
  await page.getByTestId('maps-google').click();
  await page.getByTestId('tab-explore').click();
  await page.getByTestId('all-garages').click();
  await page.getByTestId('garage-row-garage-01').getByRole('button').first().click();
  const link = page.getByTestId('directions');
  await expect(link).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=40\.0026343%2C-83\.0177079/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('directions-note')).toContainText('simulated');
  await expect(page.getByTestId('directions-walk')).toHaveAttribute('href', /destination=Dreese.*origin=40\.0026343/);
  await page.getByRole('button', { name: 'Close garage details' }).click();
  await page.getByTestId('garage-row-demo-deck').getByRole('button').first().click();
  await expect(page.getByTestId('directions')).toHaveAttribute('href', /destination=Dreese/);
  await expect(page.getByTestId('directions-note')).toContainText('no real address');
  // The demo feed garage has directions and no space map.
  await page.getByRole('button', { name: 'Close garage details' }).click();
  await page.getByTestId('garage-row-lane-avenue-garage').getByRole('button').first().click();
  await expect(page.getByTestId('no-space-map')).toBeVisible();
  await expect(page.getByTestId('choose-space')).toHaveCount(0);
  await expect(page.getByTestId('directions')).toHaveAttribute('href', /destination=40\.0054796/);
});

test('a trip links to maps, invents no turn instructions, and warns when the space is taken', async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId('go').click();
  await expect(page.getByTestId('trip')).toBeVisible();
  await expect(page.getByTestId('head-to')).toContainText('Row');
  await expect(page.getByTestId('directions')).toBeVisible();
  await expect(page.getByTestId('trip')).not.toContainText(/turn right|turn left/i);
  const title = await page.getByTestId('trip-title').textContent();
  const id = /^(\S+) is still open/.exec(title ?? '')![1];
  await post('/__test/states', { 'garage-01': { [id]: 'OCCUPIED' } });
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'taken', { timeout: 6000 });
  await expect(page.getByTestId('trip-warning')).toBeVisible();
});

test('browser back walks back through the app’s views', async ({ page }) => {
  await list(page);
  await page.getByTestId('garage-row-demo-deck').getByRole('button').first().click();
  await expect(page.getByTestId('garage-panel')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('garage')).toBe('demo-deck');
  await page.goBack();
  await expect(page.getByTestId('garage-list')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'peek');
  // A garage link opens that garage directly.
  await page.goto(`${APP}&garage=demo-deck&sheet=garage`);
  await expect(page.getByTestId('garage-title')).toHaveText('Meridian Two-Level Demo Deck');
});

test('saved garage alert fires when a saved garage gets a usable space', async ({ page }) => {
  await post('/__test/states', { 'demo-deck': Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1','B2','B3','B4','B5','B6','C1','C2','C3','C4','C5','C6','D1','D2','D3','D4','D5','D6'].map((k) => [k, 'OCCUPIED'])) });
  await list(page);
  await expect(page.getByTestId('garage-row-demo-deck').getByTestId('row-count')).toHaveText('0', { timeout: 6000 });
  await page.getByTestId('fav-demo-deck').click();
  await post('/__test/states', { 'demo-deck': { B2: 'OPEN' } });
  await expect(page.getByTestId('toast')).toContainText('Meridian Two-Level Demo Deck now has 1 confirmed open', { timeout: 6000 });
});

for (const [w, h] of [[320, 568], [375, 667], [393, 852], [430, 932]] as const) {
  test(`no broken layout or sideways scroll at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const seen = errors(page);
    const flat = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.goto('/app/?splash=off');
    await expect(page.getByTestId('all-garages')).toBeVisible();
    await flat();
    await page.getByTestId('all-garages').click();
    await flat();
    await page.getByTestId('garage-row-ohio-union-sim').getByRole('button').first().click();
    await flat();
    await expect(page.getByTestId('choose-space')).toBeVisible();
    await page.getByTestId('choose-space').click();
    await expect(page.getByTestId('plan')).toBeVisible();
    await flat();
    for (const tab of ['plan', 'you']) {
      await page.goto(`/app/?splash=off&tab=${tab}`);
      await expect(page.getByTestId(tab)).toBeVisible();
      await flat();
    }
    expect(seen).toEqual([]);
  });
}
