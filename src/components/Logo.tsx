export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="logo"
    >
      <defs>
        <linearGradient id="nf-logo-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0071e3" />
          <stop offset="100%" stopColor="#005bb5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#nf-logo-grad)" />
      <path
        d="M20 14h18l8 8v28a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z"
        fill="#ffffff"
      />
      <path d="M38 14l8 8h-8z" fill="#d2e3fc" />
      <rect x="24" y="26" width="16" height="2.6" rx="1.3" fill="#0071e3" />
      <rect x="24" y="32" width="16" height="2.6" rx="1.3" fill="#0071e3" />
      <rect x="24" y="38" width="10" height="2.6" rx="1.3" fill="#0071e3" />
      <circle cx="39.5" cy="39.3" r="3.4" fill="#0071e3" />
      <path
        d="M38.2 39.4l1 1 1.8-2"
        stroke="#ffffff"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
