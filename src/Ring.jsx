import { motion, useReducedMotion } from 'framer-motion'

// A small progress ring: how much of the day's routine is kept.
export default function Ring({ value, max, size = 32 }) {
  const reduced = useReducedMotion()
  const r = 16
  const circumference = 2 * Math.PI * r
  const share = max ? value / max : 0
  const full = value > 0 && value === max

  return (
    <svg className={`ring${full ? ' full' : ''}`} viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <motion.circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
        strokeDasharray={circumference}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - share) }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
      />
    </svg>
  )
}
