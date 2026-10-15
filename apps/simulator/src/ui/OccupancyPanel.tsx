import { SPACE_IDS } from '../sim/facility.ts';
import { generateVehicle } from '../sim/vehicles.ts';
import { useLab, useTicker, useVersion } from './context.ts';
import { Panel } from './Panel.tsx';

export function OccupancyPanel() {
  const { lab } = useLab();
  const w = lab.world;
  useVersion(w);
  useTicker(250);
  const moving = new Map(w.vehicles().filter((v) => v.phase !== 'parked').map((v) => [v.spaceId, v.phase]));
  const sel = w.selected;
  const selOccupied = sel !== null && sel in w.spec.occupancy;

  return (
    <Panel title="OCCUPANCY" tag={<span className="muted">{Object.keys(w.spec.occupancy).length}/12 vehicles placed</span>}>
      <div className="bays">
        {SPACE_IDS.map((id) => {
          const nonce = w.spec.occupancy[id];
          const v = nonce === undefined ? null : generateVehicle(w.spec.seed, id, nonce);
          return (
            <button
              key={id}
              className={`bay ${v ? 'filled' : ''} ${sel === id ? 'selected' : ''}`}
              onClick={() => w.select(sel === id ? null : id)}
              onDoubleClick={() => (v ? w.remove(id) : w.park(id))}
              data-testid={`bay-${id}`}
            >
              <b>{id}</b>
              {v && <i className="swatch" style={{ background: v.color }} />}
              <small>{moving.get(id) ?? (v ? v.kind : 'empty')}</small>
            </button>
          );
        })}
      </div>
      <div className="row">
        <span className="label">{sel ? `BAY ${sel}` : 'SELECT A BAY'}</span>
        <button className="primary" disabled={!sel || selOccupied} onClick={() => sel && w.park(sel)} data-testid="park">
          Park vehicle
        </button>
        <button className="ghost" disabled={!sel || !selOccupied} onClick={() => sel && w.remove(sel)} data-testid="remove">
          Remove
        </button>
      </div>
      <div className="row">
        <button className="ghost" onClick={() => w.randomize()} data-testid="randomize">Randomize</button>
        <button className="ghost" onClick={() => w.fillAll()} data-testid="fill-all">Fill all</button>
        <button className="ghost" onClick={() => w.clearAll()} data-testid="clear-all">Clear all</button>
      </div>
      <p className="caption">Double-click a bay to park or remove. While playing, vehicles drive in and out; while paused, changes are instant.</p>
    </Panel>
  );
}
