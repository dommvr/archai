'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface UseVerticalSplitOptions {
  storageKey: string
  defaultPercent?: number
  min?: number
  max?: number
}

/**
 * useVerticalSplit — drag state + localStorage persistence for a vertical
 * two-panel split. Returns a containerRef to attach to the wrapper div, the
 * current topPercent value, and a mousedown handler for the drag divider.
 *
 * Drag is disabled on viewports narrower than 640 px (sm breakpoint) so the
 * layout degrades gracefully on mobile without any broken drag behaviour.
 */
export function useVerticalSplit({
  storageKey,
  defaultPercent = 40,
  min = 15,
  max = 85,
}: UseVerticalSplitOptions) {
  const containerRef = useRef<HTMLDivElement>(null)

  const [topPercent, setTopPercent] = useState(defaultPercent)

  // Restore persisted ratio after mount (avoids SSR/window access issues).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        const n = parseFloat(saved)
        if (!isNaN(n)) setTopPercent(Math.max(min, Math.min(max, n)))
      }
    } catch {
      // localStorage may be unavailable in some environments — fail silently.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Always-fresh ref so the mousemove closure never reads stale state.
  const topPercentRef = useRef(topPercent)
  useEffect(() => {
    topPercentRef.current = topPercent
  }, [topPercent])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Disable drag on narrow viewports.
      if (typeof window !== 'undefined' && window.innerWidth < 640) return

      e.preventDefault()

      const startY = e.clientY
      const startPercent = topPercentRef.current

      // Suppress text selection and show the resize cursor globally during drag.
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      function onMouseMove(ev: MouseEvent) {
        if (!containerRef.current) return
        const containerH = containerRef.current.getBoundingClientRect().height
        if (containerH === 0) return
        const deltaPercent = ((ev.clientY - startY) / containerH) * 100
        const next = Math.max(min, Math.min(max, startPercent + deltaPercent))
        setTopPercent(next)
        topPercentRef.current = next
      }

      function onMouseUp() {
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        try {
          localStorage.setItem(storageKey, String(topPercentRef.current))
        } catch {
          // Ignore write failures.
        }
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [min, max, storageKey],
  )

  return { containerRef, topPercent, handleMouseDown }
}
