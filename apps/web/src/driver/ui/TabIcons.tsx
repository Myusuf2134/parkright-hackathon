/** Original icon drawing inspired by the user's reference, with Meridian's own interactive face. */
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
      <path d="M3 10.5 12 3l9 7.5" strokeWidth="2.3" />
      <path d="M5.5 10v10h5v-6h3v6h5V10" strokeWidth="2.1" />
    </svg>
  );
}

export function ExploreTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <path d="M2.1 12.5c1.5 0 1.2-5.6 3-5.6 1.9 0 1.3 11 3.1 11 2.1 0 1.6-14 3.5-14 1.9 0 1.2 16.6 3.3 16.6 1.9 0 1.2-12 3.2-12 1.8 0 1.1 5 2.7 5" strokeWidth="2.1" />
    </svg>
  );
}

export function AlertTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <path d="M7 17.5V10a5 5 0 0 1 10 0v7.5l2 1.5H5l2-1.5Z" strokeWidth="1.9" />
      <path d="M10 21h4" strokeWidth="2.2" />
    </svg>
  );
}

export function SearchTabIcon(props: IconProps) {
  return (
    <svg {...shared(props)}>
      <circle cx="10.5" cy="10.5" r="6.8" strokeWidth="2" />
      <path d="m16 16 5 5" strokeWidth="2.3" />
    </svg>
  );
}

/** Face shell remains in the middle; eyes and smile spring across toward the selected icon. */
export function YouTabIcon({ gaze, ...props }: IconProps & { gaze: -2 | -1 | 0 | 1 | 2 }) {
  return (
    <svg {...shared(props)}>
      <rect className="tab-face-shell" x="2.5" y="2.5" width="19" height="19" rx="5.4" stroke="none" />
      <g className="tab-face-features" style={{ transform: `translateX(${gaze * 1.4}px)` }} stroke="none">
        <rect x="7.9" y="8.4" width="2.2" height="4.3" rx="0.6" fill="#1F1B2C" />
        <rect x="13.9" y="8.4" width="2.2" height="4.3" rx="0.6" fill="#1F1B2C" />
        <path d="M7.7 15.25c2.3 2.6 6.3 2.6 8.6 0" stroke="#1F1B2C" strokeWidth="1.7" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
