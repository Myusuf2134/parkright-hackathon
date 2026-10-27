/** You: preferences stored on this phone. No account, nothing verified, nothing promised. */
import { useState } from 'react';
import type { Health } from '../net/api.ts';
import type { Prefs } from '../lib/prefs.ts';
import { Toggle } from '../ui/bits.tsx';
import { SourceTag } from '../ui/SourceTag.tsx';
import { Access, Badge, Bell, Car, Check, Chevron, Lock, Person, Phone, Plug, Replay, School, Shield } from '../ui/icons.tsx';
import { Modal } from './Modals.tsx';

export function You({ prefs, update, health, demoSchedule, onAbout, onReplayIntro }: {
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  health: Health | null;
  demoSchedule: boolean;
  onAbout: () => void;
  onReplayIntro: () => void;
}) {
  const [vehicleSheet, setVehicleSheet] = useState(false);
  const eligible = ['Standard', prefs.accessiblePlacard && 'Accessible', prefs.vehicle === 'ev' && 'EV charging'].filter(Boolean).join(' · ');
  return (
    <div className="screen" data-testid="you" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className="wash" />
      <div className="plan-col" style={{ gap: 12 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <h1 className="hl xl">You</h1>
          <span className="circ avatar lg" aria-hidden><Person /></span>
        </div>

        <div className="profile" data-testid="profile">
          <div className="t">
            <b>Driver on this phone</b>
            <small>No account. Settings stay on this device.</small>
          </div>
          <div className="chips">
            <span className="chip"><Car width={14} height={14} />{prefs.vehicle === 'ev' ? 'Electric' : 'Gas or hybrid'}</span>
            <span className="chip">{eligible} spaces</span>
          </div>
        </div>

        <div className="sec">My vehicle</div>
        <div className="list">
          <button type="button" className="li press" onClick={() => setVehicleSheet(true)} data-testid="vehicle-card">
            <span className="ic"><Car /></span>
            <span className="t"><b>{prefs.vehicle === 'ev' ? 'Electric' : 'Gas or hybrid'}</b><small>{prefs.vehicle === 'ev' ? 'EV charging spaces can be offered' : 'EV charging spaces are hidden'}</small></span>
            <Chevron width={18} height={18} className="chev-i" />
          </button>
        </div>

        <div className="sec">Parking eligibility</div>
        <div className="list">
          <div className="li">
            <span className="ic"><Access /></span>
            <span className="t"><b>Accessible placard</b><small>Shows accessible spaces. Display your placard.</small></span>
            <Toggle on={prefs.accessiblePlacard} onChange={(v) => update({ accessiblePlacard: v })} label="Accessible placard" />
          </div>
          <div className="li">
            <span className="ic"><Badge /></span>
            <span className="t"><b>Student permit</b><small>{prefs.studentPermit ? 'Self-reported · not verified' : 'Not set'}</small></span>
            <Toggle on={prefs.studentPermit} onChange={(v) => update({ studentPermit: v })} label="Student permit (self-reported)" />
          </div>
          <div className="li">
            <span className="ic"><Lock /></span>
            <span className="t"><b>Verification</b><small>Self-reported permits never unlock restricted spaces.</small></span>
            <SourceTag source="unavailable">Not verified</SourceTag>
          </div>
        </div>

        <div className="sec">University</div>
        <div className="list">
          <div className="li" aria-disabled>
            <span className="ic"><School /></span>
            <span className="t"><b>University account</b><small>Not connected. Sign-in isn't available yet.</small></span>
            <SourceTag source="unavailable">Later</SourceTag>
          </div>
          <div className="li">
            <span className="ic"><Badge /></span>
            <span className="t"><b>Class schedule</b><small>{demoSchedule ? 'Plan is using a demo schedule' : 'Not connected'}</small></span>
            {demoSchedule ? <SourceTag source="demo" /> : <SourceTag source="unavailable">Off</SourceTag>}
          </div>
        </div>

        <div className="sec">Alerts</div>
        <div className="list">
          <div className="li">
            <span className="ic"><Bell /></span>
            <span className="t"><b>In-app alerts</b><small>If your space is taken or a space opens. Only while ParkRight is open.</small></span>
            <Toggle on={prefs.spaceAlerts} onChange={(v) => update({ spaceAlerts: v })} label="In-app alerts" />
          </div>
          <div className="li" aria-disabled data-testid="push-row">
            <span className="ic"><Phone /></span>
            <span className="t"><b>Push notifications</b><small>Not available yet. ParkRight can't alert you when it's closed.</small></span>
            <SourceTag source="unavailable">Not available</SourceTag>
          </div>
        </div>

        <div className="sec">Privacy and information</div>
        <div className="list">
          <button type="button" className="li press" onClick={onAbout} data-testid="how-it-knows">
            <span className="ic"><Shield /></span>
            <span className="t"><b>How ParkRight knows</b><small>Cameras, freshness, live, simulated and demo data</small></span>
            <Chevron width={18} height={18} className="chev-i" />
          </button>
          <div className="li">
            <span className="ic"><Phone /></span>
            <span className="t"><b>Data on this phone</b><small>Your settings and the scenario you previewed. Nothing is sent anywhere.</small></span>
          </div>
          <button type="button" className="li press" onClick={onReplayIntro}>
            <span className="ic"><Replay /></span>
            <span className="t"><b>Replay the intro</b></span>
            <Chevron width={18} height={18} className="chev-i" />
          </button>
        </div>
        <p className="fine mono">
          {health ? `Server ${health.status} · detector ${health.perception.provider === 'none' ? 'not connected' : `${health.perception.provider} ${health.perception.version}`}` : 'Server status unavailable'}
        </p>
      </div>

      <Modal open={vehicleSheet} onClose={() => setVehicleSheet(false)} label="Your vehicle">
        <div style={{ display: 'grid', gap: 14 }} data-testid="vehicle-sheet">
          <h2 className="h2">Your vehicle</h2>
          <p className="body" style={{ fontSize: 14 }}>Used only to decide whether EV charging spaces can be offered to you.</p>
          {([['gas', 'Gas or hybrid', 'EV charging spaces stay hidden', Car], ['ev', 'Electric', 'EV charging spaces can be offered', Plug]] as const).map(([v, title, sub, Icon]) => (
            <button key={v} type="button" className={`choice press${prefs.vehicle === v ? ' on' : ''}`} aria-pressed={prefs.vehicle === v} onClick={() => { update({ vehicle: v }); setVehicleSheet(false); }} data-testid={`vehicle-${v}`}>
              <span className="ic lg"><Icon /></span>
              <span className="t"><b>{title}</b><small>{sub}</small></span>
              {prefs.vehicle === v && <span className="ic sm ok"><Check /></span>}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
