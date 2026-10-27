/**
 * Illustrated campus map. No facility has surveyed coordinates (location is null for simulated
 * sites), so this is a drawing, labelled as one, never a geographic map. Coordinates are in the
 * same 390×844 "slice" space as the splash, so the splash can hand off at the garage pin.
 */
export const MAP_W = 390;
export const MAP_H = 844;
/** Where the monitored garage sits on the illustration (also the splash's vanishing point). */
export const GARAGE_PIN = { x: 243, y: 405 };
export const DEST_PIN = { x: 96, y: 318 };

export function CampusStreets() {
  return (
    <g aria-hidden>
      <rect x={-200} y={-200} width={790} height={1244} fill="#f1f1ec" />
      <g fill="#e6e7e0">
        <rect x="150" y="300" width="74" height="62" rx="12" /><rect x="24" y="320" width="58" height="92" rx="12" />
        <rect x="160" y="560" width="110" height="60" rx="12" /><rect x="318" y="290" width="64" height="70" rx="12" />
        <rect x="24" y="560" width="82" height="66" rx="12" /><rect x="290" y="700" width="80" height="60" rx="12" />
        <rect x="20" y="150" width="90" height="70" rx="12" /><rect x="290" y="130" width="90" height="80" rx="12" />
        <rect x="170" y="140" width="80" height="60" rx="12" /><rect x="-60" y="420" width="70" height="80" rx="12" />
        <rect x="400" y="400" width="80" height="80" rx="12" /><rect x="150" y="740" width="100" height="70" rx="12" />
      </g>
      <rect x="250" y="440" width="120" height="96" rx="24" fill="#e1ece1" />
      <rect x="-40" y="660" width="140" height="120" rx="26" fill="#e1ece1" />
      <g stroke="#ffffff" strokeLinecap="round" fill="none">
        <path d="M-120 270 C 110 246, 230 282, 520 220" strokeWidth="22" />
        <path d="M120 -120 L 140 980" strokeWidth="18" />
        <path d="M-120 530 L 520 480" strokeWidth="15" />
        <path d="M290 -120 C 276 200, 306 380, 296 980" strokeWidth="12" />
        <path d="M-120 690 L 520 650" strokeWidth="10" />
      </g>
      <g fontFamily="Geist Variable, system-ui, sans-serif" fontSize="10.5" fontWeight="600" fill="#b0b4ad" letterSpacing="1.4">
        <text x="148" y="820" transform="rotate(-88 148 820)">NEIL AVE</text>
        <text x="20" y="262" transform="rotate(-6 20 262)">W 17TH AVE</text>
        <text x="282" y="494">OVAL</text>
      </g>
    </g>
  );
}

/** Garage pin: black capsule with "P" and the confirmed-open count (or a dash when not live). */
export function GaragePin({ count, x = GARAGE_PIN.x, y = GARAGE_PIN.y }: { count: number | null; x?: number; y?: number }) {
  const label = count === null ? '—' : String(count);
  const wide = label.length > 1 ? 10 : 0;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-30 - wide / 2} y={-64} width={60 + wide} height={46} rx={17} fill="#111316" />
      <text x={-11 - wide / 2} y={-34} fontFamily="Geist Variable, system-ui, sans-serif" fontSize={18} fontWeight={800} fill="#fff" textAnchor="middle">P</text>
      <text x={10 + wide / 4} y={-34} fontFamily="Geist Variable, system-ui, sans-serif" fontSize={18} fontWeight={800} fill={count ? '#4fd38d' : '#9aa0a7'} textAnchor="middle">{label}</text>
      <path d="M-6 -18.5 L0 -11 L6 -18.5 Z" fill="#111316" />
      <circle r={6.5} fill={count ? '#12a15a' : '#9aa0a7'} stroke="#fff" strokeWidth={3} />
    </g>
  );
}

export function DestinationPin({ name, x = DEST_PIN.x, y = DEST_PIN.y }: { name: string; x?: number; y?: number }) {
  const w = Math.max(80, name.length * 7.4 + 26);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-10} y={-10} width={20} height={20} rx={6} fill="#111316" />
      <rect x={-3.5} y={-3.5} width={7} height={7} rx={2} fill="#fff" />
      <rect x={-w / 2} y={16} width={w} height={26} rx={13} fill="#fff" stroke="#ebebe6" />
      <text x={0} y={33.5} textAnchor="middle" fontFamily="Geist Variable, system-ui, sans-serif" fontSize={12.5} fontWeight={650} fill="#111316">{name}</text>
    </g>
  );
}

/** Dotted walking link between destination and garage. Dotted because no real walking route exists. */
export function WalkLink() {
  const { x: dx, y: dy } = DEST_PIN, { x: gx, y: gy } = GARAGE_PIN;
  return <path d={`M${dx + 12} ${dy + 6} C ${dx + 40} ${dy + 70}, ${gx - 80} ${gy + 10}, ${gx - 12} ${gy + 2}`} stroke="#111316" strokeWidth={3} strokeDasharray="1 7" strokeLinecap="round" fill="none" />;
}
