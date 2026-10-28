/**
 * Ohio site honesty, against a scripted backend: the site's own disclaimer, freshness per space
 * (never the newest frame from any camera), and occupied-only detection (allow_open false) shown as
 * "can't confirm empty spaces", distinct from a genuinely full garage, a lost connection or stale data.
 */
import { expect, test, type Page } from '@playwright/test';
import { APP, Backend, demoStatus, OHIO, OHIO_SITE, type States } from './fixtures.ts';

const ids = OHIO.spaces.map((s) => s.space_id);
/** The live harness's scripted pattern: 27 of 72 open. */
const SCRIPTED: States = Object.fromEntries(ids.map((id, i) => [id, (['OPEN', 'OCCUPIED', 'OPEN', 'OCCUPIED', 'OCCUPIED', 'UNCERTAIN', 'OPEN', 'OCCUPIED'] as const)[i % 8]]));
/** What the real detector can report with allow_open false: OCCUPIED or UNCERTAIN, never OPEN. */
const DETECTOR: States = Object.fromEntries(ids.map((id, i) => [id, i % 5 < 2 ? 'OCCUPIED' : 'UNCERTAIN']));
/** Eight cameras on a round robin: each camera's nine spaces share an age, from 1 to about 17 s. */
const ROUND_ROBIN = Object.fromEntries(ids.map((id, i) => [id, 1 + Math.floor(i / 9) * 2.3]));

async function open(page: Page, states: States, status: unknown, ages: Record<string, number> = {}) {
  const be = new Backend(page, states, { scenario: true, status, fixture: OHIO });
  be.ages = ages;
  await be.install();
  await page.goto(APP);
  return be;
}
const tapBay = (page: Page, id: string) => page.locator(`[data-bay=${id}]`).click({ force: true });

test('Ohio: the site disclaimer comes from the backend and is shown in garage details and About', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await page.getByTestId('view-spaces').click();
  const note = page.getByTestId('site-disclaimer');
  await expect(note).toContainText(OHIO_SITE.tag);
  await expect(note).toContainText('Not an official or exact digital twin');
  await expect(page.getByTestId('garage-title')).toHaveText('Ohio Union North Garage-inspired');
  await page.getByRole('button', { name: 'About this data' }).click();
  await expect(page.getByTestId('about-site')).toContainText(OHIO_SITE.disclaimer);
});

test('no site metadata, no disclaimer card (nothing is invented)', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, null));
  await page.getByTestId('view-spaces').click();
  await expect(page.getByTestId('garage-panel')).toBeVisible();
  await expect(page.getByTestId('site-disclaimer')).toHaveCount(0);
});

test('Ohio 72-space layout renders and only fresh OPEN spaces are selectable', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await expect(page.getByTestId('open-count')).toHaveText('27');
  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(72);
  await expect(page.locator('[data-bay][aria-disabled=false]')).toHaveCount(27);
  await expect(page.locator('[data-bay][data-state=occupied][aria-disabled=false]')).toHaveCount(0);
  await expect(page.locator('[data-bay][data-state=uncertain][aria-disabled=false]')).toHaveCount(0);
});

test('allow_open=false: occupied-only detection is explained, never shown as a full garage', async ({ page }) => {
  await open(page, DETECTOR, demoStatus(false, OHIO_SITE));
  await expect(page.getByTestId('open-disabled')).toBeVisible();
  await expect(page.getByTestId('occupied-count')).toHaveText('30');
  await expect(page.getByTestId('open-disabled-line')).toHaveText('Open-space confirmation isn’t enabled in this demo yet.');
  await expect(page.getByText('spaces confirmed open')).toHaveCount(0);
  await expect(page.getByTestId('watch')).toHaveCount(0); // a watch for OPEN that can never come would mislead
  await expect(page.getByRole('button', { name: /open spaces can’t be confirmed yet/ })).toBeVisible(); // map pin

  await page.getByTestId('view-garage').click();
  await expect(page.getByTestId('open-disabled-card')).toContainText('We can detect occupied spaces, but can’t yet confirm empty ones.');
  await expect(page.getByTestId('garage-stats').locator('.stat.open b')).toHaveText('—');
  await expect(page.getByTestId('advice')).toHaveCount(0);

  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(72);
  await expect(page.locator('[data-bay][aria-disabled=false]')).toHaveCount(0);
  await expect(page.getByTestId('no-choice')).toHaveText('Open-space confirmation isn’t enabled in this demo yet, so no space can be chosen.');
  await tapBay(page, ids[2]); // UNCERTAIN in DETECTOR
  await expect(page.getByTestId('bay-note')).toContainText('empty spaces can\'t be confirmed in this demo yet');
  await expect(page.getByTestId('chosen')).toHaveCount(0);
});

test('allow_open=false on Plan: "can’t be confirmed yet", not "0 confirmed open"', async ({ page }) => {
  await open(page, DETECTOR, demoStatus(false, OHIO_SITE));
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('parkline')).toContainText('Open spaces can’t be confirmed yet');
  await expect(page.getByTestId('alert-parking-unverified')).toBeVisible();
  await expect(page.getByTestId('alert-parking-none')).toHaveCount(0);
});

test('the occupied-only state stays distinct from a genuinely full garage, a lost connection and stale data', async ({ page }) => {
  // OPEN enabled, nothing open: the existing "0 confirmed open" state with a watch.
  const full = await open(page, DETECTOR, demoStatus(true, OHIO_SITE));
  await expect(page.getByTestId('open-count')).toHaveText('0');
  await expect(page.getByTestId('watch')).toBeVisible();
  await expect(page.getByTestId('open-disabled')).toHaveCount(0);
  full.disconnect();
  await expect(page.getByTestId('reconnecting')).toBeVisible();

  // OPEN disabled but disconnected: "paused" wins; nothing claims what the cameras see.
  const page2 = await page.context().newPage();
  const be2 = await open(page2, DETECTOR, demoStatus(false, OHIO_SITE));
  await expect(page2.getByTestId('open-disabled')).toBeVisible();
  be2.disconnect();
  await expect(page2.getByText('Live data paused')).toBeVisible();
  await expect(page2.getByTestId('open-disabled')).toHaveCount(0);

  // OPEN disabled and every space stale: "No recent camera view", not "Live".
  const page3 = await page.context().newPage();
  await open(page3, Object.fromEntries(ids.map((id) => [id, 'STALE'])), demoStatus(false, OHIO_SITE), Object.fromEntries(ids.map((id) => [id, 40])));
  await expect(page3.getByTestId('stale-state')).toBeVisible();
  await expect(page3.getByTestId('open-disabled')).toHaveCount(0);
  await expect(page3.getByTestId('prov-quiet')).toHaveText('No recent camera view');
  await expect(page3.getByTestId('prov-live')).toHaveCount(0);
});

test('a space last observed ~17 s ago never shows a 1-second freshness label', async ({ page }) => {
  const states = { ...SCRIPTED, [ids[70]]: 'OPEN' as const }; // the last camera's spaces are the oldest
  await open(page, states, demoStatus(true, OHIO_SITE), ROUND_ROBIN);
  // Garage level: as old as the oldest current view, and not "Live" past 12 s.
  await expect(page.getByTestId('prov-aging')).toHaveText(/^Camera views \d–(1[7-9]|[2-5]\d) s old$/);
  await expect(page.getByTestId('prov-live')).toHaveCount(0);
  await expect(page.getByText(/Live · 1 s/)).toHaveCount(0);

  await page.getByTestId('view-spaces').click();
  await page.getByTestId('choose-space').click();
  await tapBay(page, ids[70]);
  await expect(page.getByTestId('chosen')).toHaveText(ids[70]);
  await expect(page.getByTestId('chosen-age')).toHaveText(/^Open · seen (1[7-9]|[2-5]\d) s ago$/);
  await expect(page.getByTestId('chosen-age')).toHaveAttribute('data-tone', 'aging');
  await tapBay(page, ids[71]); // OCCUPIED, same camera
  await expect(page.getByTestId('bay-note')).toContainText(/is occupied · seen (1[7-9]|[2-5]\d) s ago/);

  // The trip uses the space's own age too.
  await tapBay(page, ids[70]);
  await page.getByTestId('go-space').click();
  await expect(page.getByTestId('trip-age')).toHaveText(/^Seen (1[7-9]|[2-5]\d) s ago$/);
  await expect(page.getByTestId('trip-age')).toHaveAttribute('data-tone', 'aging');
});

test('fresh spaces still read as Live, with their own age', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await expect(page.getByTestId('prov-live')).toHaveText(/^Live · \d+ s$/);
  await page.getByTestId('go').click();
  await expect(page.getByTestId('trip-age')).toHaveText(/^Live · seen \d+ s ago$/);
});

test('a stale space is counted beside the label, not hidden in it', async ({ page }) => {
  await open(page, { ...SCRIPTED, [ids[0]]: 'STALE' }, demoStatus(true, OHIO_SITE));
  await expect(page.getByTestId('prov-live')).toBeVisible();
  await expect(page.getByTestId('prov-stale')).toHaveText('1 without a recent view');
});

test('the illustrated-map label never covers the garage pin (Ohio, tall peek sheet)', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await expect(page.getByTestId('open-count')).toHaveText('27');
  const label = await page.getByTestId('map-label').boundingBox();
  const pin = await page.locator('.pinbtn').boundingBox();
  expect(label && pin).toBeTruthy();
  const overlap = label!.x < pin!.x + pin!.width && pin!.x < label!.x + label!.width && label!.y < pin!.y + pin!.height && pin!.y < label!.y + label!.height;
  expect(overlap).toBe(false);
});

test('the Ohio garage title is the site title, whole; size and simulation are secondary', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await page.getByTestId('view-spaces').click();
  await expect(page.getByTestId('garage-title')).toHaveText('Ohio Union North Garage-inspired');
  await expect(page.getByTestId('garage-panel').locator('.ey').first()).toHaveText('Level 1 · 72 spaces');
  // Clipped = the text needs more height than the clamped box shows (measured on an unclamped copy).
  const clipped = await page.getByTestId('garage-title').evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    Object.assign(c.style, { webkitLineClamp: 'unset', display: 'block', overflow: 'visible', position: 'absolute', visibility: 'hidden', width: `${el.clientWidth}px` });
    el.parentElement!.appendChild(c);
    const natural = c.getBoundingClientRect().height;
    c.remove();
    return natural > el.getBoundingClientRect().height + 2;
  });
  expect(clipped).toBe(false);
});

test('About names the actual source: a scripted run is never called real detection', async ({ page }) => {
  await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  await page.getByTestId('view-spaces').click();
  await page.getByRole('button', { name: 'About this data' }).click();
  await expect(page.getByTestId('about-simulated')).toContainText('scripted test source, not a detector');
  await expect(page.getByTestId('about')).not.toContainText('The detection is real');
});

test('deep links open Plan or garage details directly (used by the presentation tour)', async ({ page }) => {
  const be = new Backend(page, SCRIPTED, { scenario: true, status: demoStatus(true, OHIO_SITE), fixture: OHIO });
  await be.install();
  await page.goto(`${APP}&tab=plan`);
  await expect(page.getByTestId('driver-app')).toHaveAttribute('data-tab', 'plan');
  await page.goto(`${APP}&sheet=garage`);
  await expect(page.getByTestId('garage-panel')).toBeVisible();
});

test('parking observations: no green segment and an explanation when open detection is off', async ({ page }) => {
  await open(page, DETECTOR, demoStatus(false, OHIO_SITE));
  const obs = page.getByTestId('obs');
  await expect(obs).toHaveAttribute('data-open-enabled', 'false');
  await expect(obs.locator('[data-seg=open]')).toHaveCount(0);
  await expect(obs.locator('[data-seg=occupied]')).toHaveCount(1);
  await expect(obs).toContainText('30 Occupied');
  await expect(obs).toContainText('42 Can’t confirm');
  await expect(obs).not.toContainText('Confirmed open');
  await expect(obs).toContainText('Open-space confirmation isn’t enabled in this demo yet.');
  await expect(obs.getByRole('img')).toHaveAttribute('aria-label', /30 occupied, 42 can't confirm, of 72 spaces/);
});

test('parking observations: confirmed open appears only from real OPEN evidence', async ({ page }) => {
  const be = await open(page, SCRIPTED, demoStatus(true, OHIO_SITE));
  const obs = page.getByTestId('obs');
  await expect(obs).toContainText('27 Confirmed open');
  await expect(obs.locator('[data-seg=open]')).toHaveCount(1);
  be.update(Object.fromEntries(ids.map((id) => [id, SCRIPTED[id] === 'OPEN' ? 'OCCUPIED' : SCRIPTED[id]])) as States);
  await expect(obs).toContainText('0 Confirmed open');
  await expect(obs.locator('[data-seg=open]')).toHaveCount(0);
});
