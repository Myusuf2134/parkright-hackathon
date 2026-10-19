#!/usr/bin/env node
// OFFLINE DATASET generator: renders the simulator dataset described by a config.
//
//   node scripts/dataset/generate.mjs [--config <file>] [--out <dir>] [--force] [--plan-only] [--print-out]
//
// Default output: $HOME/.cache/parkright/datasets/<dataset_version>/ (never /tmp).
// --plan-only writes only manifest.jsonl (no rendering); used for determinism checks.
// --print-out prints the resolved output directory and exits.
// Nothing here talks to the ParkRight API: frames and labels go to disk only.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SIM = join(ROOT, 'apps/simulator');
const DATASET_SCHEMA = 'parkright-dataset-v1';
const SAMPLE_SCHEMA = 'parkright-dataset-sample-v1';

function args() {
  const a = process.argv.slice(2);
  const opt = { config: join(ROOT, 'experiments/a2-dataset/configs/a2-sim-v1.json'), out: null, force: false, planOnly: false, printOut: false, port: 5297 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--config') opt.config = resolve(a[++i]);
    else if (a[i] === '--out') opt.out = resolve(a[++i]);
    else if (a[i] === '--force') opt.force = true;
    else if (a[i] === '--plan-only') opt.planOnly = true;
    else if (a[i] === '--print-out') opt.printOut = true;
    else if (a[i] === '--port') opt.port = Number(a[++i]);
    else throw new Error(`unknown argument ${a[i]}`);
  }
  return opt;
}

const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function sourceDigest() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  for (const d of ['sim', 'scene', 'camera', 'dataset']) walk(join(SIM, 'src', d));
  files.push(join(SIM, 'src/lab.ts'), join(ROOT, 'packages/shared/calibration/cam-01.json'), join(ROOT, 'packages/shared/fixtures/mvp-facility.json'));
  const h = createHash('sha256');
  for (const f of files) h.update(relative(ROOT, f)).update('\0').update(readFileSync(f)).update('\0');
  return h.digest('hex');
}

function git(...a) {
  try {
    return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function manifestRecord(version, s, d, frameIndex, info) {
  const occupied = d.spaces.filter((x) => x.truth === 'occupied').length;
  const base = `${s.split}/${s.sample_id}`;
  return {
    schema: SAMPLE_SCHEMA,
    dataset_version: version,
    sample_id: s.sample_id,
    split: s.split,
    subset: s.subset,
    group_id: s.group_id,
    scenario_id: s.scenario_id,
    scenario_frame_index: frameIndex,
    family: s.family,
    kind: s.transition ? 'transition' : 'settled',
    seed: s.seed,
    environment: d.environment,
    camera: { camera_id: info.camera_id, calibration_version: info.calibration_version, calibration_file: 'calibration/cam-01.json', pose: info.pose },
    sim_time_ms: d.sim_time_ms,
    // Exactly the five production FrameMetadata fields, for optional replay through the API
    // (restamp captured_at: the API rejects stale frames). Ground truth is never in here.
    frame_metadata: {
      session_id: `ds-${s.sample_id}`,
      camera_id: info.camera_id,
      seq: 0,
      sim_time_ms: d.sim_time_ms,
      captured_at: new Date(Date.UTC(2026, 0, 1) + d.sim_time_ms).toISOString(),
    },
    image: { path: `images/${base}.jpg`, width: info.pose.width, height: info.pose.height, format: 'jpeg', jpeg_quality: info.jpeg_quality },
    labels_path: `labels/${base}.json`,
    scenario_params: { density: s.density, base_occupancy: s.occupancy, occluders: s.occluders, transition: s.transition, pattern: s.pattern },
    spaces: d.spaces,
    vehicles: d.vehicles.map((v) => ({ instance_id: v.instance_id, class: v.class, space_id: v.space_id, phase: v.phase, bbox_amodal: v.bbox_amodal, truncated: v.truncated })),
    counts: { occupied, empty: d.spaces.length - occupied, vehicles: d.vehicles.length, occluders: d.objects.length },
  };
}

async function main() {
  const opt = args();
  const config = JSON.parse(readFileSync(opt.config, 'utf8'));
  const configHash = sha256(JSON.stringify(stable({ schema: DATASET_SCHEMA, sample_schema: SAMPLE_SCHEMA, config })));
  const version = `${config.name}-${configHash.slice(0, 10)}`;
  const out = opt.out ?? join(homedir(), '.cache/parkright/datasets', version);
  if (opt.printOut) return console.log(out);
  if (/^\/(private\/)?tmp\//.test(out)) throw new Error('refusing to write a dataset under /tmp (macOS deletes it)');
  if (existsSync(out) && !opt.force) throw new Error(`${out} exists; pass --force to replace it`);
  const work = `${out}.partial-${process.pid}`;
  mkdirSync(work, { recursive: true });

  const server = await createServer({ root: SIM, configFile: join(SIM, 'vite.config.ts'), logLevel: 'warn', server: { host: '127.0.0.1', port: opt.port, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const started = performance.now();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => {
      if (r.url().includes('/api/')) errors.push(`dataset page made an API request: ${r.url()}`);
    });
    await page.goto(`http://127.0.0.1:${opt.port}/dataset.html`);
    await page.waitForSelector('body[data-dataset-ready="1"]', { timeout: 60_000 }).catch((e) => {
      throw new Error(`dataset page failed to start: ${errors.join('; ') || e.message}`);
    });
    const info = await page.evaluate(() => window.__parkrightDataset.info());
    const plan = await page.evaluate((c) => window.__parkrightDataset.plan(c), config);
    console.log(`${version}: ${plan.length} samples${opt.planOnly ? ' (plan only)' : ''} → ${out}`);

    const frameIndex = new Map();
    const lines = [];
    const checksums = [];
    let bytes = 0;
    let rendered = 0;
    const renderStart = performance.now();
    for (const s of plan) {
      const i = frameIndex.get(s.scenario_id) ?? 0;
      frameIndex.set(s.scenario_id, i + 1);
      const d = await page.evaluate((x) => (window.__parkrightDataset[x.mode])(x.s), { s, mode: opt.planOnly ? 'describe' : 'render' });
      const record = manifestRecord(version, s, d, i, info);
      lines.push(JSON.stringify(record));
      if (opt.planOnly) continue;
      if (d.width !== info.pose.width || d.height !== info.pose.height) throw new Error(`${s.sample_id}: rendered ${d.width}x${d.height}`);
      if (d.stray_pixels !== 0) throw new Error(`${s.sample_id}: ${d.stray_pixels} ID-render pixels matched no vehicle`);
      const jpeg = Buffer.from(d.jpeg_base64, 'base64');
      mkdirSync(join(work, dirname(record.image.path)), { recursive: true });
      mkdirSync(join(work, dirname(record.labels_path)), { recursive: true });
      writeFileSync(join(work, record.image.path), jpeg);
      checksums.push(`${sha256(jpeg)}  ${record.image.path}`);
      const label = {
        schema: 'parkright-dataset-label-v1',
        notice: 'OFFLINE TRAINING/EVALUATION LABELS. Simulator ground truth; never part of a production frame.',
        sample_id: s.sample_id,
        dataset_version: version,
        image: record.image,
        environment: record.environment,
        spaces: d.spaces.map((x) => ({ ...x, polygon_px: info.polygons?.[x.space_id] ?? null })),
        vehicles: d.vehicles.map((v, k) => ({ ...v, ...d.visibility[k] })),
        objects: d.objects,
        visibility_method: 'ID-buffer render through cam-01; renderer-dependent (not part of the logical determinism guarantee)',
      };
      writeFileSync(join(work, record.labels_path), `${JSON.stringify(label, null, 1)}\n`);
      bytes += jpeg.length;
      if (++rendered % 100 === 0) {
        const rate = rendered / ((performance.now() - renderStart) / 1000);
        console.log(`  ${rendered}/${plan.length} (${rate.toFixed(1)} img/s)`);
      }
    }
    if (errors.length) throw new Error(`dataset page errors: ${errors.join('; ')}`);
    writeFileSync(join(work, 'manifest.jsonl'), `${lines.join('\n')}\n`);
    const seconds = (performance.now() - started) / 1000;
    if (!opt.planOnly) {
      mkdirSync(join(work, 'calibration'), { recursive: true });
      writeFileSync(join(work, 'calibration/cam-01.json'), readFileSync(join(ROOT, 'packages/shared/calibration/cam-01.json')));
      writeFileSync(join(work, 'checksums.sha256'), `${checksums.join('\n')}\n`);
      const renderSeconds = (performance.now() - renderStart) / 1000;
      const dataset = {
        schema: DATASET_SCHEMA,
        notice: 'OFFLINE DATASET. Labels are simulator ground truth for training/evaluation only.',
        dataset_version: version,
        config_sha256: configHash,
        config,
        classes: ['sedan', 'hatchback', 'suv', 'pickup', 'van'],
        object_classes: ['occluder'],
        splits: ['train', 'validation', 'test'],
        subsets: ['standard', 'robustness'],
        occlusion_rule: info.occlusion_rule,
        camera: { camera_id: info.camera_id, calibration_version: info.calibration_version, pose: info.pose },
        provenance: {
          git_commit: git('rev-parse', 'HEAD'),
          git_dirty: (git('status', '--porcelain') ?? '') !== '',
          simulator_source_sha256: sourceDigest(),
          browser: browser.version(),
          node: process.version,
        },
        generation: {
          created_at: new Date().toISOString(),
          samples: plan.length,
          jpeg_bytes: bytes,
          total_seconds: Math.round(seconds * 10) / 10,
          render_seconds: Math.round(renderSeconds * 10) / 10,
          images_per_second: Math.round((rendered / renderSeconds) * 100) / 100,
        },
      };
      writeFileSync(join(work, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
    }
    if (existsSync(out)) rmSync(out, { recursive: true });
    renameSync(work, out);
    console.log(`done in ${seconds.toFixed(1)} s${opt.planOnly ? '' : `, ${(bytes / 1e6).toFixed(1)} MB of JPEG`}`);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
