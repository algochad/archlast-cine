import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 24,
    height: 24,
    ...props,
  };
}

export const PlayIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l13-7.5-13-7.5z" />
  </svg>
);

export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M12 11v5" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const ChevronLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="m14 6-6 6 6 6" />
  </svg>
);

export const ChevronRight = (p: P) => (
  <svg {...base(p)}>
    <path d="m10 6 6 6-6 6" />
  </svg>
);

export const ChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5m7-7-7 7 7 7" />
  </svg>
);

export const StarIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5 6.2 20.5l1.1-6.5-4.7-4.6 6.5-.95L12 2.5z" />
  </svg>
);

export const VolumeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const VolumeMuteIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="m16 9 6 6m0-6-6 6" />
  </svg>
);

export const FullscreenIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />
  </svg>
);

export const FullscreenExitIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 3v4a2 2 0 0 1-2 2H3m18 0h-4a2 2 0 0 1-2-2V3M9 21v-4a2 2 0 0 0-2-2H3m18 0h-4a2 2 0 0 0-2 2v4" />
  </svg>
);

export const Spinner = (p: P) => (
  <svg {...base(p)} strokeWidth={3}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4m8-4v4M3 10h18" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12 5 5L20 7" />
  </svg>
);

export const ClapperIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8.5 8.5 3 15 6l-6 4.5L3 8.5z" />
    <path d="m8.5 3 2.5 6M15 6l3 1.5L14.5 12M3 8.5V19a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 19v-6.5" />
  </svg>
);

/** Subtitles caption panel: squared box with two caption lines. */
export const CcIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M6.5 10h11M6.5 14h7.5" />
  </svg>
);

export const RewindIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 19 4 12l7-7" />
    <path d="M20 19 13 12l7-7" />
  </svg>
);

export const ForwardIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m13 5 7 7-7 7" />
    <path d="m4 5 7 7-7 7" />
  </svg>
);

export const ReplayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12A8 8 0 1 1 12 4" />
    <path d="M20 4v6h-6" />
  </svg>
);

export const StepBackIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 5v14" />
    <path d="M14 12 6 7v10l8-5z" />
  </svg>
);

export const StepFwdIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 5v14" />
    <path d="M10 12 18 7v10l-8-5z" />
  </svg>
);

export const LockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const UnlockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 4-4h.01" />
  </svg>
);

export const PipIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="6" height="5" rx="1" />
  </svg>
);

export const CastIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="13" rx="2" />
    <path d="M4 17a8 8 0 0 1 8-8" />
    <path d="M4 13a4 4 0 0 1 4-4" />
  </svg>
);

export const StatsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 17V9M9 17V5M13 17v-7M17 17v-4" />
    <path d="M3 17h18" />
  </svg>
);

export const AspectIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M7 3v3M7 18v3M17 3v3M17 18v3" />
    <path d="M3 10H1M3 14H1M21 10h2M21 14h2" />
  </svg>
);

export const PrevEpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 5v14" />
    <path d="M13 12 5 6v12l8-6z" />
  </svg>
);

export const NextEpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 5v14" />
    <path d="M11 12 19 6v12l-8-6z" />
  </svg>
);

export const BoostIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="M15 10a5 5 0 0 1 0 4" />
    <path d="M18 7a8.5 8.5 0 0 1 0 10" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 1.5v2.2M12 18.3v2.2M3.6 7l1.9 1.1M18.5 15.9l1.9 1.1M1.5 12h2.2M18.3 12h2.2M3.6 17l1.9-1.1M18.5 8.1l1.9-1.1M7 3.6l1.1 1.9M15.9 18.5l1.1 1.9M17 3.6l-1.1 1.9M8.1 18.5l-1.1 1.9" />
  </svg>
);
