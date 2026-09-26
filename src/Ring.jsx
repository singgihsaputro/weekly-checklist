import { motion, useReducedMotion } from 'framer-motion'

// A small progress ring: how much of the day's routine is kept.
export default function Ring({ value, max, size = 32 }) {
  const reduced = useReducedMotion()
  const r = 16
  const circumference = 2 * Math.PI * r
  const share = max ? value / max : 0
  const full = value > 0 && value === max

  return (
    <motion.svg
      className={`ring${full ? ' full' : ''}`}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      animate={full && !reduced ? { scale: [1, 1.18, 1] } : { scale: 1 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.3, 1] }}
    >
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
      {full && (
        <motion.path
          d="M13 20.5l4.6 4.6 9-9.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 0.1 }}
        />
      )}
    </motion.svg>
  )
}
