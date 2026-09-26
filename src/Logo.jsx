// A completion ring around a check: one routine, done, and coming round again.
// The ring draws itself on mount — see .logo in styles.css.
export default function Logo({ size = 56, animate = true }) {
  return (
    <svg
      className={animate ? 'logo' : 'logo still'}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Daily Routines"
    >
      <defs>
        <linearGradient id="dr-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#47a077" />
          <stop offset="1" stopColor="#225a44" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#dr-fill)" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="#fff" strokeOpacity=".24" strokeWidth="26" />
      <path
        className="ring"
        d="M256,106 A150,150 0 1 1 106,256"
        fill="none"
        stroke="#fff"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <path
        className="tick"
        d="M200,262 L238,300 L315,214"
        fill="none"
        stroke="#fff"
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
