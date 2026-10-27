/**
 * The bottom sheet. Detents are visible heights in px; the sheet is as tall as its largest detent
 * and slides on a spring. Dragging uses the handle (and the whole sheet when its content doesn't
 * scroll); a flick picks the detent its velocity points at; past the ends it rubber-bands.
 */
import { animate, motion, useDragControls, type MotionValue } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/time.ts';

export interface Detent { id: string; height: number }

export const SHEET_SPRING = { type: 'spring' as const, visualDuration: 0.42, bounce: 0.1 };

export function Sheet({ y, viewport, detents, active, hidden, onChange, scroll, label, children }: {
  y: MotionValue<number>;
  viewport: number;
  detents: Detent[];
  active: string;
  hidden?: boolean;
  onChange: (id: string) => void;
  scroll?: boolean;
  label: string;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const dragged = useRef(false);
  const heights = detents.map((d) => d.height);
  const maxH = Math.max(...heights);
  const minH = Math.min(...heights);
  const target = hidden ? 0 : (detents.find((d) => d.id === active)?.height ?? minH);

  useEffect(() => {
    const to = viewport - target;
    if (prefersReducedMotion()) { y.set(to); return; }
    const a = animate(y, to, SHEET_SPRING);
    return () => a.stop();
  }, [y, viewport, target]);

  const order = [...detents].sort((a, b) => a.height - b.height);
  const step = (dir: 1 | -1) => {
    const i = order.findIndex((d) => d.id === active);
    const next = order[Math.min(order.length - 1, Math.max(0, i + dir))];
    if (next && next.id !== active) onChange(next.id);
  };

  return (
    <motion.section
      className="sheet"
      aria-label={label}
      data-testid="sheet"
      data-detent={active}
      style={{ y, height: maxH }}
      drag="y"
      dragControls={controls}
      dragListener={!scroll}
      dragConstraints={{ top: viewport - maxH, bottom: viewport - minH }}
      dragElastic={0.14}
      dragMomentum={false}
      onDragStart={() => { dragged.current = true; }}
      onDragEnd={(_, info) => {
        setTimeout(() => { dragged.current = false; }, 0);
        const projected = viewport - (y.get() + info.velocity.y * 0.2);
        const best = detents.reduce((b, d) => (Math.abs(d.height - projected) < Math.abs(b.height - projected) ? d : b));
        if (best.id !== active) onChange(best.id);
        else animate(y, viewport - best.height, SHEET_SPRING);
      }}
    >
      <button
        type="button"
        className="grabzone"
        aria-label={order[order.length - 1].id === active ? 'Collapse sheet' : 'Expand sheet'}
        onPointerDown={(e) => controls.start(e)}
        onClick={() => { if (!dragged.current) step(order[order.length - 1].id === active ? -1 : 1); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); step(1); } if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); } }}
      >
        <span className="grab" />
      </button>
      <div className={`content${scroll ? ' scroll' : ''}`}>{children}</div>
    </motion.section>
  );
}
