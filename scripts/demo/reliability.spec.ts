/**
 * End-to-end reliability of the hackathon demo, run N times in a row against the running
 * stack (npm run demo:hackathon). Each run: reset → simulator (?demo=1) streams the fixed
 * scene through real A2 → WebSocket → driver demo screen → recommendation → exact result.
 *
 *   PARKRIGHT_DEMO_RUNS=5 npx playwright test -c scripts/demo/playwright.config.ts
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const API = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_API_PORT ?? 8400}`;
// PARKRIGHT_DEMO_SIM=garage runs the same checks against the 3D garage simulator.
const GARAGE = process.env.PARKRIGHT_DEMO_SIM === 'garage';
const SIM = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_SIM_PORT ?? 5181}`;
const WEB = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_WEB_PORT ?? 5180}`;
const fixture = JSON.parse(readFileSync(resolve(root, 'packages/shared/fixtures/hackathon-demo.json'), 'utf8'));
const RUNS = Number(process.env.PARKRIGHT_DEMO_RUNS ?? 5);
const OUT = resolve(root, 'experiments/hackathon-demo/runs');
const summary: Record<string, unknown>[] = [];
let firstPresentation: string | null = null;

test.describe.configure({ mode: 'serial' });

for (let run = 1; run <= RUNS; run++) {
  test(`demo run ${run}/${RUNS}`, async ({ browser, request }) => {
    const started = Date.now();
    const errors: string[] = [];

    // Fresh take: reset the API, then open both windows from scratch.
    const reset = await request.post(`${API}/api/v1/demo/reset`);
    expect(reset.status()).toBe(200);
    const epoch = (await reset.json()).epoch;
    const initial = await (await request.get(`${API}/api/v1/demo/status`)).json();
    expect(initial.epoch).toBe(epoch);
    expect(initial.frames_since_reset).toBe(0);
    expect(initial.camera.last_frame).toBeNull();
    expect(initial.camera.occupied).toEqual([]);
    expect(initial.perception.loaded).toBe(true);
    expect(initial.perception.allow_open).toBe(false);

    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const sim = await ctx.newPage();
    const driver = await ctx.newPage();
    for (const [name, page] of [['sim', sim], ['driver', driver]] as const) {
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    }
    const failedApi: string[] = [];
    driver.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && failedApi.push(`${r.status()} ${r.url()}`));

    await sim.goto(GARAGE ? `${SIM}/?demo=1&sim=garage` : `${SIM}/?demo=1#${fixture.simulator.hash}`);
    await sim.waitForSelector('body[data-lab-ready="1"]');
    await expect(sim.getByTestId('demo-badge')).toBeVisible();

    await driver.goto(`${WEB}/?record=1`);
    await expect(driver.getByTestId('demo-badge')).toBeVisible();
    await expect(driver.getByTestId('class-card')).toContainText(`${fixture.next_class.time} · ${fixture.next_class.destination}`);
    await expect(driver.locator('.demo')).toHaveAttribute('data-ws', 'live', { timeout: 15_000 });

    // Camera → A2 → bay states (live, via the WebSocket) reach the expected scene.
    const want = [...fixture.expected.camera_occupied_bays].sort();
    await expect
      .poll(async () => (await (await request.get(`${API}/api/v1/demo/status`)).json()).camera.occupied, { timeout: 60_000 })
      .toEqual(want);
    for (const bay of want) await expect(driver.locator(`.d-bays li.occupied[title^="${bay}:"]`)).toHaveCount(1, { timeout: 15_000 });
    await expect(driver.locator('.d-bays li.open')).toHaveCount(0);
    await expect(driver.getByTestId('detector-line')).toContainText('A2 detector ready');
    await expect(driver.getByTestId('detector-line')).toContainText('OPEN detection disabled');
    await expect(driver.locator('.d-frame img')).toBeVisible();

    // Recommendation.
    const button = driver.getByTestId('find-parking');
    await expect(button).toBeEnabled({ timeout: 30_000 });
    const replyPromise = driver.waitForResponse((r) => r.url().endsWith('/api/v1/demo/recommendation'));
    await button.click();
    const reply = await replyPromise;
    expect(reply.status()).toBe(200);
    const body = await reply.json();
    const p = body.presentation;
    expect(p).toMatchObject({
      recommended: true, facility_id: fixture.expected.facility_id, garage: fixture.expected.garage,
      level: fixture.expected.level, space_id: fixture.expected.space_id, walking_minutes: fixture.expected.walking_minutes,
      destination: fixture.next_class.destination, class_time: fixture.next_class.time, availability_simulated: true,
    });
    // Grounded: every fact the recommender saw is the fixture's (no camera ground truth, no invented values).
    expect(body.facts.facilities.map((f: { facility_id: string }) => f.facility_id)).toEqual(fixture.candidates.map((c: { facility_id: string }) => c.facility_id));
    expect(JSON.stringify(body.facts)).not.toMatch(/truth|nonce|seed|vehicle/i);

    await expect(driver.getByTestId('result-garage')).toHaveText(fixture.expected.garage);
    await expect(driver.getByTestId('result-space')).toHaveText(`${fixture.expected.level} · Space ${fixture.expected.space_id}`);
    await expect(driver.getByTestId('result-walk')).toHaveText(`${fixture.expected.walking_minutes}-minute walk to ${fixture.next_class.destination}`);
    await expect(driver.locator('.demo')).toHaveAttribute('data-step', '7');

    // Same answer every run.
    const presentation = JSON.stringify(p);
    if (firstPresentation === null) firstPresentation = presentation;
    expect(presentation).toBe(firstPresentation);

    const final = await (await request.get(`${API}/api/v1/demo/status`)).json();
    expect(final.epoch).toBe(epoch);
    expect(final.camera.open).toEqual([]);
    expect(errors).toEqual([]);
    expect(failedApi).toEqual([]);

    mkdirSync(OUT, { recursive: true });
    await driver.waitForTimeout(700); // let the result card finish its entrance before the screenshot
    await driver.screenshot({ path: `${OUT}/run-${run}-driver.png` });
    await sim.screenshot({ path: `${OUT}/run-${run}-simulator.png` });
    summary.push({
      run, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, epoch,
      frames: final.frames_since_reset, occupied: final.camera.occupied, source: p.source,
      result: `${p.garage} · ${p.level} · ${p.space_id} · ${p.walking_minutes} min`,
      recommendation_latency_ms: body.result.provenance.latency_ms, nemotron_mode: final.nemotron.mode,
    });
    writeFileSync(`${OUT}/reliability.json`, JSON.stringify({ runs: RUNS, completed: summary.length, summary }, null, 2));
    await ctx.close();
  });
}
