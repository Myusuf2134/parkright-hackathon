import { useEffect, useState } from 'react';

/** Visible viewport height (tracks the iOS URL bar and rotation). */
export function useViewportHeight(): number {
  const read = () => Math.round(window.visualViewport?.height ?? window.innerHeight);
  const [h, setH] = useState(read);
  useEffect(() => {
    const on = () => setH(read());
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); };
  }, []);
  return h;
}

/** Safe-area insets in px, read from the same CSS variables the stylesheet uses. */
export function useSafeArea(): { top: number; bottom: number } {
  const [s, setS] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--safe-top);padding-bottom:var(--safe-bottom)';
    document.body.appendChild(probe);
    const read = () => {
      const cs = getComputedStyle(probe);
      setS({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 });
    };
    read();
    window.addEventListener('resize', read);
    return () => { window.removeEventListener('resize', read); probe.remove(); };
  }, []);
  return s;
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported (iOS) */ }
}
