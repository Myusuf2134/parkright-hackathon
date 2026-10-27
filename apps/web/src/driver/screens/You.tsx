/** You: preferences stored on this phone. No account, nothing verified, nothing promised. */
import type { Health } from '../net/api.ts';
import type { Prefs } from '../lib/prefs.ts';
import { Toggle } from '../ui/bits.tsx';
import { Access, Badge, Bell, Car, Person, Replay, School, Shield } from '../ui/icons.tsx';

export function You({ prefs, update, health, onAbout, onReplayIntro }: {
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  health: Health | null;
  onAbout: () => void;
  onReplayIntro: () => void;
}) {
  return (
    <div className="screen" data-testid="you" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className="wash" style={{ position: 'absolute' }} />
      <div style={{ position: 'relative', zIndex: 5, padding: 'var(--top) 20px calc(var(--safe-bottom) + 110px)', display: 'grid', gap: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <h1 className="hl">You</h1>
          <span className="circ avatar lg" aria-hidden><Person /></span>
        </div>
        <p className="body" style={{ marginTop: -4 }}>Saved on this phone. No account needed.</p>

        <div className="sec" style={{ marginTop: 6 }}>Your car</div>
        <div className="list">
          <div className="li">
            <span className="ic"><Car /></span>
            <span className="t"><b>{prefs.vehicle === 'ev' ? 'Electric' : 'Gas or hybrid'}</b><small>{prefs.vehicle === 'ev' ? 'EV charging spaces can be offered' : 'EV charging spaces are hidden'}</small></span>
          </div>
          <div style={{ padding: '0 18px 16px' }}>
            <div className="seg" role="group" aria-label="Vehicle type">
              <button type="button" aria-pressed={prefs.vehicle === 'gas'} onClick={() => update({ vehicle: 'gas' })}>Gas or hybrid</button>
              <button type="button" aria-pressed={prefs.vehicle === 'ev'} onClick={() => update({ vehicle: 'ev' })}>Electric</button>
            </div>
          </div>
        </div>

        <div className="sec">Where you can park</div>
        <div className="list">
          <div className="li">
            <span className="ic"><Access /></span>
            <span className="t"><b>Accessible placard</b><small>Show accessible spaces</small></span>
            <Toggle on={prefs.accessiblePlacard} onChange={(v) => update({ accessiblePlacard: v })} label="Accessible placard" />
          </div>
          <div className="li">
            <span className="ic"><Badge /></span>
            <span className="t"><b>Student permit</b><small>{prefs.studentPermit ? 'Self-reported · not verified' : 'Not set'}</small></span>
            <Toggle on={prefs.studentPermit} onChange={(v) => update({ studentPermit: v })} label="Student permit (self-reported)" />
          </div>
        </div>
        <p className="body" style={{ fontSize: 13, padding: '0 6px' }}>ParkRight can't check permits yet. Follow the signs at the garage.</p>

        <div className="sec">Connections</div>
        <div className="list">
          <div className="li" aria-disabled>
            <span className="ic"><School /></span>
            <span className="t"><b>University account</b><small>Not connected · coming later</small></span>
          </div>
          <div className="li">
            <span className="ic"><Bell /></span>
            <span className="t"><b>Alert me if my space is taken</b><small>In the app, while it's open</small></span>
            <Toggle on={prefs.spaceAlerts} onChange={(v) => update({ spaceAlerts: v })} label="In-app alert if my space is taken" />
          </div>
          <button type="button" className="li press" onClick={onAbout} data-testid="how-it-knows">
            <span className="ic"><Shield /></span>
            <span className="t"><b>How ParkRight knows</b><small>Live, simulated and demo data</small></span>
            <span className="chev" aria-hidden>›</span>
          </button>
          <button type="button" className="li press" onClick={onReplayIntro}>
            <span className="ic"><Replay /></span>
            <span className="t"><b>Replay the intro</b></span>
            <span className="chev" aria-hidden>›</span>
          </button>
        </div>
        <p className="body" style={{ fontSize: 12, padding: '0 6px', fontFamily: 'var(--mono)' }}>
          {health ? `Server ${health.status} · detector ${health.perception.provider === 'none' ? 'not connected' : `${health.perception.provider} ${health.perception.version}`}` : 'Server status unavailable'}
        </p>
      </div>
    </div>
  );
}
