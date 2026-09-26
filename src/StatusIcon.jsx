import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// Shows the level; it never sets it — the dropdown or the checkbox does that.
// Shape carries the meaning as much as colour, so the row still reads in
// greyscale or to a colourblind eye.
const SHAPES = {
  // dashed ring: nothing recorded yet
  '': (
    <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2.6" />
  ),
  // clock: prayed, but late
  sholat: (
    <>
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 5.9V10l2.7 1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // filled check: on time, or a habit done
  ontime: (
    <>
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      <path
        d="M6.3 10.4l2.5 2.5 4.9-5.3"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // masjid: on time, in the masjid
  masjid: (
    <>
      <circle cx="10" cy="3.4" r="1.05" fill="currentColor" />
      <path d="M4.6 17v-4.1a5.4 5.4 0 0 1 10.8 0V17z" fill="currentColor" />
      <rect x="1.7" y="8.6" width="1.7" height="8.4" rx="0.85" fill="currentColor" />
      <rect x="16.6" y="8.6" width="1.7" height="8.4" rx="0.85" fill="currentColor" />
    </>
  ),
  // struck-through ring: not owed today, so neither kept nor missed
  haid: (
    <>
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 10h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
}
SHAPES.done = SHAPES.ontime

export default function StatusIcon({ level, title }) {
  const reduced = useReducedMotion()
  const key = level || ''

  return (
    <span className={`status lv-${key || 'none'}`} title={title}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={key}
          viewBox="0 0 20 20"
          width="18"
          height="18"
          role="img"
          aria-hidden="true"
          initial={reduced ? false : { scale: 0.55, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { scale: 0.55, opacity: 0 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 24 }}
        >
          {SHAPES[key]}
        </motion.svg>
      </AnimatePresence>
    </span>
  )
}
