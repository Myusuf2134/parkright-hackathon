import type { ReactNode } from 'react';

export function Panel({ title, tag, children, className = '' }: { title: string; tag?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {tag}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b data-testid={testid}>{value}</b>
    </div>
  );
}
