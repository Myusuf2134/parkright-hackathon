import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YouTabIcon } from './TabIcons.tsx';

describe('centered Meridian smile', () => {
  it.each([
    [-2, '-2.8px'], // Plan: far left
    [-1, '-1.4px'], // Explore: near left
    [0, '0px'],     // You: center
    [1, '1.4px'],  // Alerts: near right
    [2, '2.8px'],  // Search: far right
  ] as const)('looks toward position %s', (gaze, offset) => {
    const html = renderToStaticMarkup(<YouTabIcon gaze={gaze} />);
    expect(html).toContain(`translateX(${offset})`);
    expect(html).toContain('class="tab-face-shell"');
    expect(html).toContain('class="tab-face-features"');
  });
});
