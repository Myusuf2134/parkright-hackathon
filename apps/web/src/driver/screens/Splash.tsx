/**
 * Opening sequence. Inline SVG driven by one requestAnimationFrame clock: no animation library,
 * only transforms, opacity, path points and two blur radii change per frame.
 *
 * After the line folds into a road, everything is placed by one camera:
 *   screen y = horizon + K / Z,   scale ∝ 1 / Z,   and the road bends gently right toward the horizon.
 * The reveal is a circular mask on this overlay, opening at the garage pin of the real map below.
 */
import { useEffect, useRef } from 'react';
import { GARAGE_PIN, MAP_H, MAP_W } from '../ui/CampusMap.tsx';

export type SplashVariant = 'full' | 'short' | 'reduced';

const LINE_Y = 520, CX = 195, HOR = GARAGE_PIN.y, K = 300, HALF_W = 0.78;
const BEND = (GARAGE_PIN.x - CX) / K, BEND_Z = 5;
const ZN = 0.42, ZF = 140, N = 30;
const ZS = Array.from({ length: N }, (_, i) => ZN * (ZF / ZN) ** (i / (N - 1)));
const CS = 0.72; // side car scale (drawn 200 units long)
const Z_SWAP = K / (LINE_Y - 1 - HOR);
const DASHES = 16;

const centerX = (z: number) => CX + K * BEND * (1 - Math.exp(-z / BEND_Z));
const roadPoint = (side: number, z: number): [number, number] => [centerX(z) + (K * side * HALF_W) / z, HOR + K / z];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function bez(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (t: number) => {
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * u + bx) * u + cx) * u - t, d = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(d) < 1e-6) break;
      u = clamp(u - x / d);
    }
    return ((ay * u + by) * u + cy) * u;
  };
}
const OUT = bez(0.22, 1, 0.36, 1), INOUT = bez(0.65, 0, 0.35, 1), LAUNCH = bez(0.5, 0, 0.75, 0.55), AWAY = bez(0.55, 0, 0.9, 0.4);
const seg = (t: number, a: number, b: number, e: (x: number) => number = (x) => x) => e(clamp((t - a) / (b - a)));

/** Timeline end per variant (ms) and when the app underneath should start its own entrance. */
export const SPLASH_TIMING = { full: { reveal: 2380, done: 2780 }, short: { reveal: 520, done: 920 }, reduced: { reveal: 700, done: 900 } } as const;

export function Splash({ variant, onReveal, onDone }: { variant: SplashVariant; onReveal: () => void; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };

  useEffect(() => {
    const $ = <T extends Element>(id: string) => svg.current!.querySelector<T>(`#sp-${id}`)!;
    const el = {
      word: $('word'), wordT: $('wordT'), tag: $('tag'), edge: $('edge'), glow: $('glow'), ground: $('ground'), fog: $('fog'), horizon: $('horizon'),
      dashes: $('dashes'), side: $('side'), body: $('body'), rear: $('rear'), w1: $('w1'), w2: $('w2'), pool: $('pool'), trail: $('trail'),
      blurS: $('blurS'), blurR: $('blurR'), dot: $('dot'), dotGlow: $('dotGlow'), s1: $('s1'), s2: $('s2'), scene: $('scene'), light: $('light'),
    };
    const dashEls: SVGPathElement[] = [];
    for (let i = 0; i < DASHES; i++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', '#dcdfd8');
      el.dashes.appendChild(p);
      dashEls.push(p);
    }

    // viewBox → screen px for the reveal mask (xMidYMid slice).
    const toScreen = (x: number, y: number) => {
      const r = svg.current!.getBoundingClientRect();
      const s = Math.max(r.width / MAP_W, r.height / MAP_H);
      return [r.left + (r.width - MAP_W * s) / 2 + x * s, r.top + (r.height - MAP_H * s) / 2 + y * s];
    };
    const setMask = (x: number, y: number, radius: number) => {
      const [px, py] = toScreen(x, y);
      const r = root.current!;
      const m = radius <= 0 ? 'none' : `radial-gradient(circle at ${px}px ${py}px, transparent ${radius}px, #000 ${radius + 1}px)`;
      r.style.maskImage = m;
      r.style.setProperty('-webkit-mask-image', m);
    };
    const diag = Math.hypot(window.innerWidth, window.innerHeight);

    let revealed = false, done = false;
    const fire = (t: number) => {
      const timing = SPLASH_TIMING[variant];
      if (!revealed && t >= timing.reveal) { revealed = true; cb.current.onReveal(); }
      if (!done && t >= timing.done) { done = true; cb.current.onDone(); }
      return done;
    };

    const edgePath = (fold: number, draw: number) => {
      const pts: string[] = [];
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1);
        const [rx, ry] = roadPoint(-1, ZS[i]);
        pts.push(`${lerp(lerp(20, 195, k), rx, fold).toFixed(1)} ${lerp(LINE_Y, ry, fold).toFixed(1)}`);
      }
      for (let i = N - 1; i >= 0; i--) {
        const k = i / (N - 1);
        const [rx, ry] = roadPoint(1, ZS[i]);
        pts.push(`${lerp(lerp(370, 195, k), rx, fold).toFixed(1)} ${lerp(LINE_Y, ry, fold).toFixed(1)}`);
      }
      return { d: draw > 0 ? `M${pts.join(' L')}` : '', ground: `M${pts.join(' L')} L${lerp(370, 420, fold)} 900 L${lerp(20, -30, fold)} 900 Z` };
    };

    const render = (t: number): boolean => {
      if (variant === 'reduced') {
        el.wordT.setAttribute('letter-spacing', '4');
        root.current!.style.opacity = String(1 - seg(t, 700, 900));
        return fire(t);
      }
      const short = variant === 'short';
      // 1 · Brand
      const s1 = seg(t, 0, short ? 320 : 520, OUT);
      const lift = short ? seg(t, 560, 820, AWAY) : seg(t, 1600, 2150, AWAY);
      el.word.setAttribute('opacity', String(s1 * (1 - lift)));
      el.word.setAttribute('transform', `translate(0 ${lerp(12, 0, s1) - lift * 36})`);
      el.wordT.setAttribute('letter-spacing', lerp(12, 4, s1).toFixed(2));
      el.tag.setAttribute('opacity', String(short ? s1 : seg(t, 120, 640, OUT)));

      // 2 · Line, then 4 · fold into a road
      const draw = seg(t, short ? 140 : 380, short ? 560 : 960, INOUT);
      const fold = short ? 0 : seg(t, 1540, 1900, INOUT);
      const { d, ground } = edgePath(fold, draw);
      const fade = short ? 1 - seg(t, 600, 820) : 1 - seg(t, 2380, 2620);
      for (const p of [el.edge, el.glow]) {
        p.setAttribute('d', d);
        if (draw < 1) {
          const len = 350 * 1.01;
          p.setAttribute('stroke-dasharray', `${len * draw} 2000`);
        } else p.removeAttribute('stroke-dasharray');
      }
      el.edge.setAttribute('opacity', String(fade));
      el.glow.setAttribute('opacity', String(0.45 * fade));
      el.s1.setAttribute('stop-opacity', String(lerp(1, 0.8, fold)));
      el.s2.setAttribute('stop-opacity', String(lerp(1, 0, fold)));
      el.ground.setAttribute('d', ground);
      el.ground.setAttribute('opacity', String(fold * fade));
      el.fog.setAttribute('opacity', String(fold * fade));
      el.horizon.setAttribute('opacity', String(fold * fade));
      // Subtle camera drift once the road exists.
      el.scene.setAttribute('transform', `translate(${(Math.sin(t / 900) * 1.4 * fold).toFixed(2)} 0)`);

      if (short) {
        el.side.setAttribute('opacity', '0');
        const r = seg(t, 520, 900, OUT);
        setMask(370, LINE_Y, r * diag);
        return fire(t);
      }

      // Lane dashes stream past as the camera follows the car.
      const camZ = Math.max(0, (t - 1600) / 1000) * 2.2;
      el.dashes.setAttribute('opacity', String(fold * fade));
      for (let i = 0; i < DASHES; i++) {
        const period = DASHES * 1.5;
        const z0 = 0.55 + ((((i * 1.5 - camZ) % period) + period) % period), z1 = z0 + 0.65;
        const a = roadPoint(-0.024, z0), b = roadPoint(0.024, z0), c = roadPoint(0.024, z1), e = roadPoint(-0.024, z1);
        dashEls[i].setAttribute('d', `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]} L${e[0]} ${e[1]} Z`);
        dashEls[i].setAttribute('opacity', String(clamp(1 - (z0 - 3) / 16)));
      }

      // 2–3 · side view
      const appear = seg(t, 520, 860, OUT);
      const run = seg(t, 860, 1700, LAUNCH);
      const x = lerp(64, 205, run);
      const v = run > 0 && run < 1 ? ((LAUNCH(clamp((t + 16 - 860) / 840)) - LAUNCH(clamp((t - 860) / 840))) * 141) / 16 : 0;
      const squat = -0.7 * Math.sin(Math.PI * seg(t, 860, 1260));
      el.body.setAttribute('transform', `rotate(${squat.toFixed(3)} -62 -19)`);
      const swapOut = seg(t, 1580, 1720), swapIn = seg(t, 1620, 1780);
      el.side.setAttribute('opacity', String(appear * (1 - swapOut)));
      el.side.setAttribute('transform', `translate(${x.toFixed(2)} ${(LINE_Y - 1 + lerp(-6, 0, appear)).toFixed(2)}) scale(${CS})`);
      el.blurS.setAttribute('stdDeviation', `${(v * 5 + swapOut * 6).toFixed(2)} 0`);
      const spin = ((x - 64) / (2 * Math.PI * 19.5 * CS)) * 360;
      el.w1.setAttribute('transform', `rotate(${spin.toFixed(1)})`);
      el.w2.setAttribute('transform', `rotate(${spin.toFixed(1)})`);
      el.pool.setAttribute('cx', x.toFixed(1));
      el.pool.setAttribute('opacity', String(0.3 * appear * (1 - swapOut)));
      const tw = Math.max(0, x - 100 * CS - 20) * seg(t, 900, 1150) * (1 - seg(t, 1500, 1680));
      el.trail.setAttribute('x', String(x - 100 * CS - tw));
      el.trail.setAttribute('width', String(tw));

      // 4–5 · rear view on the projected road
      const z = lerp(Z_SWAP, 60, seg(t, 1720, 2420, AWAY));
      const [px, py] = [centerX(z), HOR + K / z];
      const rx = lerp(x, px, fold), ry = lerp(LINE_Y - 1, py, fold);
      const fog = 1 - clamp((z - 18) / 34);
      el.rear.setAttribute('opacity', String(swapIn * fog));
      el.rear.setAttribute('transform', `translate(${rx.toFixed(2)} ${ry.toFixed(2)}) scale(${((0.8 * Z_SWAP) / z).toFixed(4)})`);
      el.blurR.setAttribute('stdDeviation', `${((1 - swapIn) * 6).toFixed(2)} 0`);
      el.light.setAttribute('opacity', String(0.7 + 0.3 * (1 - fog)));

      // 6 · hand-off: a green dot at the horizon opens into the map
      const bloom = seg(t, 2300, 2460, OUT) * (1 - seg(t, 2560, 2700));
      el.dot.setAttribute('r', String(bloom * 6));
      el.dotGlow.setAttribute('r', String(bloom * 16));
      setMask(GARAGE_PIN.x, HOR, seg(t, 2380, 2760, OUT) * diag);
      return fire(t);
    };

    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      if (!render(now - start)) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Test hook: render any moment deterministically.
    (window as unknown as { __parkrightSplashSeek?: (ms: number) => void }).__parkrightSplashSeek = (ms) => { cancelAnimationFrame(raf); render(ms); };
    return () => cancelAnimationFrame(raf);
  }, [variant]);

  const skip = () => { cb.current.onReveal(); cb.current.onDone(); };

  return (
    <div ref={root} className="splash" data-testid="splash" data-variant={variant} onClick={skip} role="presentation">
      <span className="sr-only" role="status">ParkRight is starting</span>
      <svg ref={svg} viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <radialGradient id="sp-gSky" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(330 560)"><stop offset="0" stopColor="#d3e4ff" /><stop offset="1" stopColor="#d3e4ff" stopOpacity="0" /></radialGradient>
          <radialGradient id="sp-gBlush" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(390 60) scale(300 470)"><stop offset="0" stopColor="#fde0e4" /><stop offset="1" stopColor="#fde0e4" stopOpacity="0" /></radialGradient>
          <linearGradient id="sp-gGround" x1="0" x2="0" y1={HOR} y2="844" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fbfbf9" /><stop offset="1" stopColor="#e9eae5" /></linearGradient>
          <linearGradient id="sp-gEdge" x1="0" x2="0" y1="844" y2={HOR} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#12a15a" /><stop id="sp-s1" offset="0.55" stopColor="#12a15a" /><stop id="sp-s2" offset="1" stopColor="#12a15a" /></linearGradient>
          <linearGradient id="sp-gFog" x1="0" x2="0" y1={HOR - 80} y2={HOR + 60} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.55" stopColor="#fff" stopOpacity="0.92" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <linearGradient id="sp-gHorizon" x1="0" x2="1"><stop offset="0" stopColor="#111316" stopOpacity="0" /><stop offset="0.6" stopColor="#111316" stopOpacity="0.12" /><stop offset="1" stopColor="#111316" stopOpacity="0" /></linearGradient>
          <linearGradient id="sp-gBody" x1="0" x2="0" y1="-80" y2="-10" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#4b535d" /><stop offset="0.38" stopColor="#262b31" /><stop offset="0.62" stopColor="#14171b" /><stop offset="0.86" stopColor="#1d2126" /><stop offset="1" stopColor="#0d0f12" /></linearGradient>
          <linearGradient id="sp-gGlass" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#c9d9f2" /><stop offset="0.45" stopColor="#5d6b7d" /><stop offset="0.75" stopColor="#2a3038" /><stop offset="1" stopColor="#6b5a62" /></linearGradient>
          <radialGradient id="sp-gRim" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stopColor="#b8c0c9" /><stop offset="0.7" stopColor="#6c747e" /><stop offset="1" stopColor="#3c424a" /></radialGradient>
          <linearGradient id="sp-gTrail" x1="0" x2="1"><stop offset="0" stopColor="#12a15a" stopOpacity="0" /><stop offset="1" stopColor="#12a15a" stopOpacity="0.85" /></linearGradient>
          <filter id="sp-fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" /></filter>
          <filter id="sp-fSoft" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="2.2" /></filter>
          <filter id="sp-fBlurS" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur id="sp-blurS" stdDeviation="0 0" /></filter>
          <filter id="sp-fBlurR" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur id="sp-blurR" stdDeviation="0 0" /></filter>
          <g id="sp-wheel">
            <circle r="19.5" fill="#101215" /><circle r="17.6" fill="none" stroke="#262a30" strokeWidth="1" /><circle r="14" fill="url(#sp-gRim)" />
            <path d="M8.5 -10.5 A13.5 13.5 0 0 1 12.8 -4" stroke="#12a15a" strokeWidth="3.4" fill="none" />
          </g>
          <path id="sp-spokes" d="M0 -1.5 L-2.4 -13.6 L2.4 -13.6 Z M0 -1.5 L12.2 -6.4 L13.6 -1.8 Z M0 -1.5 L8.6 9.8 L4.6 12.4 Z M0 -1.5 L-4.6 12.4 L-8.6 9.8 Z M0 -1.5 L-13.6 -1.8 L-12.2 -6.4 Z" fill="#24282e" />
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="#ffffff" />
        <rect width={MAP_W} height={MAP_H} fill="url(#sp-gSky)" />
        <rect width={MAP_W} height={MAP_H} fill="url(#sp-gBlush)" />
        <g id="sp-word" fontFamily="'Geist Variable', -apple-system, system-ui, sans-serif" textAnchor="middle">
          <text id="sp-wordT" x="195" y="318" fontSize="40" fontWeight="850" fill="#111316" letterSpacing="12">PARK<tspan fill="#12a15a">RIGHT</tspan></text>
          <text id="sp-tag" x="195" y="350" fontSize="13" fontWeight="500" fill="#6b7078" letterSpacing="2.2">LEGAL PARKING, CONFIRMED LIVE</text>
        </g>
        <g id="sp-scene">
          <path id="sp-ground" d="" fill="url(#sp-gGround)" opacity="0" />
          <g id="sp-dashes" opacity="0" />
          <path id="sp-glow" d="" stroke="url(#sp-gEdge)" strokeWidth="7" fill="none" filter="url(#sp-fGlow)" opacity="0" strokeLinecap="round" strokeLinejoin="round" />
          <path id="sp-edge" d="" stroke="url(#sp-gEdge)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect id="sp-trail" x="0" y={LINE_Y - 2.5} width="0" height="5" rx="2.5" fill="url(#sp-gTrail)" />
          <ellipse id="sp-pool" cx="0" cy={LINE_Y} rx="96" ry="7" fill="#12a15a" opacity="0" filter="url(#sp-fGlow)" />
          <g id="sp-side" opacity="0" filter="url(#sp-fBlurS)">
            <ellipse cx="0" cy="1" rx="104" ry="6" fill="#0a0c0e" opacity="0.26" filter="url(#sp-fSoft)" />
            <ellipse cx="-62" cy="0.5" rx="20" ry="2.6" fill="#0a0c0e" opacity="0.5" /><ellipse cx="64" cy="0.5" rx="20" ry="2.6" fill="#0a0c0e" opacity="0.5" />
            <g id="sp-body">
              <path d="M-98 -22 C-99 -30 -97 -38 -92 -42 L-86 -46 C-70 -52 -52 -62 -30 -68 C-14 -72 6 -72 18 -68 C32 -63 44 -55 56 -50 C72 -48 88 -45 96 -40 C100 -37 102 -32 101 -26 C101 -21 99 -18 95 -17 L85.5 -17 A21.5 21.5 0 0 0 42.5 -17 L-40.5 -17 A21.5 21.5 0 0 0 -83.5 -17 L-94 -17 C-97 -17 -98 -19 -98 -22 Z" fill="url(#sp-gBody)" />
              <path d="M-74 -47.5 C-58 -55 -42 -62.5 -27 -65.6 C-12 -68.6 4 -68.6 14 -65.8 C26 -62 36 -56 47 -50.2 C10 -49.2 -36 -48 -74 -47.5 Z" fill="url(#sp-gGlass)" />
              <path d="M-70 -48.4 C-50 -57 -30 -63 -8 -65.6 L-30 -48.2 Z" fill="#ffffff" opacity="0.18" />
              <path d="M-8 -68.4 L-5 -48.6" stroke="#15181c" strokeWidth="3.2" />
              <path d="M-88 -44.5 C-40 -50.5 30 -51 94 -40.5" stroke="#ffffff" strokeOpacity="0.38" strokeWidth="1.3" fill="none" />
              <path d="M-92 -27 C-40 -29 40 -29 99 -27" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="5" fill="none" />
              <path d="M-8 -47 L-5 -19 M36 -50.4 L38.5 -19" stroke="#000" strokeOpacity="0.38" strokeWidth="0.8" />
              <rect x="-2" y="-41.5" width="10" height="1.8" rx="0.9" fill="#ffffff" opacity="0.28" />
              <path d="M-36 -20.5 L38 -20.5" stroke="#12a15a" strokeWidth="1.4" opacity="0.9" />
              <path d="M84 -41.6 L99.6 -36.2" stroke="#e6efff" strokeWidth="7" strokeLinecap="round" opacity="0.35" filter="url(#sp-fGlow)" />
              <path d="M84 -41.6 L99.6 -36.2" stroke="#f4f7ff" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M-96.8 -35.6 L-87 -42.6" stroke="#ff4646" strokeWidth="2.6" strokeLinecap="round" />
              <circle cx="-62" cy="-19" r="21" fill="#0a0b0d" /><circle cx="64" cy="-19" r="21" fill="#0a0b0d" />
            </g>
            <g transform="translate(-62 -19)"><use href="#sp-wheel" /><g id="sp-w1"><use href="#sp-spokes" /></g><circle r="3.2" fill="#1a1d21" /><circle r="1.1" fill="#9aa3ad" /></g>
            <g transform="translate(64 -19)"><use href="#sp-wheel" /><g id="sp-w2"><use href="#sp-spokes" /></g><circle r="3.2" fill="#1a1d21" /><circle r="1.1" fill="#9aa3ad" /></g>
          </g>
          <rect id="sp-fog" x="-40" y={HOR - 80} width="470" height="140" fill="url(#sp-gFog)" opacity="0" />
          <rect id="sp-horizon" x="0" y={HOR} width="390" height="1.2" fill="url(#sp-gHorizon)" opacity="0" />
          <g id="sp-rear" opacity="0" filter="url(#sp-fBlurR)">
            <ellipse cx="0" cy="1" rx="80" ry="8" fill="#0a0c0e" opacity="0.28" filter="url(#sp-fSoft)" />
            <rect x="-67" y="-24" width="22" height="25" rx="6" fill="#0d0f11" /><rect x="45" y="-24" width="22" height="25" rx="6" fill="#0d0f11" />
            <path d="M-68 -20 C-69 -34 -66 -46 -60 -52 L60 -52 C66 -46 69 -34 68 -20 C68 -14 64 -10 58 -10 L-58 -10 C-64 -10 -68 -14 -68 -20 Z" fill="url(#sp-gBody)" />
            <path d="M-52 -52 C-46 -72 -30 -80 0 -80 C30 -80 46 -72 52 -52 Z" fill="#1a1d21" />
            <path d="M-44 -54 C-39 -69 -26 -75 0 -75 C26 -75 39 -69 44 -54 Z" fill="url(#sp-gGlass)" />
            <path d="M-40 -55 C-35 -67 -24 -72 -6 -73 L-22 -55 Z" fill="#ffffff" opacity="0.16" />
            <path d="M-60 -52.5 L60 -52.5" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1" />
            <rect id="sp-light" x="-66" y="-49" width="132" height="9" rx="4.5" fill="#ff3b3b" filter="url(#sp-fGlow)" opacity="0.7" />
            <rect x="-64" y="-46.6" width="128" height="3.6" rx="1.8" fill="#ff5050" />
            <rect x="-16" y="-34" width="32" height="10" rx="2" fill="#f2f3f0" /><circle cx="0" cy="-29" r="1.6" fill="#12a15a" />
            <path d="M-40 -15 L40 -15 L33 -10 L-33 -10 Z" fill="#0b0d0f" />
          </g>
        </g>
        <circle id="sp-dotGlow" cx={GARAGE_PIN.x} cy={HOR} r="0" fill="#12a15a" opacity="0.35" filter="url(#sp-fGlow)" />
        <circle id="sp-dot" cx={GARAGE_PIN.x} cy={HOR} r="0" fill="#12a15a" />
      </svg>
    </div>
  );
}
