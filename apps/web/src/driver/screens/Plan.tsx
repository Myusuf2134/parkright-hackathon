/**
 * Plan: a preview of the university-schedule integration. Everything here comes from the demo
 * fixture (/api/v1/demo/scenario) and is labelled once at the top. Without demo mode it says so.
 */
import type { Scenario } from '../net/api.ts';
import { minusMinutes } from '../lib/time.ts';
import { DemoMark } from '../ui/bits.tsx';
import { School } from '../ui/icons.tsx';

const PARKING_BUFFER_MIN = 4;

export function Plan({ scenario, onFind }: { scenario: Scenario | null | undefined; onFind: (destination: string) => void }) {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const nc = scenario?.next_class;
  const nearest = scenario ? [...scenario.candidates].sort((a, b) => a.walking_minutes - b.walking_minutes) : [];
  const walk = nearest[0]?.walking_minutes;
  const parkBy = nc && walk !== undefined ? minusMinutes(nc.time, walk + PARKING_BUFFER_MIN) : null;

  return (
    <div className="screen" data-testid="plan" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className="wash" style={{ height: 'calc(var(--safe-top) + 520px)', position: 'absolute' }} />
      <div style={{ position: 'relative', zIndex: 5, padding: 'var(--top) 20px calc(var(--safe-bottom) + 110px)', display: 'grid', gap: 22 }}>
        <div className="row">
          <span className="greet">{today}</span>
          {scenario && <span style={{ font: '600 13px/1 var(--ui)' }}><DemoMark>Demo schedule</DemoMark></span>}
        </div>
        <h1 className="hl" style={{ marginTop: -10 }}>Your day,<br />parked.</h1>

        {scenario === undefined ? (
          <div className="skel" style={{ height: 230, borderRadius: 32 }} />
        ) : nc ? (
          <div style={{ background: '#fff', borderRadius: 32, padding: '24px 22px 22px', display: 'grid', gap: 12, boxShadow: 'var(--sh-float)' }} data-testid="next-class">
            <div className="row"><span className="ey">Next class</span><span style={{ font: '700 15px/1 var(--ui)' }}>{nc.time}</span></div>
            <div style={{ font: '800 30px/1 var(--ui)', letterSpacing: '-.04em' }}>{nc.course}</div>
            <div className="body">{nc.destination}</div>
            {parkBy && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--warm)', borderRadius: 18, padding: '12px 14px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 0 4px var(--mint)', flex: 'none' }} />
                <span style={{ font: '600 14.5px/1.3 var(--ui)' }}>Park by {parkBy} · {walk} min walk</span>
              </div>
            )}
            <div className="acts"><button type="button" className="btn ink press" onClick={() => onFind(nc.destination_short)} data-testid="find-near">Find parking near {nc.destination_short}</button></div>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 32, padding: 24, display: 'grid', gap: 12, boxShadow: 'var(--sh-float)' }} data-testid="plan-empty">
            <span className="ic" style={{ width: 48, height: 48 }}><School /></span>
            <div style={{ font: '800 24px/1.1 var(--ui)', letterSpacing: '-.03em' }}>Class schedules aren't connected yet</div>
            <p className="body">When university sign-in arrives, ParkRight will plan parking around your classes. Nothing is connected today.</p>
          </div>
        )}

        {nearest.length > 0 && nc && (
          <>
            <div className="sec" style={{ marginTop: 4 }}>Garages near {nc.destination_short}</div>
            <div className="list">
              {nearest.map((c) => (
                <div key={c.facility_id} className="li">
                  <span className="t"><b>{c.name}</b><small>{c.walking_minutes} min walk</small></span>
                  <span style={{ fontSize: 12.5 }}><DemoMark /></span>
                </div>
              ))}
            </div>
            <p className="body" style={{ fontSize: 13, padding: '0 6px' }}>Demo garages show walk times only. ParkRight shows availability only for garages its cameras watch.</p>
          </>
        )}
      </div>
    </div>
  );
}
