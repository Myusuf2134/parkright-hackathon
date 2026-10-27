/**
 * Illustrated campus map. No facility has surveyed coordinates (location is null for simulated
 * sites), so this is a drawing, labelled as one, never a geographic map: street names are generic.
 * Coordinates share the splash's 390×844 "slice" space, so the splash hands off at the garage pin.
 */
export const MAP_W = 390;
export const MAP_H = 844;
/** Where the monitored garage sits on the illustration (also the splash's vanishing point). */
export const GARAGE_PIN = { x: 243, y: 405 };
export const DEST_PIN = { x: 96, y: 318 };

const ARTERIALS = [
  'M-220 300 C 0 276, 120 262, 200 257 S 430 236, 620 210', // east–west
  'M150 -220 C 140 100, 128 300, 134 480 S 150 800, 140 1120', // north–south
];
const COLLECTORS = [
  'M-220 520 C 40 506, 250 494, 620 470',
  'M302 -220 C 292 120, 312 330, 302 560 S 294 900, 312 1120',
  'M-220 690 C 60 676, 260 664, 620 646',
];
const LOCALS = [
  'M134 330 C 190 327, 250 331, 302 324',
  'M-40 410 C 20 404, 80 404, 134 406',
  'M206 257 C 210 280, 208 306, 210 330',
  'M302 400 C 340 396, 380 398, 440 394',
  'M66 520 C 64 580, 70 630, 66 690',
  'M134 600 C 180 596, 230 600, 302 596',
  'M-40 160 C 40 156, 90 158, 140 154',
  'M140 140 C 210 136, 250 140, 296 132',
];

/** Building footprints: [x, y, w, h, rotation]. */
const BUILDINGS: [number, number, number, number, number][] = [
  [52, 286, 70, 56, -2], [-20, 330, 48, 64, -2], [160, 280, 34, 38, -2], [232, 272, 52, 42, -2],
  [318, 270, 64, 84, -3], [160, 345, 38, 40, -2], [318, 420, 70, 58, -3], [12, 430, 96, 56, -1],
  [150, 520, 64, 56, -2], [240, 520, 50, 52, -2], [318, 500, 66, 70, -3], [-10, 540, 60, 64, -1],
  [18, 164, 86, 74, -2], [162, 158, 112, 60, -2], [318, 140, 76, 92, -3], [90, 710, 100, 70, -1],
  [210, 700, 76, 84, -2], [318, 670, 64, 84, -3], [-30, 720, 90, 76, -1],
];

export function CampusStreets({ depth = false }: { depth?: boolean }) {
  return (
    <g aria-hidden>
      <rect x={-260} y={-260} width={910} height={1364} fill="#f2f2ee" />
      {/* green space: a campus green with footpaths, and a park strip */}
      <path d="M150 560 C 150 528, 196 516, 228 520 C 270 524, 296 548, 292 588 C 288 632, 250 650, 214 648 C 172 646, 150 610, 150 560 Z" fill="#e2ede2" />
      <path d="M160 548 L 284 636 M 168 638 L 280 540 M 150 590 L 292 586" stroke="#f6f8f3" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M-40 760 C 40 744, 120 750, 160 790 L 160 900 L -40 900 Z" fill="#e2ede2" />
      {/* street hierarchy: arterials with casing, collectors, locals */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ARTERIALS.map((d) => <path key={d} d={d} stroke="#e1e1da" strokeWidth={27} />)}
        {COLLECTORS.map((d) => <path key={d} d={d} stroke="#e4e4dd" strokeWidth={18} />)}
        {LOCALS.map((d) => <path key={d} d={d} stroke="#ffffff" strokeWidth={8} />)}
        {COLLECTORS.map((d) => <path key={`c${d}`} d={d} stroke="#ffffff" strokeWidth={14} />)}
        {ARTERIALS.map((d) => <path key={`c${d}`} d={d} stroke="#ffffff" strokeWidth={22} />)}
        {ARTERIALS.map((d) => <path key={`m${d}`} d={d} stroke="#ecece6" strokeWidth={1} strokeDasharray="10 12" />)}
      </g>
      {/* buildings, with a shaded side when the map is tilted */}
      {BUILDINGS.map(([x, y, w, h, r], i) => (
        <g key={i} transform={`rotate(${r} ${x + w / 2} ${y + h / 2})`}>
          {depth && <rect x={x + 3} y={y + 7} width={w} height={h} rx={10} fill="#d9dad2" />}
          <rect x={x} y={y} width={w} height={h} rx={10} fill={depth ? '#ecece6' : '#e6e7e0'} />
        </g>
      ))}
      {/* the monitored garage: a parking deck under the pin */}
      <g transform={`translate(${GARAGE_PIN.x} ${GARAGE_PIN.y + 2}) rotate(-2)`}>
        {depth && <rect x={-46} y={8} width={92} height={56} rx={12} fill="#cfd6cf" />}
        <rect x={-46} y={0} width={92} height={56} rx={12} fill="#dfe6df" />
        <path d="M-34 14 H34 M-34 28 H34 M-34 42 H34" stroke="#f3f6f2" strokeWidth={3} strokeLinecap="round" />
      </g>
      <g fontFamily="Geist Variable, system-ui, sans-serif" fontSize={10} fontWeight={600} fill="#b3b6ae" letterSpacing={1.6}>
        <text x={186} y={590}>CAMPUS GREEN</text>
        <text x={8} y={290} transform="rotate(-5 8 290)">COLLEGE RD</text>
        <text x={144} y={790} transform="rotate(-88 144 790)">CAMPUS DR</text>
      </g>
    </g>
  );
}

/** Garage pin: black capsule with "P" and the confirmed-open count (or a dash when not live). */
export function GaragePin({ count, active = false, x = GARAGE_PIN.x, y = GARAGE_PIN.y }: { count: number | null; active?: boolean; x?: number; y?: number }) {
  const label = count === null ? '—' : String(count);
  const w = 64 + (label.length > 1 ? 12 : 0);
  const lit = !!count;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={2} rx={active ? 18 : 12} ry={active ? 6 : 4} fill={lit ? '#12a15a' : '#9aa0a7'} opacity={0.18} style={{ transition: 'rx 280ms, ry 280ms' }} />
      <g style={{ transform: `scale(${active ? 1.08 : 1})`, transformOrigin: '0px -40px', transition: 'transform 320ms cubic-bezier(.22,1,.36,1)' }}>
        <rect x={-w / 2} y={-66} width={w} height={48} rx={24} fill="#111316" />
        <circle cx={-w / 2 + 24} cy={-42} r={15} fill={lit ? '#12a15a' : '#3a3f45'} />
        <text x={-w / 2 + 24} y={-36.5} fontFamily="Geist Variable, system-ui, sans-serif" fontSize={16} fontWeight={800} fill="#fff" textAnchor="middle">P</text>
        <text x={-w / 2 + 44} y={-36} fontFamily="Geist Variable, system-ui, sans-serif" fontSize={18} fontWeight={800} fill={lit ? '#ffffff' : '#9aa0a7'}>{label}</text>
        <path d="M-6 -19 L0 -11 L6 -19 Z" fill="#111316" />
      </g>
      <circle r={6.5} fill={lit ? '#12a15a' : '#9aa0a7'} stroke="#fff" strokeWidth={3} />
    </g>
  );
}

export function DestinationPin({ name, x = DEST_PIN.x, y = DEST_PIN.y }: { name: string; x?: number; y?: number }) {
  const w = Math.max(84, name.length * 7.2 + 30);
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={16} fill="#111316" opacity={0.08} />
      <rect x={-10} y={-10} width={20} height={20} rx={6} fill="#111316" />
      <rect x={-3.5} y={-3.5} width={7} height={7} rx={2} fill="#fff" />
      <rect x={-w / 2} y={18} width={w} height={28} rx={14} fill="#fff" />
      <rect x={-w / 2} y={18} width={w} height={28} rx={14} fill="none" stroke="#111316" strokeOpacity={0.06} />
      <text x={0} y={36.5} textAnchor="middle" fontFamily="Geist Variable, system-ui, sans-serif" fontSize={12.5} fontWeight={650} fill="#111316">{name}</text>
    </g>
  );
}

/** Dotted walking link between destination and garage. Dotted because no real walking route exists. */
export function WalkLink() {
  const { x: dx, y: dy } = DEST_PIN, { x: gx, y: gy } = GARAGE_PIN;
  return <path d={`M${dx + 12} ${dy + 8} C ${dx + 40} ${dy + 74}, ${gx - 84} ${gy + 10}, ${gx - 12} ${gy + 2}`} stroke="#111316" strokeOpacity={0.55} strokeWidth={3} strokeDasharray="0.5 7" strokeLinecap="round" fill="none" />;
}

/** The demo drive into the garage along the drawn streets (Trip). */
export const TRIP_ROUTE = `M140 1060 C 144 860, 136 700, 134 560 C 134 530, 140 512, 166 508 C 196 504, 214 500, 236 494 C 246 491, 246 470, 244 450 L ${GARAGE_PIN.x} ${GARAGE_PIN.y + 6}`;
