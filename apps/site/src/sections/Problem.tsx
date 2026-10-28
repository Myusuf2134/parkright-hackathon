import { Reveal } from '../ui/kit.tsx';

const MOMENTS = [
  { t: '9:45', title: 'Which garage?', body: 'You pick the one you always pick. Whether it has room right now is a guess.' },
  { t: '10:02', title: 'Is anything open?', body: 'A space that looked free a minute ago may already be taken by the time you reach it.' },
  { t: '10:09', title: 'Did the plan change?', body: 'Traffic on your route, snow, roadwork at the entrance, or a room change you haven’t seen yet.' },
  { t: '10:20', title: 'Class starts.', body: 'Whatever time the search took comes out of the walk to class.' },
];

export function Problem() {
  return (
    <section className="section problem" aria-labelledby="problem-title">
      <div className="wrap problem-grid">
        <Reveal className="problem-copy">
          <span className="eyebrow">The problem</span>
          <h2 id="problem-title" className="h2">Your class starts at 10:20. Parking shouldn’t be the unknown.</h2>
          <p className="lede">Most of a campus commute is predictable. The last few minutes aren’t: finding a space, and knowing whether you left early enough to find one.</p>
        </Reveal>
        <ol className="timeline" aria-label="An illustrative morning">
          {MOMENTS.map((m, i) => (
            <Reveal as="li" key={m.t} delay={i * 90} className={i === MOMENTS.length - 1 ? 'last' : ''}>
              <time>{m.t}</time>
              <div><b>{m.title}</b><p>{m.body}</p></div>
            </Reveal>
          ))}
        </ol>
      </div>
      <p className="wrap fine center">An illustrative morning, not survey data.</p>
    </section>
  );
}
