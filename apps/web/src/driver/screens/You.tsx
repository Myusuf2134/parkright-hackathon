/** You: preferences stored on this phone. No account, nothing verified, nothing promised. */
import { useEffect, useRef, useState } from 'react';
import type { Health } from '../net/api.ts';
import type { ThemePref } from '../maps/mapStyle.ts';
import type { Prefs } from '../lib/prefs.ts';
import { Toggle } from '../ui/bits.tsx';
import { SourceTag } from '../ui/SourceTag.tsx';
import { FavoriteButton, GarageSource } from './Garages.tsx';
import type { MapsApp } from '../lib/directions.ts';
import type { GarageEntry, Priority } from '../lib/directory.ts';
import type { Saved } from '../lib/saved.ts';
import { Access, Badge, Bell, Car, Check, Chevron, Lock, Person, Phone, Plug, Replay, School, Shield } from '../ui/icons.tsx';
import { Modal } from './Modals.tsx';

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)} data-testid={`${label.split(' ')[0].toLowerCase()}-${v}`}>{text}</button>)}
    </div>
  );
}

export function You({ prefs, update, health, demoSchedule, onAbout, onReplayIntro, saved, entries, onOpenGarage, onToggleFavorite, onClearRecents, focusSection = 'top' }: {
  saved: Saved;
  focusSection?: 'top' | 'alerts';
  entries: GarageEntry[];
  onOpenGarage: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onClearRecents: () => void;
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  health: Health | null;
  demoSchedule: boolean;
  onAbout: () => void;
  onReplayIntro: () => void;
}) {
  const [vehicleSheet, setVehicleSheet] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (focusSection === 'alerts') alertsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSection]);
  const favs = saved.favorites.map((id) => entries.find((e) => e.id === id)).filter((e): e is GarageEntry => !!e);
  const eligible = ['Standard', prefs.accessiblePlacard && 'Accessible', prefs.vehicle === 'ev' && 'EV charging'].filter(Boolean).join(' · ');
  return (
    <div ref={scrollRef} className="screen" data-testid="you" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
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

        <div className="sec">Saved garages</div>
        <div className="list" data-testid="saved-list">
          {favs.length ? favs.map((e) => (
            <div key={e.id} className="li">
              <button type="button" className="t press" style={{ textAlign: 'left' }} onClick={() => onOpenGarage(e.id)} data-testid={`saved-${e.id}`}><b>{e.name}</b><small><GarageSource source={e.source} /></small></button>
              <FavoriteButton id={e.id} name={e.name} on onToggle={onToggleFavorite} />
            </div>
          )) : <div className="li"><span className="t"><b>Nothing saved yet</b><small>Tap the star on a garage to keep it here.</small></span></div>}
        </div>

        <div className="sec">Parking preferences</div>
        <div className="pref-card">
          <b>Recommend garages by</b>
          <Seg<Priority> label="Priority" value={prefs.priority} onChange={(priority) => update({ priority })} options={[['closest', 'Closest walk'], ['most-spaces', 'Most spaces']]} />
          <small>Only spaces confirmed open count. Walking times come from real routes once you choose a destination.</small>
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

        <div className="sec alerts-anchor" ref={alertsRef}>Alerts</div>
        <div className="list">
          <div className="li">
            <span className="ic"><Bell /></span>
            <span className="t"><b>In-app alerts</b><small>If your space is taken or a space opens. Only while Meridian is open.</small></span>
            <Toggle on={prefs.spaceAlerts} onChange={(v) => update({ spaceAlerts: v })} label="In-app alerts" />
          </div>
          <div className="li">
            <span className="ic"><Bell /></span>
            <span className="t"><b>Saved garage alerts</b><small>When a saved garage gets a space you can use. Only while Meridian is open.</small></span>
            <Toggle on={prefs.favoriteAlerts} onChange={(v) => update({ favoriteAlerts: v })} label="Saved garage alerts" />
          </div>
          <div className="li" aria-disabled data-testid="push-row">
            <span className="ic"><Phone /></span>
            <span className="t"><b>Push notifications</b><small>Not available yet. Meridian can't alert you when it's closed.</small></span>
            <SourceTag source="unavailable">Not available</SourceTag>
          </div>
        </div>

        <div className="sec">Directions</div>
        <div className="pref-card">
          <b>Open directions in</b>
          <Seg<MapsApp> label="Maps app" value={prefs.mapsApp} onChange={(mapsApp) => update({ mapsApp })} options={[['auto', 'Automatic'], ['apple', 'Apple Maps'], ['google', 'Google Maps']]} />
        </div>

        <div className="sec">Map</div>
        <div className="list">
          <Seg<ThemePref> label="Appearance" value={prefs.mapTheme} onChange={(mapTheme) => update({ mapTheme })} options={[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']]} />
        </div>

        <div className="sec">Privacy and information</div>
        <div className="list">
          <button type="button" className="li press" onClick={onAbout} data-testid="how-it-knows">
            <span className="ic"><Shield /></span>
            <span className="t"><b>How Meridian knows</b><small>Cameras, freshness, live, simulated and demo data</small></span>
            <Chevron width={18} height={18} className="chev-i" />
          </button>
          <div className="li">
            <span className="ic"><Phone /></span>
            <span className="t"><b>Data on this phone</b><small>Your settings, saved garages and recents stay here. When you ask for a route, your start and destination go to the directions service. Your location is never sent to Meridian's server.</small></span>
          </div>
          <button type="button" className="li press" onClick={onClearRecents} disabled={!saved.recentGarages.length && !saved.recentDestinations.length} data-testid="you-clear-recents">
            <span className="ic"><Replay /></span>
            <span className="t"><b>Clear recent history</b><small>{saved.recentGarages.length + saved.recentDestinations.length} recent items</small></span>
          </button>
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
