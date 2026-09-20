export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="logo"
    >
      <defs>
        <linearGradient id="nf-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0071e3" />
          <stop offset="100%" stopColor="#5856d6" />
        </linearGradient>
        <linearGradient id="nf-sheet-back" x1="16" y1="12" x2="48" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="nf-flow" x1="22" y1="40" x2="42" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0071e3" />
          <stop offset="100%" stopColor="#ff9f0a" />
        </linearGradient>
        <filter id="nf-shadow" x="8" y="10" width="48" height="48" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* App Icon Canvas */}
      <rect width="64" height="64" rx="15" fill="url(#nf-bg)" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1.5"
      />

      {/* Back Note Sheet (Tilted) */}
      <rect
        x="15"
        y="12"
        width="34"
        height="40"
        rx="5"
        transform="rotate(-5 32 32)"
        fill="url(#nf-sheet-back)"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />

      {/* Front Note Sheet (Main Editorial Canvas) */}
      <g filter="url(#nf-shadow)">
        <rect x="17" y="14" width="30" height="38" rx="4.5" fill="#ffffff" />
        <rect x="22" y="21" width="20" height="2.5" rx="1.25" fill="#1c1c1e" opacity="0.85" />
        <rect x="22" y="27" width="16" height="2.2" rx="1.1" fill="#8e8e93" opacity="0.65" />
        <rect x="22" y="32" width="18" height="2.2" rx="1.1" fill="#8e8e93" opacity="0.65" />
        <path
          d="M22 40c4-2 7 2 11-1s5-3 9-2"
          stroke="url(#nf-flow)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
