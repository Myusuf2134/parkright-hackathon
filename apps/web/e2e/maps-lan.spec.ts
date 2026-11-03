/**
 * The launch path a phone uses, and the Ohio Union North to Ohio Stadium geography, against the live directions
 * service. Location here is the browser's emulated geolocation: this proves the app's logic over HTTPS, not an
 * iPhone's GPS, and the certificate error is bypassed by the test browser.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const campus = JSON.parse(readFileSync(fileURLToPath(new URL('../src/driver/maps/campus/osu.json', import.meta.url)), 'utf8'));
const north = campus.garages.find((g: { id: string }) => g.id === 'osu-union-north');
const stadium = campus.buildings.find((b: { short: string }) => b.short === 'Stadium');
const union = campus.buildings.find((b: { name: string }) => b.name === 'Ohio Union');
type P = { lat: number; lng: number };
const metres = (a: P, b: P) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
const ll = ([lng, lat]: number[]): P => ({ lat, lng });
const inside = (p: P, ring: number[][]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
async function osrm(service: string, profile: string, a: P, b: P) {
  const res = await fetch(`https://routing.openstreetmap.de/${service}/route/v1/${profile}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`);
  expect(res.ok, 'the live directions service answered').toBe(true);
  const body = await res.json();
  expect(body.code).toBe('Ok');
  await new Promise((r) => setTimeout(r, 1500));
  return body;
}

test('the stored garage data matches the footprint and the direction of traffic', () => {
  const ring: number[][] = north.footprint;
  const nearRing = (p: P) => Math.min(...ring.map((q) => metres(p, ll(q))));
  expect(north.entrances.map((e: { osmNode: number; side: string }) => [e.osmNode, e.side]).sort()).toEqual([[332471337, 'east'], [4424562779, 'west']]);
  for (const e of north.entrances) { expect(e.kind).toBe('inbound'); expect(nearRing(e)).toBeLessThan(3); }
  expect(north.pedestrianDoors.length).toBe(4);
  for (const d of north.pedestrianDoors) expect(nearRing(d)).toBeLessThan(3);
  expect(metres(stadium, north)).toBeGreaterThan(800);
});

test('live routing: the near entrance wins and the drive is no lap around the garage', async () => {
  const [east, west] = await Promise.all(['east', 'west'].map((side) => osrm('routed-car', 'driving', union, north.entrances.find((e: { side: string }) => e.side === side))));
  const w = west.routes[0], e = east.routes[0];
  console.log(`Ohio Union to west entrance ${Math.round(w.distance)} m ${Math.round(w.duration)} s via ${w.legs[0].summary}; east ${Math.round(e.distance)} m ${Math.round(e.duration)} s via ${e.legs[0].summary}; route stops ${Math.round(west.waypoints[1].distance)} m from the west entrance`);
  expect(w.duration).toBeLessThan(e.duration);
  expect(w.distance).toBeLessThan(e.distance / 2);
  const entrance = north.entrances.find((x: { side: string }) => x.side === 'west');
  expect(west.waypoints[1].distance).toBeLessThan(60);
  expect(metres(ll(w.geometry.coordinates.at(-1)), entrance)).toBeLessThan(60);
  // A car route stays on roads: no point of it inside the garage's outline.
  expect(w.geometry.coordinates.filter((c: number[]) => inside(ll(c), north.footprint))).toEqual([]);
});

test('live routing: the walk starts at a pedestrian door, follows paths, and reaches a stadium door', async () => {
  const door = [...north.pedestrianDoors].sort((a: P, b: P) => metres(a, stadium) - metres(b, stadium))[0];
  const gate = [...stadium.doors].sort((a: P, b: P) => metres(a, door) - metres(b, door))[0];
  const body = await osrm('routed-foot', 'foot', door, gate);
  const r = body.routes[0], coords: number[][] = r.geometry.coordinates;
  const straight = metres(door, gate);
  const longest = Math.max(...coords.slice(1).map((c, i) => metres(ll(c), ll(coords[i]))));
  console.log(`Walk: door ${door.osmNode} (${door.side}) to stadium door ${gate.osmNode}: ${Math.round(r.distance)} m, ${Math.round(r.duration)} s, ${coords.length} points, straight line ${Math.round(straight)} m, longest segment ${Math.round(longest)} m, gaps ${Math.round(body.waypoints[0].distance)} and ${Math.round(body.waypoints[1].distance)} m`);
  expect(body.waypoints[0].distance).toBeLessThan(10);
  expect(body.waypoints[1].distance).toBeLessThan(25);
  expect(coords.length).toBeGreaterThan(20);
  expect(r.distance).toBeGreaterThan(straight);
  expect(r.distance).toBeLessThan(straight * 1.6);
  expect(longest).toBeLessThan(straight / 3); // not one straight line across campus
});

const toRoute = async (page: Page, base: string) => {
  await page.goto(`${base}/app/?splash=off`);
  await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'yes', { timeout: 30_000 });
  await page.getByTestId('search').getByRole('button').first().click();
  await page.getByTestId('search-input').fill('ohio stadium');
  await page.getByTestId('search-input').press('Enter');
  await page.getByTestId('all-garages').click();
  await page.getByTestId('garage-row-ohio-union-sim').getByRole('button').first().click();
  await page.getByTestId('route-to-garage').click();
};

test('over HTTPS with a good location, Start Driving enables and starts', async ({ page, context }, info) => {
  await new Promise((r) => setTimeout(r, 15_000));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39.9968, longitude: -83.0086, accuracy: 12 });
  const base = info.project.metadata.https;
  await toRoute(page, base);
  expect(await page.evaluate(() => [location.protocol, isSecureContext])).toEqual(['https:', true]);
  await expect(page.getByTestId('route-option').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('start-bar')).toHaveAttribute('data-gate', 'ok');
  await expect(page.getByTestId('start-nav')).toBeEnabled();
  await expect(page.getByTestId('gps-accuracy')).toHaveText('GPS ±12 m');
  await expect(page.getByTestId('drive-end')).toContainText('vehicle entrance');
  await expect(page.locator('[data-live=live]')).toBeAttached({ timeout: 15_000 }); // WebSocket works over HTTPS too
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('navigate')).toHaveAttribute('data-phase', 'navigating');
});

test('over plain HTTP, Start stays off, says why, and the preview still works', async ({ page }, info) => {
  await new Promise((r) => setTimeout(r, 15_000));
  await toRoute(page, info.project.metadata.http);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await page.getByTestId('origin-select').selectOption('Ohio Union');
  await expect(page.getByTestId('route-option').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('start-bar')).toHaveAttribute('data-gate', 'insecure');
  await expect(page.getByTestId('start-reason')).toContainText('Location needs HTTPS');
  await expect(page.getByTestId('start-nav')).toBeDisabled();
});
