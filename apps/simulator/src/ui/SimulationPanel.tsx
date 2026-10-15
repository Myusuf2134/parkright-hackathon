import { useEffect, useState } from 'react';
import { PRESET_IDS, PRESETS } from '../sim/presets.ts';
import { SPEEDS } from '../sim/world.ts';
import { useLab, useVersion } from './context.ts';
import { Panel } from './Panel.tsx';

export function SimulationPanel() {
  const { lab, streamer } = useLab();
  const w = lab.world;
  useVersion(w);
  const [seed, setSeed] = useState(String(w.spec.seed));
  const [copied, setCopied] = useState(false);
  useEffect(() => setSeed(String(w.spec.seed)), [w.spec.seed]);

  const applySeed = (value: number) => {
    w.setSeed(value);
    streamer.newSession();
    setSeed(String(w.spec.seed));
  };

  return (
    <Panel title="SIMULATION" tag={<span className={`rec ${w.playing ? 'on' : ''}`}>{w.playing ? '▶ RUNNING' : '❚❚ PAUSED'}</span>}>
      <div className="row">
        <div className="segmented">
          <button className={w.playing ? 'active' : ''} onClick={() => w.play()} data-testid="play">▶ Play</button>
          <button className={!w.playing ? 'active' : ''} onClick={() => w.pause()} data-testid="pause">❚❚ Pause</button>
          <button onClick={() => w.step()} data-testid="step">⏭ Step</button>
          <button
            onClick={() => {
              w.reset();
              streamer.newSession();
            }}
            data-testid="reset"
          >
            ↺ Reset
          </button>
        </div>
      </div>
      <div className="row">
        <span className="label">SPEED</span>
        <div className="segmented small">
          {SPEEDS.map((s) => (
            <button key={s} className={w.speed === s ? 'active' : ''} onClick={() => w.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={w.traffic} onChange={(e) => w.setTraffic(e.target.checked)} data-testid="traffic" />
          Seeded traffic
        </label>
      </div>
      <div className="row">
        <span className="label">SEED</span>
        <input className="mono seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && applySeed(Number(seed))} data-testid="seed-input" />
        <button className="ghost" onClick={() => applySeed(Number(seed))} data-testid="seed-apply">Apply</button>
        <button className="ghost" onClick={() => applySeed(crypto.getRandomValues(new Uint32Array(1))[0]!)}>New</button>
        <button
          className="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Seed, occupancy, environment and camera pose are all in the link"
        >
          {copied ? 'Copied' : 'Copy scene link'}
        </button>
      </div>
      <div className="row">
        <span className="label">ENVIRONMENT</span>
        <div className="segmented small">
          {PRESET_IDS.map((id) => (
            <button key={id} className={w.spec.preset === id ? 'active' : ''} onClick={() => w.setPreset(id)} data-testid={`preset-${id}`}>
              {PRESETS[id].contract.name}
            </button>
          ))}
        </div>
      </div>
      <p className="caption">Rain, fog, snow, glare, lens dirt, occlusion and exposure presets plug in via src/scene/effects.ts (not yet enabled).</p>
    </Panel>
  );
}
