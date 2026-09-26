import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const THRESHOLD = 64
const MAX = 96

// Pull down at the top of the page to reload. Worth having because a PWA
// launched from the home screen has no browser chrome — and so no reload button.
export default function PullToRefresh({ onRefresh }) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const startY = useRef(null)
  const pulled = useRef(0)
  const working = useRef(false)

  useEffect(() => {
    const set = (v) => {
      pulled.current = v
      setPull(v)
    }

    const onStart = (e) => {
      if (working.current || window.scrollY > 0) return
      startY.current = e.touches[0].clientY
    }

    const onMove = (e) => {
      if (startY.current === null) return
      const delta = e.touches[0].clientY - startY.current
      // scrolling up, or the page moved off the top: this is not a pull
      if (delta <= 0 || window.scrollY > 0) {
        startY.current = null
        return set(0)
      }
      e.preventDefault() // hold the page still while the gesture owns it
      set(Math.min(MAX, delta * 0.45)) // resistance, so it never feels loose
    }

    const onEnd = async () => {
      if (startY.current === null) return
      startY.current = null
      if (pulled.current < THRESHOLD) return set(0)
      working.current = true
      setBusy(true)
      set(THRESHOLD)
      try {
        await onRefresh()
      } finally {
        working.current = false
        setBusy(false)
        set(0)
      }
    }

    // touchmove must not be passive or preventDefault is ignored
    addEventListener('touchstart', onStart, { passive: true })
    addEventListener('touchmove', onMove, { passive: false })
    addEventListener('touchend', onEnd)
    addEventListener('touchcancel', onEnd)
    return () => {
      removeEventListener('touchstart', onStart)
      removeEventListener('touchmove', onMove)
      removeEventListener('touchend', onEnd)
      removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  const ready = pull >= THRESHOLD

  return (
    <div className="ptr" style={{ height: pull }} role="status" aria-live="polite">
      {pull > 0 && (
        <motion.svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          className={ready || busy ? 'ready' : ''}
          style={{ opacity: Math.min(1, pull / 40) }}
          animate={busy ? { rotate: 360 } : { rotate: (pull / THRESHOLD) * 270 }}
          transition={busy ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { type: 'spring', stiffness: 300, damping: 30 }}
        >
          <path
            d="M12 4a8 8 0 1 1-7.5 5.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </motion.svg>
      )}
      <span className="sr">{busy ? 'Refreshing' : ready ? 'Release to refresh' : ''}</span>
    </div>
  )
}
