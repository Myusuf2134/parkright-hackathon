import { AnimatePresence, MotionConfig, motion, useMotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSpace, useAdvice, useFacilities, useHealth, useScenario } from './net/api.ts';
import { useLiveFacility } from './net/live.ts';
import { countSpaces, offerable, readingOrder, suggestSpace } from './lib/parking.ts';
import { flags, usePrefs } from './lib/prefs.ts';
import { prefersReducedMotion, useNow } from './lib/time.ts';
import { Explore, type Mode, type ParkingCtx } from './screens/Explore.tsx';
import { AboutData, SearchSheet } from './screens/Modals.tsx';
import { Plan } from './screens/Plan.tsx';
import { Splash, type SplashVariant } from './screens/Splash.tsx';
import { Trip, tripStatus, type TripWatch } from './screens/Trip.tsx';
import { You } from './screens/You.tsx';
import { haptic, useSafeArea, useViewportHeight } from './ui/layout.ts';

type Tab = 'explore' | 'plan' | 'you';
interface Toast { id: number; text: string; tone: 'warn' | 'good' }

function initialSplash(): SplashVariant | null {
  const q = new URLSearchParams(location.search).get('splash');
  if (q === 'off') return null;
  if (q === 'full' || q === 'short' || q === 'reduced') return q;
  if (flags.session('splashShown')) return null;
  if (prefersReducedMotion()) return 'reduced';
  return flags.get('introSeen') ? 'short' : 'full';
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function DriverApp() {
  const viewport = useViewportHeight();
  const safe = useSafeArea();
  const now = useNow(1000);
  const [prefs, updatePrefs] = usePrefs();

  // ---- data
  const [facilities, retryFacilities] = useFacilities();
  const scenario = useScenario();
  const health = useHealth();
  const facilityId = useMemo(() => {
    if (facilities.state !== 'ok' || !facilities.value.length) return null;
    const wanted = scenario?.simulator.facility_id;
    return facilities.value.find((f) => f.facility_id === wanted)?.facility_id ?? facilities.value[0].facility_id;
  }, [facilities, scenario]);
  const live = useLiveFacility(facilityId);
  const facility = live.facility ?? (facilities.state === 'ok' ? facilities.value.find((f) => f.facility_id === facilityId) ?? null : null);
  const spaces = useMemo(() => readingOrder(live.safeSpaces, facility?.levels), [live.safeSpaces, facility?.levels]);
  const counts = useMemo(() => countSpaces(spaces, prefs), [spaces, prefs]);
  const suggested = useMemo(() => (live.trusted ? suggestSpace(spaces, prefs, facility?.levels) : null), [live.trusted, spaces, prefs, facility?.levels]);

  // ---- destination (from the demo schedule until the driver changes it)
  const [dest, setDest] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (dest === undefined && scenario !== undefined) setDest(scenario?.next_class.destination_short ?? null); }, [scenario, dest]);
  const destination = dest ?? null;
  const fromSchedule = !!scenario && destination === scenario.next_class.destination_short;

  // ---- navigation state
  const [tab, setTab] = useState<Tab>('explore');
  const [mode, setMode] = useState<Mode>('peek');
  const [selected, setSelected] = useState<string | null>(null);
  const [trip, setTrip] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [modal, setModal] = useState<'about' | 'search' | null>(null);
  const [splash, setSplash] = useState<SplashVariant | null>(initialSplash);
  const [revealed, setRevealed] = useState(splash === null);
  const sheetY = useMotionValue(viewport);

  // ---- toasts
  const [toast, setToast] = useState<Toast | null>(null);
  const say = useCallback((text: string, tone: Toast['tone'] = 'warn') => setToast({ id: Date.now(), text, tone }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  // ---- safety: a chosen space that stops being offerable is withdrawn, out loud.
  useEffect(() => {
    if (trip || !selected) return;
    const s = spaces.find((x) => x.space_id === selected);
    if (s && offerable(s, prefs) && live.trusted) return;
    setSelected(null);
    say(live.trusted ? `${selected} is no longer confirmed open.` : `Live data paused. ${selected} can't be confirmed right now.`);
    haptic(20);
  }, [spaces, selected, prefs, live.trusted, trip, say]);

  // Preselect the suggested space when the picker opens.
  useEffect(() => { if (mode === 'space' && !selected && suggested) setSelected(suggested.space_id); }, [mode, selected, suggested]);

  // In-app watch for a space to open (not a push notification).
  useEffect(() => {
    if (watching && live.trusted && counts.forYou > 0) { setWatching(false); say(`A space just opened${suggested ? `: ${suggested.space_id}` : ''}.`, 'good'); haptic(12); }
  }, [watching, live.trusted, counts.forYou, suggested, say]);

  // Trip watch: alert when the chosen space stops being confirmed open.
  const tripSpace = trip ? spaces.find((s) => s.space_id === trip) : undefined;
  const watch: TripWatch | null = trip ? tripStatus(tripSpace, live, prefs) : null;
  const lastWatch = useRef<TripWatch | null>(null);
  useEffect(() => {
    // The trip sheet itself turns into the warning (and announces it); the alert adds a buzz where supported.
    if (watch && lastWatch.current === 'ok' && watch !== 'ok' && prefs.spaceAlerts) haptic(30);
    lastWatch.current = watch;
  }, [watch, trip, prefs.spaceAlerts, say]);

  // ---- advice: only while garage details are open, debounced against fast-changing evidence
  const signature = useDebounced(JSON.stringify([facilityId, live.trusted, spaces.map((s) => [s.space_id, s.current_state, s.stale])]), 1200);
  const advice = useAdvice(facilityId, signature, tab === 'explore' && mode === 'garage' && !trip && live.trusted && counts.open > 0);

  // ---- actions
  const trustedRef = useRef(live.trusted);
  trustedRef.current = live.trusted;
  const go = useCallback(async (spaceId: string) => {
    if (!facilityId) return;
    setChecking(spaceId);
    try {
      const fresh = await fetchSpace(facilityId, spaceId);
      // Recheck against a fresh read and the live connection as it is now, not when Go was pressed.
      if (!trustedRef.current || !offerable(fresh, prefs)) {
        say(`${spaceId} is no longer confirmed open. Choose another space.`);
        setSelected(null);
        setMode('space');
        return;
      }
      setTrip(spaceId);
      setSelected(spaceId);
      haptic(12);
    } catch {
      say(`Couldn't recheck ${spaceId}. Check your connection and try again.`);
    } finally {
      setChecking(null);
    }
  }, [facilityId, prefs, say]);

  const ctx: ParkingCtx = {
    facilities, facility, live, spaces, counts, prefs, now, destination,
    destinationIsDemo: fromSchedule,
    classLine: fromSchedule && scenario ? `${scenario.next_class.course} · ${scenario.next_class.time}` : null,
  };

  const showTabs = revealed && !trip && (tab !== 'explore' || mode === 'peek');

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" data-testid="driver-app" data-tab={tab} data-mode={mode} data-live={live.trusted ? 'live' : live.connection}>
        <AnimatePresence mode="popLayout" initial={false}>
          {trip && facility ? (
            <motion.div key="trip" className="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
              <Trip
                facility={facility} spaceId={trip} live={live} spaces={spaces} prefs={prefs} now={now}
                onEnd={() => { setTrip(null); setSelected(null); setMode('peek'); }}
                onChooseAnother={() => { setTrip(null); setSelected(null); setMode('space'); }}
                onSwitch={(id) => void go(id)}
              />
            </motion.div>
          ) : (
            <motion.div key={tab} className="screen" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {tab === 'explore' && (
                <Explore
                  ctx={ctx} viewport={viewport} safe={safe} revealed={revealed} mode={mode} setMode={setMode} sheetY={sheetY}
                  selected={selected} setSelected={setSelected} suggested={suggested} advice={advice} checking={checking}
                  watching={watching} onWatch={() => setWatching(true)} onGo={(id) => void go(id)}
                  onSearch={() => setModal('search')} onClearDestination={() => setDest(null)} onAbout={() => setModal('about')}
                  onProfile={() => setTab('you')} onRetry={retryFacilities}
                />
              )}
              {tab === 'plan' && <Plan scenario={scenario} onFind={(d) => { setDest(d); setMode('peek'); setTab('explore'); }} />}
              {tab === 'you' && <You prefs={prefs} update={updatePrefs} health={health} onAbout={() => setModal('about')} onReplayIntro={() => { flags.set('introSeen', false); setSplash('full'); }} />}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTabs && (
            <motion.nav key="tabs" className="tabs" role="tablist" aria-label="ParkRight" style={{ x: '-50%' }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
              {(['explore', 'plan', 'you'] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); if (t === 'explore') setMode('peek'); }} data-testid={`tab-${t}`}>
                  {tab === t && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.12 }} />}
                  <span>{t === 'explore' ? 'Explore' : t === 'plan' ? 'Plan' : 'You'}</span>
                </button>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>

        <AboutData open={modal === 'about'} onClose={() => setModal(null)} facility={facility} spaces={spaces} health={health} demo={!!scenario} now={now} />
        <SearchSheet open={modal === 'search'} onClose={() => setModal(null)} scenario={scenario} onPick={(d) => setDest(d)} />

        <AnimatePresence>
          {toast && (
            <motion.div key={toast.id} className={`toast ${toast.tone}`} role="status" aria-live="assertive" data-testid="toast" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.15 }} onClick={() => setToast(null)}>
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>

        {splash && (
          <Splash
            key={splash}
            variant={splash}
            onReveal={() => setRevealed(true)}
            onDone={() => { flags.set('introSeen'); flags.setSession('splashShown'); setSplash(null); setRevealed(true); }}
          />
        )}
      </div>
    </MotionConfig>
  );
}
