# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reliability.spec.ts >> demo run 3/5
- Location: scripts/demo/reliability.spec.ts:25:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 6

- Array []
+ Array [
+   "sim: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
+   "sim: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
+   "sim: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
+   "sim: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: ◩
      - generic [ref=e7]:
        - heading "PARKRIGHT VISION LAB" [level=1] [ref=e8]
        - paragraph [ref=e9]: Virtual infrastructure camera · garage-01 · Level L1 · 12 bays
    - generic [ref=e10]:
      - generic [ref=e11]: DEMO MODE · FIXED SCENE
      - generic [ref=e13]: API CONNECTED
      - generic [ref=e15]:
        - text: PERCEPTION
        - generic [ref=e16]: a2-fasterrcnn@1-5f91c1eb70450307c6eed130ce113dd8
      - generic [ref=e17]: EVALUATION OFF
  - main [ref=e18]:
    - generic [ref=e19]:
      - generic [ref=e20]:
        - generic:
          - button "A1" [ref=e24] [cursor=pointer]
          - button "A2" [ref=e25] [cursor=pointer]
          - button "A3" [ref=e26] [cursor=pointer]
          - button "A4" [ref=e27] [cursor=pointer]
          - button "A5" [ref=e28] [cursor=pointer]
          - button "A6" [ref=e29] [cursor=pointer]
          - button "B1" [ref=e30] [cursor=pointer]
          - button "B2" [ref=e31] [cursor=pointer]
          - button "B3" [ref=e32] [cursor=pointer]
          - button "B4" [ref=e33] [cursor=pointer]
          - button "B5" [ref=e34] [cursor=pointer]
          - button "B6" [ref=e35] [cursor=pointer]
        - generic: OPERATOR VIEW · overlays never reach cam-01
        - generic [ref=e36]:
          - generic [ref=e37] [cursor=pointer]: Space IDs
          - generic [ref=e38] [cursor=pointer]: Bay outlines
          - generic [ref=e39] [cursor=pointer]: Ground truth
          - generic [ref=e40] [cursor=pointer]: cam-01 frustum
          - generic [ref=e41] [cursor=pointer]: FPS
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "FRAME LOG" [level=2] [ref=e44]
          - generic [ref=e45]:
            - text: POST /api/v1/cameras/cam-01/frames · last 5
            - generic [ref=e46]: accepted 1
            - generic [ref=e47]: error 4
            - generic [ref=e48]: skipped ticks 16
        - table [ref=e49]:
          - rowgroup [ref=e50]:
            - row [ref=e51]:
              - columnheader "SEQ" [ref=e52]
              - columnheader "SIM TIME" [ref=e53]
              - columnheader "CAPTURED" [ref=e54]
              - columnheader "JPEG" [ref=e55]
              - columnheader "RESULT" [ref=e56]
              - columnheader "LATENCY" [ref=e57]
              - columnheader "GROUND TRUTH" [ref=e58]
              - columnheader "DETAIL" [ref=e59]
          - rowgroup [ref=e60]:
            - row [ref=e61]:
              - cell "4" [ref=e62]
              - cell "0.00 s" [ref=e63]
              - cell "13:07:16.383" [ref=e64]
              - cell "126 KB" [ref=e65]
              - cell "accepted 202" [ref=e66]:
                - text: accepted
                - generic [ref=e67]: "202"
              - cell "4455 ms" [ref=e68]
              - cell "off" [ref=e69]
              - cell "first frame from this camera" [ref=e70]
            - row [ref=e71]:
              - cell "3" [ref=e72]
              - cell "0.00 s" [ref=e73]
              - cell "13:07:15.383" [ref=e74]
              - cell "126 KB" [ref=e75]
              - cell "error 503" [ref=e76]:
                - text: error
                - generic [ref=e77]: "503"
              - cell "31 ms" [ref=e78]
              - cell "off" [ref=e79]
              - cell "Perception did not answer within 10.0 s; frame not recorded, safe to retry (perception_timeout)" [ref=e80]
            - row [ref=e81]:
              - cell "2" [ref=e82]
              - cell "0.00 s" [ref=e83]
              - cell "13:07:14.385" [ref=e84]
              - cell "126 KB" [ref=e85]
              - cell "error 503" [ref=e86]:
                - text: error
                - generic [ref=e87]: "503"
              - cell "11 ms" [ref=e88]
              - cell "off" [ref=e89]
              - cell "Perception did not answer within 10.0 s; frame not recorded, safe to retry (perception_timeout)" [ref=e90]
            - row [ref=e91]:
              - cell "1" [ref=e92]
              - cell "0.00 s" [ref=e93]
              - cell "13:07:13.432" [ref=e94]
              - cell "126 KB" [ref=e95]
              - cell "error 503" [ref=e96]:
                - text: error
                - generic [ref=e97]: "503"
              - cell "86 ms" [ref=e98]
              - cell "off" [ref=e99]
              - cell "Perception did not answer within 10.0 s; frame not recorded, safe to retry (perception_timeout)" [ref=e100]
            - row [ref=e101]:
              - cell "0" [ref=e102]
              - cell "0.00 s" [ref=e103]
              - cell "13:07:02.399" [ref=e104]
              - cell "126 KB" [ref=e105]
              - cell "error 503" [ref=e106]:
                - text: error
                - generic [ref=e107]: "503"
              - cell "10131 ms" [ref=e108]
              - cell "off" [ref=e109]
              - cell "Perception did not answer within 10.0 s; frame not recorded, safe to retry (perception_timeout)" [ref=e110]
    - complementary [ref=e111]:
      - generic [ref=e112]:
        - generic [ref=e113]:
          - heading "CAMERA FEED" [level=2] [ref=e114]
          - generic [ref=e115]: ● STREAMING 1 FPS
        - generic [ref=e116]:
          - generic:
            - generic: cam-01
            - generic: 1280×720 · JPEG
        - paragraph [ref=e118]: Live cam-01 render. Frames are JPEG-encoded from exactly these pixels — no overlays, no labels.
        - generic [ref=e119]:
          - generic [ref=e120]:
            - generic [ref=e121]: SESSION
            - generic [ref=e122]: sim-20261023-130651-7b02
          - generic [ref=e123]:
            - generic [ref=e124]: NEXT SEQ
            - generic [ref=e125]: "6"
          - generic [ref=e126]:
            - generic [ref=e127]: SIM TIME
            - generic [ref=e128]: 00:00.000
          - generic [ref=e129]:
            - generic [ref=e130]: LAST RESULT
            - generic [ref=e131]: accepted
        - generic [ref=e133]:
          - group "Stream rate" [ref=e134]:
            - button "OFF" [ref=e135] [cursor=pointer]
            - button "1 FPS" [ref=e136] [cursor=pointer]
            - button "2 FPS" [ref=e137] [cursor=pointer]
            - button "5 FPS" [ref=e138] [cursor=pointer]
          - button "Capture & send" [disabled] [ref=e139]
        - generic [ref=e140]:
          - generic [ref=e141] [cursor=pointer]:
            - checkbox "Send ground truth to evaluation (separate request)" [checked] [ref=e142]
            - text: Send ground truth to evaluation (separate request)
          - button "New session" [ref=e143] [cursor=pointer]
      - generic [ref=e144]:
        - generic [ref=e145]:
          - heading "INFERENCE DIAGNOSTICS" [level=2] [ref=e146]
          - generic [ref=e147]: PIXELS ONLY
        - paragraph [ref=e148]: ready · not ready
        - paragraph [ref=e149]: a2-fasterrcnn@1-5f91c1eb70450307c6eed130ce113dd8
        - paragraph [ref=e150]: "Calibration: cam-01-fixed-v1"
        - paragraph [ref=e151]: "Last frame: 2026-10-23T13:07:16.383000+00:00Last inference: 2026-10-23T13:07:20.875481+00:00"
        - paragraph [ref=e152]: 4 detections · 8 uncertain spaces · 4407.2 ms
        - img "Debug copy with calibration and detections" [ref=e153]:
          - generic [ref=e155]: A1
          - generic [ref=e158]: A2
          - generic [ref=e161]: A3
          - generic [ref=e164]: A4
          - generic [ref=e167]: A5
          - generic [ref=e170]: A6
          - generic [ref=e173]: B1
          - generic [ref=e176]: B2
          - generic [ref=e179]: B3
          - generic [ref=e182]: B4
          - generic [ref=e185]: B5
          - generic [ref=e188]: B6
          - generic [ref=e191]: car 1.00
          - generic [ref=e194]: car 1.00
          - generic [ref=e197]: car 1.00
          - generic [ref=e200]: truck 1.00
        - paragraph [ref=e203]: Debug copy only. Outlines and labels are never uploaded.
        - button "Export evaluation dataset (1 frames)" [ref=e204] [cursor=pointer]
        - paragraph [ref=e205]: "Evaluation export includes separate ground truth. Maximum 200 frames; omitted: 0."
      - generic [ref=e206]:
        - generic [ref=e207]:
          - heading "SIMULATION" [level=2] [ref=e208]
          - generic [ref=e209]: ❚❚ PAUSED
        - generic [ref=e211]:
          - button "▶ Play" [ref=e212] [cursor=pointer]
          - button "❚❚ Pause" [ref=e213] [cursor=pointer]
          - button "⏭ Step" [ref=e214] [cursor=pointer]
          - button "↺ Reset" [ref=e215] [cursor=pointer]
        - generic [ref=e216]:
          - generic [ref=e217]: SPEED
          - generic [ref=e218]:
            - button "0.5×" [ref=e219] [cursor=pointer]
            - button "1×" [ref=e220] [cursor=pointer]
            - button "2×" [ref=e221] [cursor=pointer]
            - button "4×" [ref=e222] [cursor=pointer]
          - generic [ref=e223] [cursor=pointer]:
            - checkbox "Seeded traffic" [ref=e224]
            - text: Seeded traffic
        - generic [ref=e225]:
          - generic [ref=e226]: SEED
          - textbox [ref=e227]: "4242"
          - button "Apply" [ref=e228] [cursor=pointer]
          - button "New" [ref=e229] [cursor=pointer]
          - button "Copy scene link" [ref=e230] [cursor=pointer]
        - generic [ref=e231]:
          - generic [ref=e232]: ENVIRONMENT
          - generic [ref=e233]:
            - button "Clear Day" [ref=e234] [cursor=pointer]
            - button "Overcast" [ref=e235] [cursor=pointer]
            - button "Dusk" [ref=e236] [cursor=pointer]
            - button "Night" [ref=e237] [cursor=pointer]
        - paragraph [ref=e238]: Rain, fog, snow, glare, lens dirt, occlusion and exposure presets plug in via src/scene/effects.ts (not yet enabled).
      - generic [ref=e239]:
        - generic [ref=e240]:
          - heading "OCCUPANCY" [level=2] [ref=e241]
          - generic [ref=e242]: 4/12 vehicles placed
        - generic [ref=e243]:
          - button "A1 pickup" [ref=e244] [cursor=pointer]:
            - generic [ref=e245]: A1
            - generic [ref=e247]: pickup
          - button "A2 empty" [ref=e248] [cursor=pointer]:
            - generic [ref=e249]: A2
            - generic [ref=e250]: empty
          - button "A3 suv" [ref=e251] [cursor=pointer]:
            - generic [ref=e252]: A3
            - generic [ref=e254]: suv
          - button "A4 empty" [ref=e255] [cursor=pointer]:
            - generic [ref=e256]: A4
            - generic [ref=e257]: empty
          - button "A5 empty" [ref=e258] [cursor=pointer]:
            - generic [ref=e259]: A5
            - generic [ref=e260]: empty
          - button "A6 empty" [ref=e261] [cursor=pointer]:
            - generic [ref=e262]: A6
            - generic [ref=e263]: empty
          - button "B1 empty" [ref=e264] [cursor=pointer]:
            - generic [ref=e265]: B1
            - generic [ref=e266]: empty
          - button "B2 sedan" [ref=e267] [cursor=pointer]:
            - generic [ref=e268]: B2
            - generic [ref=e270]: sedan
          - button "B3 empty" [ref=e271] [cursor=pointer]:
            - generic [ref=e272]: B3
            - generic [ref=e273]: empty
          - button "B4 empty" [ref=e274] [cursor=pointer]:
            - generic [ref=e275]: B4
            - generic [ref=e276]: empty
          - button "B5 hatchback" [ref=e277] [cursor=pointer]:
            - generic [ref=e278]: B5
            - generic [ref=e280]: hatchback
          - button "B6 empty" [ref=e281] [cursor=pointer]:
            - generic [ref=e282]: B6
            - generic [ref=e283]: empty
        - generic [ref=e284]:
          - generic [ref=e285]: SELECT A BAY
          - button "Park vehicle" [disabled] [ref=e286]
          - button "Remove" [disabled] [ref=e287]
        - generic [ref=e288]:
          - button "Randomize" [ref=e289] [cursor=pointer]
          - button "Fill all" [ref=e290] [cursor=pointer]
          - button "Clear all" [ref=e291] [cursor=pointer]
        - paragraph [ref=e292]: Double-click a bay to park or remove. While playing, vehicles drive in and out; while paused, changes are instant.
      - generic [ref=e293]:
        - generic [ref=e294]:
          - heading "GROUND TRUTH" [level=2] [ref=e295]
          - generic [ref=e296]: EVALUATION ONLY
        - paragraph [ref=e297]: SIMULATOR GROUND TRUTH — NOT PROVIDED TO PERCEPTION
        - table [ref=e298]:
          - rowgroup [ref=e299]:
            - row [ref=e300]:
              - columnheader "BAY" [ref=e301]
              - columnheader "SIMULATOR TRUTH" [ref=e302]
              - columnheader "BACKEND (DRIVERS SEE)" [ref=e303]
          - rowgroup [ref=e304]:
            - row [ref=e305]:
              - cell "A1" [ref=e306]
              - cell "occupied" [ref=e307]
              - cell "OCCUPIED" [ref=e308]
            - row [ref=e309]:
              - cell "A2" [ref=e310]
              - cell "empty" [ref=e311]
              - cell "UNCERTAIN" [ref=e312]
            - row [ref=e313]:
              - cell "A3" [ref=e314]
              - cell "occupied" [ref=e315]
              - cell "OCCUPIED" [ref=e316]
            - row [ref=e317]:
              - cell "A4" [ref=e318]
              - cell "empty" [ref=e319]
              - cell "UNCERTAIN" [ref=e320]
            - row [ref=e321]:
              - cell "A5" [ref=e322]
              - cell "empty" [ref=e323]
              - cell "UNCERTAIN" [ref=e324]
            - row [ref=e325]:
              - cell "A6" [ref=e326]
              - cell "empty" [ref=e327]
              - cell "UNCERTAIN" [ref=e328]
            - row [ref=e329]:
              - cell "B1" [ref=e330]
              - cell "empty" [ref=e331]
              - cell "UNCERTAIN" [ref=e332]
            - row [ref=e333]:
              - cell "B2" [ref=e334]
              - cell "occupied" [ref=e335]
              - cell "OCCUPIED" [ref=e336]
            - row [ref=e337]:
              - cell "B3" [ref=e338]
              - cell "empty" [ref=e339]
              - cell "UNCERTAIN" [ref=e340]
            - row [ref=e341]:
              - cell "B4" [ref=e342]
              - cell "empty" [ref=e343]
              - cell "UNCERTAIN" [ref=e344]
            - row [ref=e345]:
              - cell "B5" [ref=e346]
              - cell "occupied" [ref=e347]
              - cell "OCCUPIED" [ref=e348]
            - row [ref=e349]:
              - cell "B6" [ref=e350]
              - cell "empty" [ref=e351]
              - cell "UNCERTAIN" [ref=e352]
        - paragraph [ref=e353]: "Last ground-truth post: off. Backend perception: a2-fasterrcnn@1-5f91c1eb70450307c6eed130ce113dd8"
      - generic [ref=e354]:
        - generic [ref=e355]:
          - heading "CAM-01 MOUNT" [level=2] [ref=e356]
          - generic [ref=e357]: fixed infrastructure camera
        - paragraph [ref=e358]: Calibrated inference locks this mount. Restore the default pose if a scene link changed it.
        - group [ref=e359]:
          - generic [ref=e360]:
            - generic [ref=e361]: X
            - slider "X 10.0" [disabled] [ref=e362]: "10"
            - generic [ref=e363]: "10.0"
          - generic [ref=e364]:
            - generic [ref=e365]: HEIGHT
            - slider "HEIGHT 10.5" [disabled] [ref=e366]: "10.5"
            - generic [ref=e367]: "10.5"
          - generic [ref=e368]:
            - generic [ref=e369]: Z
            - slider "Z 25.5" [disabled] [ref=e370]: "25.5"
            - generic [ref=e371]: "25.5"
          - generic [ref=e372]:
            - generic [ref=e373]: YAW °
            - slider "YAW ° 0.0" [disabled] [ref=e374]: "0"
            - generic [ref=e375]: "0.0"
          - generic [ref=e376]:
            - generic [ref=e377]: PITCH °
            - slider "PITCH ° -33.0" [disabled] [ref=e378]: "-33"
            - generic [ref=e379]: "-33.0"
          - generic [ref=e380]:
            - generic [ref=e381]: ROLL °
            - slider "ROLL ° 0.0" [disabled] [ref=e382]: "0"
            - generic [ref=e383]: "0.0"
          - generic [ref=e384]:
            - generic [ref=e385]: FOV °
            - slider "FOV ° 52.0" [disabled] [ref=e386]: "52"
            - generic [ref=e387]: "52.0"
          - generic [ref=e388]:
            - generic [ref=e389]: RESOLUTION
            - combobox [disabled] [ref=e390]:
              - option "640×360" [disabled]
              - option "960×540" [disabled]
              - option "1280×720" [disabled] [selected]
              - option "1920×1080" [disabled]
        - button "Default mount" [ref=e392] [cursor=pointer]
```

# Test source

```ts
  2   |  * End-to-end reliability of the hackathon demo, run N times in a row against the running
  3   |  * stack (npm run demo:hackathon). Each run: reset → simulator (?demo=1) streams the fixed
  4   |  * scene through real A2 → WebSocket → driver demo screen → recommendation → exact result.
  5   |  *
  6   |  *   PARKRIGHT_DEMO_RUNS=5 npx playwright test -c scripts/demo/playwright.config.ts
  7   |  */
  8   | import { expect, test } from '@playwright/test';
  9   | import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  10  | import { resolve } from 'node:path';
  11  | 
  12  | const root = resolve(import.meta.dirname, '../..');
  13  | const API = 'http://127.0.0.1:8400';
  14  | const SIM = 'http://127.0.0.1:5181';
  15  | const WEB = 'http://127.0.0.1:5180';
  16  | const fixture = JSON.parse(readFileSync(resolve(root, 'packages/shared/fixtures/hackathon-demo.json'), 'utf8'));
  17  | const RUNS = Number(process.env.PARKRIGHT_DEMO_RUNS ?? 5);
  18  | const OUT = resolve(root, 'experiments/hackathon-demo/runs');
  19  | const summary: Record<string, unknown>[] = [];
  20  | let firstPresentation: string | null = null;
  21  | 
  22  | test.describe.configure({ mode: 'serial' });
  23  | 
  24  | for (let run = 1; run <= RUNS; run++) {
  25  |   test(`demo run ${run}/${RUNS}`, async ({ browser, request }) => {
  26  |     const started = Date.now();
  27  |     const errors: string[] = [];
  28  | 
  29  |     // Fresh take: reset the API, then open both windows from scratch.
  30  |     const reset = await request.post(`${API}/api/v1/demo/reset`);
  31  |     expect(reset.status()).toBe(200);
  32  |     const epoch = (await reset.json()).epoch;
  33  |     const initial = await (await request.get(`${API}/api/v1/demo/status`)).json();
  34  |     expect(initial.epoch).toBe(epoch);
  35  |     expect(initial.frames_since_reset).toBe(0);
  36  |     expect(initial.camera.last_frame).toBeNull();
  37  |     expect(initial.camera.occupied).toEqual([]);
  38  |     expect(initial.perception.loaded).toBe(true);
  39  |     expect(initial.perception.allow_open).toBe(false);
  40  | 
  41  |     const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  42  |     const sim = await ctx.newPage();
  43  |     const driver = await ctx.newPage();
  44  |     for (const [name, page] of [['sim', sim], ['driver', driver]] as const) {
  45  |       page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  46  |       page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  47  |     }
  48  |     const failedApi: string[] = [];
  49  |     driver.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && failedApi.push(`${r.status()} ${r.url()}`));
  50  | 
  51  |     await sim.goto(`${SIM}/?demo=1#${fixture.simulator.hash}`);
  52  |     await sim.waitForSelector('body[data-lab-ready="1"]');
  53  |     await expect(sim.getByTestId('demo-badge')).toBeVisible();
  54  | 
  55  |     await driver.goto(`${WEB}/?record=1`);
  56  |     await expect(driver.getByTestId('demo-badge')).toBeVisible();
  57  |     await expect(driver.getByTestId('class-card')).toContainText(`${fixture.next_class.time} · ${fixture.next_class.destination}`);
  58  |     await expect(driver.locator('.demo')).toHaveAttribute('data-ws', 'live', { timeout: 15_000 });
  59  | 
  60  |     // Camera → A2 → bay states (live, via the WebSocket) reach the expected scene.
  61  |     const want = [...fixture.expected.camera_occupied_bays].sort();
  62  |     await expect
  63  |       .poll(async () => (await (await request.get(`${API}/api/v1/demo/status`)).json()).camera.occupied, { timeout: 60_000 })
  64  |       .toEqual(want);
  65  |     for (const bay of want) await expect(driver.locator(`.d-bays li.occupied[title^="${bay}:"]`)).toHaveCount(1, { timeout: 15_000 });
  66  |     await expect(driver.locator('.d-bays li.open')).toHaveCount(0);
  67  |     await expect(driver.getByTestId('detector-line')).toContainText('A2 detector ready');
  68  |     await expect(driver.getByTestId('detector-line')).toContainText('OPEN detection disabled');
  69  |     await expect(driver.locator('.d-frame img')).toBeVisible();
  70  | 
  71  |     // Recommendation.
  72  |     const button = driver.getByTestId('find-parking');
  73  |     await expect(button).toBeEnabled({ timeout: 30_000 });
  74  |     const replyPromise = driver.waitForResponse((r) => r.url().endsWith('/api/v1/demo/recommendation'));
  75  |     await button.click();
  76  |     const reply = await replyPromise;
  77  |     expect(reply.status()).toBe(200);
  78  |     const body = await reply.json();
  79  |     const p = body.presentation;
  80  |     expect(p).toMatchObject({
  81  |       recommended: true, facility_id: fixture.expected.facility_id, garage: fixture.expected.garage,
  82  |       level: fixture.expected.level, space_id: fixture.expected.space_id, walking_minutes: fixture.expected.walking_minutes,
  83  |       destination: fixture.next_class.destination, class_time: fixture.next_class.time, availability_simulated: true,
  84  |     });
  85  |     // Grounded: every fact the recommender saw is the fixture's (no camera ground truth, no invented values).
  86  |     expect(body.facts.facilities.map((f: { facility_id: string }) => f.facility_id)).toEqual(fixture.candidates.map((c: { facility_id: string }) => c.facility_id));
  87  |     expect(JSON.stringify(body.facts)).not.toMatch(/truth|nonce|seed|vehicle/i);
  88  | 
  89  |     await expect(driver.getByTestId('result-garage')).toHaveText(fixture.expected.garage);
  90  |     await expect(driver.getByTestId('result-space')).toHaveText(`${fixture.expected.level} · Space ${fixture.expected.space_id}`);
  91  |     await expect(driver.getByTestId('result-walk')).toHaveText(`${fixture.expected.walking_minutes}-minute walk to ${fixture.next_class.destination}`);
  92  |     await expect(driver.locator('.demo')).toHaveAttribute('data-step', '7');
  93  | 
  94  |     // Same answer every run.
  95  |     const presentation = JSON.stringify(p);
  96  |     if (firstPresentation === null) firstPresentation = presentation;
  97  |     expect(presentation).toBe(firstPresentation);
  98  | 
  99  |     const final = await (await request.get(`${API}/api/v1/demo/status`)).json();
  100 |     expect(final.epoch).toBe(epoch);
  101 |     expect(final.camera.open).toEqual([]);
> 102 |     expect(errors).toEqual([]);
      |                    ^ Error: expect(received).toEqual(expected) // deep equality
  103 |     expect(failedApi).toEqual([]);
  104 | 
  105 |     mkdirSync(OUT, { recursive: true });
  106 |     await driver.waitForTimeout(700); // let the result card finish its entrance before the screenshot
  107 |     await driver.screenshot({ path: `${OUT}/run-${run}-driver.png` });
  108 |     await sim.screenshot({ path: `${OUT}/run-${run}-simulator.png` });
  109 |     summary.push({
  110 |       run, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, epoch,
  111 |       frames: final.frames_since_reset, occupied: final.camera.occupied, source: p.source,
  112 |       result: `${p.garage} · ${p.level} · ${p.space_id} · ${p.walking_minutes} min`,
  113 |       recommendation_latency_ms: body.result.provenance.latency_ms, nemotron_mode: final.nemotron.mode,
  114 |     });
  115 |     writeFileSync(`${OUT}/reliability.json`, JSON.stringify({ runs: RUNS, completed: summary.length, summary }, null, 2));
  116 |     await ctx.close();
  117 |   });
  118 | }
  119 | 
```