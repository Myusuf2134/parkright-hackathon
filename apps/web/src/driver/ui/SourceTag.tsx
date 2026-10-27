import type { Source } from '../arrival/types.ts';

const LABEL: Record<Source, string> = { live: 'Live', simulated: 'Simulated', demo: 'Demo', estimated: 'Estimated', unavailable: 'Unavailable' };

/** One visual language for where a value came from. Green only ever means live. */
export function SourceTag({ source, children }: { source: Source; children?: string }) {
  return <span className={`tag tag-${source}`} data-source={source}>{children ?? LABEL[source]}</span>;
}
