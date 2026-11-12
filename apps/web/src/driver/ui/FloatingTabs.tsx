/** Five-position Meridian navigation. The face stays centered and looks toward the selected action. */
import { motion } from 'motion/react';
import { useRef } from 'react';
import { AlertTabIcon, ExploreTabIcon, PlanTabIcon, SearchTabIcon, YouTabIcon } from './TabIcons.tsx';

export type FloatingAction = 'plan' | 'explore' | 'you' | 'alerts' | 'search';

const items: readonly FloatingAction[] = ['plan', 'explore', 'you', 'alerts', 'search'];
const labels: Record<FloatingAction, string> = {
  plan: 'Plan',
  explore: 'Explore',
  you: 'You',
  alerts: 'Alert settings',
  search: 'Search places',
};

export function FloatingTabs({ active, onSelect }: { active: FloatingAction; onSelect: (action: FloatingAction) => void }) {
  const navRef = useRef<HTMLElement>(null);
  const gaze = (items.indexOf(active) - 2) as -2 | -1 | 0 | 1 | 2;

  return (
    <motion.nav
      key="tabs"
      ref={navRef}
      className="tabs"
      aria-label="Meridian navigation"
      style={{ x: '-50%' }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 14 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      onKeyDown={(event) => {
        const index = items.indexOf(active);
        const next = event.key === 'Home' ? items[0]
          : event.key === 'End' ? items[items.length - 1]
          : event.key === 'ArrowRight' ? items[(index + 1) % items.length]
          : event.key === 'ArrowLeft' ? items[(index + items.length - 1) % items.length]
          : null;
        if (!next) return;
        event.preventDefault();
        onSelect(next);
        navRef.current?.querySelector<HTMLButtonElement>(`[data-testid="tab-${next}"]`)?.focus();
      }}
    >
      {items.map((item) => {
        const selected = active === item;
        const Icon = item === 'plan' ? PlanTabIcon
          : item === 'explore' ? ExploreTabIcon
          : item === 'alerts' ? AlertTabIcon : SearchTabIcon;
        return (
          <button
            key={item}
            className={`tab-${item}`}
            type="button"
            aria-label={labels[item]}
            title={labels[item]}
            aria-current={selected && item !== 'alerts' && item !== 'search' ? 'page' : undefined}
            aria-pressed={item === 'alerts' || item === 'search' ? selected : undefined}
            data-active={selected}
            data-testid={`tab-${item}`}
            onClick={() => onSelect(item)}
          >
            <span className="tab-icon">
              {item === 'you' ? <YouTabIcon gaze={gaze} /> : <Icon />}
            </span>
          </button>
        );
      })}
    </motion.nav>
  );
}
