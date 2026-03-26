'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface UseHorizontalSplitOptions {
  storageKey: string
  defaultPercent?: number
  min?: number
  max?: number
}

/**
 * useHorizontalSplit — drag state + localStorage persistence for a horizontal
 * two-panel split. Returns a containerRef to attach to the wrapper div, the
 * current leftPercent value, and a mousedown handler for the drag divider.
 *
 * Mirrors useVerticalSplit but tracks X position and container width.
 * Drag is disabled on viewports narrower than 640 px (sm breakpoint).
 */
export function useHorizontalSplit({
  storageKey,
  defaultPercent = 75,
  min = 30,
  max = 85,
}: UseHorizontalSplitOptions) {
  const containerRef = useRef<HTMLDivElement>(null)

  const [leftPercent, setLeftPercent] = useState(defaultPercent)

  // Restore persisted ratio after mount (avoids SSR/window access issues).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        const n = parseFloat(saved)
        if (!isNaN(n)) setLeftPercent(Math.max(min, Math.min(max, n)))
      }
    } catch {
      // localStorage may be unavailable in some environments — fail silently.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Always-fresh ref so the mousemove closure never reads stale state.
  const leftPercentRef = useRef(leftPercent)
  useEffect(() => {
    leftPercentRef.current = leftPercent
  }, [leftPercent])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Disable drag on narrow viewports.
      if (typeof window !== 'undefined' && window.innerWidth < 640) return

      e.preventDefault()

      const startX = e.clientX
      const startPercent = leftPercentRef.current

      // Suppress text selection and show the resize cursor globally during drag.
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      function onMouseMove(ev: MouseEvent) {
        if (!containerRef.current) return
        const containerW = containerRef.current.getBoundingClientRect().width
        if (containerW === 0) return
        const deltaPercent = ((ev.clientX - startX) / containerW) * 100
        const next = Math.max(min, Math.min(max, startPercent + deltaPercent))
        setLeftPercent(next)
        leftPercentRef.current = next
      }

      function onMouseUp() {
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        try {
          localStorage.setItem(storageKey, String(leftPercentRef.current))
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

  return { containerRef, leftPercent, handleMouseDown }
}
