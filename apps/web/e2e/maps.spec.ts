/**
 * Meridian Maps against the real API, with geolocation driven by the browser's own API and directions
 * from responses recorded from the real service. The basemap is blank here; playwright.maps-real.config.ts
 * covers the live tile and directions services.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (n: string) => readFileSync(fileURLToPath(new URL(`./routes/${n}.json`, import.meta.url)), "utf8");
const DRIVE = load('drive'), WALK = load('walk'), WALK_DIRECT = load('walk-direct'), REROUTE = load('reroute');
const API = 'http://127.0.0.1:8437';
const START = { latitude: 40.0105, longitude: -83.03, accuracy: 10 };

type Reply = 'ok' | 'fail' | 'noroute';
async function routing(page: Page, drive: Reply = 'ok') {
  const state = { drive, driveCalls: 0, rerouted: false };
  await page.route('**/__routing/**', (r) => {
    const url = r.request().url();
    if (url.includes('routed-foot')) return r.fulfill({ contentType: 'application/json', body: url.includes('-83.030000') ? WALK_DIRECT : WALK });
    state.driveCalls++;
    if (state.drive === 'fail') return r.abort('failed');
    if (state.drive === 'noroute') return r.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"NoRoute"}' });
    return r.fulfill({ contentType: 'application/json', body: state.rerouted ? REROUTE : DRIVE });
  });
  return state;
}
const located = async (context: BrowserContext, at = START) => { await context.grantPermissions(['geolocation']); await context.setGeolocation(at); };
const open = async (page: Page) => {
  await fetch(`${API}/__test/reset`, { method: 'POST' });
  await page.goto('/app/?splash=off');
  await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'yes', { timeout: 20_000 });
};
const search = async (page: Page, q: string) => {
  await page.getByTestId('search').getByRole('button').first().click();
  await page.getByTestId('search-input').fill(q);
  await page.getByTestId('search-input').press('Enter');
};
const toRoute = async (page: Page) => {
  await search(page, 'dreese');
  await page.getByTestId('destination-route').click();
  await expect(page.getByTestId('route-panel')).toBeVisible();
};

test('the map starts, with real garages as pins and no location prompt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await routing(page);
  await open(page);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByTestId('pin-osu-arps')).toBeAttached();
  await expect(page.getByTestId('map-attribution')).toContainText('OpenStreetMap');
  await expect(page.getByTestId('user-location')).toHaveCount(0);
  await expect(page.getByTestId('map-note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a simulated number is marked on its pin, and a garage with no data has no number', async ({ page }) => {
  await routing(page);
  await open(page);
  await expect(page.getByTestId('pin-ohio-union-sim')).toContainText('sim');
  await expect(page.getByTestId('pin-ohio-union-sim')).toHaveAttribute('aria-label', /in simulation, not real availability/);
  await expect(page.getByTestId('pin-osu-arps')).toHaveText('P');
  await expect(page.getByTestId('pin-osu-arps')).toHaveAttribute('aria-label', /no availability data/);
  await expect(page.getByTestId('pin-demo-deck')).toHaveCount(0); // not a real place
});

test('tapping a pin opens the garage, with its real location and honest availability', async ({ page }) => {
  await routing(page);
  await open(page);
  await page.getByTestId('pin-osu-arps').click();
  await expect(page.getByTestId('garage-title')).toHaveText('Arps Garage');
  await expect(page.getByTestId('location')).toContainText('892 spaces');
  await expect(page.getByTestId('unavailable-card')).toContainText('no cameras');
  await expect(page.getByTestId('directions')).toHaveAttribute('href', /40\.00248/);
});

test('search finds a campus building and lists garages by routed walk', async ({ page }) => {
  await routing(page);
  await open(page);
  await search(page, 'thompson library');
  await expect(page.getByTestId('pin-destination')).toHaveText(/Thompson/);
  await page.getByTestId('all-garages').click();
  await expect(page.getByTestId('list-sub')).toContainText('Ranked for Thompson');
  await expect(page.getByTestId('row-walk').first()).toContainText('min walk');
  await expect(page.getByTestId('garage-list')).not.toContainText('demo estimate');
});

test('location denied: says so, previews still work from a chosen start, guidance stays off', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit in Playwright cannot deny geolocation');
  await context.clearPermissions();
  await page.addInitScript(() => {
    const denied = (ok: unknown, err: (e: unknown) => void) => { setTimeout(() => err({ code: 1, PERMISSION_DENIED: 1, message: 'denied' }), 10); return 1; };
    Object.assign(navigator.geolocation, { watchPosition: denied });
    Object.defineProperty(navigator.geolocation, 'watchPosition', { value: denied });
  });
  await routing(page);
  await open(page);
  await page.getByTestId('locate').click();
  await expect(page.getByTestId('map-note')).toContainText('Location is off');
  await toRoute(page);
  await expect(page.getByTestId('routes-no-origin')).toBeVisible();
  await page.getByTestId('origin-select').selectOption('Ohio Stadium');
  await expect(page.getByTestId('route-option').first()).toBeVisible();
  await expect(page.getByTestId('start-nav')).toBeDisabled();
  await expect(page.getByTestId('start-bar')).toHaveAttribute('data-gate', 'denied');
  await expect(page.getByTestId('start-reason')).toContainText('Location is blocked');
  await expect(page.getByTestId('start-reason')).toContainText('Preview from Ohio Stadium still works');
  await expect(page.getByTestId('start-action')).toHaveText('Try again');
});

test('route preview: real times, no invented traffic, alternatives select, garage and walk shown', async ({ page, context }) => {
  await located(context);
  await routing(page);
  await open(page);
  await expect(page.getByTestId('user-location')).toBeAttached();
  await toRoute(page);
  const drive = JSON.parse(DRIVE);
  await expect(page.getByTestId('route-option')).toHaveCount(drive.routes.length);
  await expect(page.getByTestId('route-time').first()).toHaveText(`${Math.round(drive.routes[0].duration / 60)} min`);
  await expect(page.getByTestId('route-traffic').first()).toContainText('Live traffic not included');
  await expect(page.getByTestId('route-parking-source')).toContainText('Simulated, not real availability');
  await expect(page.getByTestId('walk-leg')).toContainText('to Dreese Laboratories');
  await expect(page.getByTestId('start-nav')).toBeEnabled();
  await expect(page.getByTestId('gps-accuracy')).toHaveText('GPS ±10 m');
  await expect(page.getByTestId('route-attribution')).toContainText('OSRM');
  if (drive.routes.length > 1) {
    await page.getByTestId('route-option').nth(1).click();
    await expect(page.getByTestId('route-option').nth(1)).toHaveAttribute('aria-checked', 'true');
  }
  await page.getByTestId('toggle-steps').click();
    await expect(page.getByTestId('steps-main').locator('li')).toHaveCount(drive.routes[0].legs[0].steps.length);
  await page.getByTestId('mode-walk').click();
  await expect(page.getByTestId('route-to')).toHaveText('Dreese Laboratories');
  await expect(page.getByTestId('route-traffic').first()).toContainText('Walking');
  await expect(page.getByTestId('garage-leg')).toHaveCount(0);
  const walk = JSON.parse(WALK_DIRECT);
  await expect(page.getByTestId('route-option')).toHaveCount(walk.routes.length);
  await page.getByTestId('route-option').nth(1).click();
  await expect(page.getByTestId('route-option').nth(1)).toHaveAttribute('aria-checked', 'true');
});

test('routing failures: unreachable and no-route both explain, offer retry and show no route', async ({ page, context }) => {
  await located(context);
  const r = await routing(page, 'fail');
  await open(page);
  await toRoute(page);
  await expect(page.getByTestId('routes-error')).toContainText("Can't reach the directions service", { timeout: 10_000 });
  await expect(page.getByTestId('route-option')).toHaveCount(0);
  await expect(page.getByTestId('start-nav')).toBeDisabled();
  r.drive = 'noroute';
  await page.getByTestId('routes-retry').click();
  await expect(page.getByTestId('routes-error')).toContainText('No route found');
  r.drive = 'ok';
  await page.getByTestId('routes-retry').click();
  await expect(page.getByTestId('route-option').first()).toBeVisible();
});

test('full journey on real GPS updates: progress, off-route reroute, arrival at garage, walk, arrival', async ({ page, context }) => {
  await located(context);
  const r = await routing(page);
  await open(page);
  await toRoute(page);
  await expect(page.getByTestId('route-option').first()).toBeVisible();
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('navigate')).toHaveAttribute('data-phase', 'navigating');
  await expect(page.getByTestId('nav-instruction')).not.toBeEmpty();
  await expect(page.getByTestId('nav-parking')).toContainText('Simulated, not real availability');

  // Drive along the real route's own geometry.
  const route = JSON.parse(DRIVE).routes[0];
  const coords: [number, number][] = route.geometry.coordinates;
  const eta0 = await page.getByTestId('nav-remaining').textContent();
  const mid = coords[Math.floor(coords.length / 2)];
  await context.setGeolocation({ latitude: mid[1], longitude: mid[0], accuracy: 8 });
  await expect(page.getByTestId('nav-remaining')).not.toHaveText(eta0!, { timeout: 8000 });

  // Leave the route: three good fixes away from it.
  r.rerouted = true;
  const calls = r.driveCalls;
  for (const [i, lat] of [40.0062, 40.0061, 40.006].entries()) {
    await context.setGeolocation({ latitude: lat + 0.0035, longitude: -83.0242 - i * 0.0001, accuracy: 8 });
    await page.waitForTimeout(1200);
  }
  await expect(page.getByTestId('nav-reroutes')).toContainText('Rerouted 1', { timeout: 15_000 });
  expect(r.driveCalls).toBe(calls + 1);

  // Reach the garage entrance on the new route.
  const end = JSON.parse(REROUTE).routes[0].geometry.coordinates.at(-1);
  await context.setGeolocation({ latitude: end[1], longitude: end[0], accuracy: 8 });
  await page.waitForTimeout(1200);
  await context.setGeolocation({ latitude: end[1], longitude: end[0] + 0.00001, accuracy: 8 });
  await expect(page.getByTestId('at-garage')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('at-garage')).toContainText('Dreese Laboratories');
  await page.getByTestId('start-walk').click();
  await expect(page.getByTestId('navigate')).toHaveAttribute('data-phase', 'navigating');
  await expect(page.getByTestId('nav-parking')).toHaveCount(0);

  const walkEnd = JSON.parse(WALK).routes[0].geometry.coordinates.at(-1);
  await context.setGeolocation({ latitude: walkEnd[1], longitude: walkEnd[0], accuracy: 8 });
  await page.waitForTimeout(1200);
  await context.setGeolocation({ latitude: walkEnd[1], longitude: walkEnd[0] + 0.00001, accuracy: 8 });
  await expect(page.getByTestId('arrived')).toContainText('Dreese Laboratories', { timeout: 10_000 });
  await page.getByTestId('nav-done').click();
  await expect(page.getByTestId('explore')).toBeVisible();
});

test('the map failing to load leaves search and garages working', async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await routing(page);
  await fetch(`${API}/__test/reset`, { method: 'POST' });
  await page.goto('/app/?splash=off');
  await expect(page.getByTestId('map-failed')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('all-garages').click();
  await expect(page.getByTestId('garage-row-osu-arps')).toBeVisible();
});

// Every piece of visible text against the solid colour behind it. WCAG's 3:1 is the floor for this check.
const lowContrast = (page: Page) => page.evaluate(() => {
  const rgb = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bad: string[] = [];
  const walker = document.createTreeWalker(document.querySelector('.app')!, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent!.trim(), el = walker.currentNode.parentElement!;
    if (!text || !el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) || el.closest('.mstage, [aria-hidden=true]') || el.closest('[disabled], .tabs [aria-selected=true]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.top > innerHeight || r.bottom < 0) continue;
    let node: HTMLElement | null = el, back = null;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== 'none') { back = 'gradient'; break; }
      const c = rgb(cs.backgroundColor);
      if (c.a > 0.5) { back = c; break; }
      node = node.parentElement;
    }
    if (!back || back === 'gradient') continue;
    const a = lum(rgb(getComputedStyle(el).color)), b = lum(back as { r: number; g: number; b: number });
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) bad.push(`${text.slice(0, 30)} (${ratio.toFixed(1)})`);
  }
  return bad;
});

test('dark mode: text stays readable on every screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('parkright.prefs.v1', JSON.stringify({ mapTheme: 'dark' })));
  await routing(page);
  await open(page);
  await expect(page.getByTestId('all-garages')).toBeVisible();
  expect(await lowContrast(page), 'home').toEqual([]);
  await page.getByTestId('tab-you').click();
  await expect(page.getByTestId('you')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await lowContrast(page), 'you').toEqual([]);
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('plan')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await lowContrast(page), 'plan').toEqual([]);
  await page.getByTestId('tab-explore').click();
  await page.getByTestId('all-garages').click();
  await page.waitForTimeout(500);
  expect(await lowContrast(page), 'list').toEqual([]);
  await page.getByTestId('garage-row-ohio-union-sim').getByRole('button').first().click();
  await page.waitForTimeout(500);
  expect(await lowContrast(page), 'garage').toEqual([]);
  await page.getByTestId('choose-space').click();
  await page.waitForTimeout(600);
  expect(await lowContrast(page), 'spaces').toEqual([]);
});

// ---- Regression: Ohio Union to Ohio Union North Garage, then on foot to Ohio Stadium. Responses recorded from the real service.
const UN = (n: string) => load(`union-north/${n}`);
async function unionNorth(page: Page) {
  const seen: string[] = [];
  await page.route('**/__routing/**', (r) => {
    const url = r.request().url();
    seen.push(url);
    if (url.includes('routed-foot')) return r.fulfill({ contentType: 'application/json', body: UN('walk') });
    // The end coordinate picks the recording: the east entrance is -83.008447, the west -83.009425.
    return r.fulfill({ contentType: 'application/json', body: UN(url.includes('-83.008447,39.999052') ? 'drive-east' : 'drive-west') });
  });
  return seen;
}
const toUnionNorth = async (page: Page) => {
  await search(page, 'ohio stadium');
  await page.getByTestId('all-garages').click();
  await page.getByTestId('garage-row-ohio-union-sim').getByRole('button').first().click();
  await page.getByTestId('route-to-garage').click();
  await expect(page.getByTestId('route-panel')).toBeVisible();
};
const mapRoutes = (page: Page) => page.evaluate(() => (window as unknown as { __meridianRoutes: { id: string; role: string; coords: number[][] }[] }).__meridianRoutes);

test('Union North regression: picks the near entrance, not a lap around the garage', async ({ page }) => {
  const seen = await unionNorth(page);
  await open(page);
  await toUnionNorth(page);
  await page.getByTestId('origin-select').selectOption('Ohio Union');
  await expect(page.getByTestId('route-option').first()).toBeVisible();
  // Both inbound entrances were asked for, and the fast one won.
  expect(seen.some((u) => u.includes('routed-car') && u.includes('-83.008447,39.999052'))).toBe(true);
  expect(seen.some((u) => u.includes('routed-car') && u.includes('-83.009425,39.998734'))).toBe(true);
  const west = JSON.parse(UN('drive-west')).routes[0], east = JSON.parse(UN('drive-east')).routes[0];
  expect(west.duration).toBeLessThan(east.duration);
  await expect(page.getByTestId('route-time').first()).toHaveText(`${Math.max(1, Math.round(west.duration / 60))} min`);
  await expect(page.getByTestId('drive-end')).toContainText('west vehicle entrance');
  await expect(page.getByTestId('drive-end')).toContainText('not checked on site');
  await expect(page.getByTestId('mark-entrance')).toBeAttached();
});

test('Union North regression: the walk is the routed path from a pedestrian door, never a straight line', async ({ page }) => {
  await unionNorth(page);
  await open(page);
  await toUnionNorth(page);
  await page.getByTestId('origin-select').selectOption('Ohio Union');
  await expect(page.getByTestId('walk-leg')).toBeVisible();
  await expect(page.getByTestId('walk-start')).toContainText('pedestrian door');
  await expect(page.getByTestId('walk-end')).toContainText('Ohio Stadium');
  await expect(page.getByTestId('mark-exit')).toBeAttached();
  const walk = JSON.parse(UN('walk')).routes[0];
  await expect.poll(async () => (await mapRoutes(page)).find((r) => r.role === 'walk')?.coords.length).toBe(walk.geometry.coordinates.length);
  const drawn = (await mapRoutes(page)).find((r) => r.role === 'walk')!;
  expect(drawn.coords).toEqual(walk.geometry.coordinates);
  expect(drawn.coords.length).toBeGreaterThan(10);
});

test('Union North regression: a manual start never unlocks guidance, and switching to GPS does', async ({ page, context }) => {
  await located(context);
  await unionNorth(page);
  await open(page);
  await toUnionNorth(page);
  await expect(page.getByTestId('start-nav')).toBeEnabled();
  await page.getByTestId('origin-select').selectOption('Ohio Union');
  await expect(page.getByTestId('start-bar')).toHaveAttribute('data-gate', 'manual');
  await expect(page.getByTestId('start-nav')).toBeDisabled();
  await expect(page.getByTestId('start-reason')).toContainText('This route starts at Ohio Union');
  await page.getByTestId('start-action').click();
  await expect(page.getByTestId('start-nav')).toBeEnabled();
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('navigate')).toHaveAttribute('data-phase', 'navigating');
});

test('inaccurate GPS blocks starting and says by how much', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...START, accuracy: 2500 });
  await routing(page);
  await open(page);
  await toRoute(page);
  await expect(page.getByTestId('route-option').first()).toBeVisible();
  await expect(page.getByTestId('start-bar')).toHaveAttribute('data-gate', 'inaccurate');
  await expect(page.getByTestId('start-reason')).toContainText('2500 m');
  await expect(page.getByTestId('start-nav')).toBeDisabled();
});

for (const [name, size] of [['small phone', { width: 320, height: 568 }], ['large phone', { width: 430, height: 932 }], ['desktop', { width: 1440, height: 900 }]] as const) {
  test(`route preview fits on ${name}`, async ({ page, context }) => {
    await page.setViewportSize(size);
    await located(context);
    await routing(page);
    await open(page);
    await toRoute(page);
    await expect(page.getByTestId('route-option').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const box = await page.getByTestId('start-nav').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
}
