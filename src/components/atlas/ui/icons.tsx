const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconSearch = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconList = () => (
  <svg {...base}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const IconInfo = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const IconTrain = () => (
  <svg {...base}>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 10h14M9 20l-2 2M15 20l2 2M8.5 13h.01M15.5 13h.01" />
  </svg>
);

export const IconClose = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconPlay = () => (
  <svg {...base}>
    <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = () => (
  <svg {...base}>
    <path d="M8 5v14M16 5v14" strokeWidth={3} />
  </svg>
);

export const IconPrev = () => (
  <svg {...base}>
    <path d="M6 5v14" strokeWidth={2.4} />
    <path d="M19 5v14L9 12z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconNext = () => (
  <svg {...base}>
    <path d="M18 5v14" strokeWidth={2.4} />
    <path d="M5 5v14l10-7z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRestart = () => (
  <svg {...base}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
  </svg>
);

export const IconArrow = () => (
  <svg {...base}>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

/** Logomark: three contour lines stacked into a hill. */
export const Logomark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M3 25c4-.5 6-3 9-3s5 2.5 9 2.5 5-1.5 8-1.5" />
    <path d="M7 19c3-.4 4.5-4.5 8-4.5s4.5 3.8 7.5 4" />
    <path d="M12 12.5c1.5-.4 2.3-4 4.5-4s2.8 3.1 4 3.6" />
  </svg>
);
