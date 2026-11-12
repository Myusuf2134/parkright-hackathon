/** Original Meridian navigation icons. Designed for the compact floating bottom bar. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function shared(props: IconProps) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...props,
  };
}

export function PlanTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <rect x="4" y="5" width="16" height="16" rx="3" />
      <path d="M8 3.5v3M16 3.5v3M4 9.5h16M8 13h3M8 17h6" />
    </svg>
  );
}

export function ExploreTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <path d="m3 6 6-2.5 6 2.5 6-2.5v14L15 20l-6-2.5L3 20V6Z" />
      <path d="M9 3.5v14M15 6v14" />
      <circle cx="15" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function YouTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <rect x="3.8" y="3.8" width="16.4" height="16.4" rx="5.3" />
      <path d="M8.5 10v1M15.5 10v1" strokeWidth="2.6" />
      <path className="tab-smile-mouth" d="M8 14.1c1.1 1.4 2.4 2.1 4 2.1s2.9-.7 4-2.1" />
    </svg>
  );
}
