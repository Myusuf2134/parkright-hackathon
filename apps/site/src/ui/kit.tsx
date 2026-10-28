import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LINKS, RUN_ANCHOR } from '../config.ts';

/** Fades and lifts content in once, when it first scrolls into view. Reduced motion: shown as-is. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'section' | 'li' | 'figure'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal${shown ? ' in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</Tag>;
}

/** An iPhone 15 frame around a real screen capture from the app (393 × 852). */
export function Phone({ src, alt, className = '', priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    <div className={`phone ${className}`}>
      <img src={src} alt={alt} width={393} height={852} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : 'auto'} />
      <span className="island" aria-hidden />
    </div>
  );
}

/** Tells the reader where a picture or value comes from. */
export function Source({ children, tone = 'demo' }: { children: ReactNode; tone?: 'demo' | 'sim' | 'live' }) {
  return <span className={`src src-${tone}`}>{children}</span>;
}

/** A primary/secondary action that goes to the hosted app or demo, or to the run instructions. */
export function Action({ to, children, kind = 'primary', testid }: { to: 'app' | 'demo' | 'repo'; children: ReactNode; kind?: 'primary' | 'secondary' | 'ghost'; testid?: string }) {
  const href = LINKS[to] ?? RUN_ANCHOR;
  const external = href.startsWith('http');
  return (
    <a className={`btn btn-${kind}`} href={href} data-testid={testid} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {children}
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 8h9m-3.5-4L12.5 8 8.5 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </a>
  );
}

export function SectionHead({ eyebrow, title, lede, id }: { eyebrow: string; title: ReactNode; lede?: ReactNode; id?: string }) {
  return (
    <Reveal className="shead">
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={id} className="h2">{title}</h2>
      {lede && <p className="lede">{lede}</p>}
    </Reveal>
  );
}
