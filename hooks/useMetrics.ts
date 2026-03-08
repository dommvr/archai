'use client'

import { useState, useEffect, useRef } from 'react'
import type { Metrics } from '@/types'

const DEMO_BASE: Metrics = {
  gfa: 4250,
  carbon: 312000,
  efficiency: 78,
  codeRisk: 'low',
}

/**
 * Hook that provides live metrics data for the dashboard metrics panel.
 *
 * Currently returns simulated live updates for demo purposes.
 * When the backend is implemented, this hook should:
 * 1. Subscribe to a Supabase realtime channel for the active project
 * 2. Update metrics as the model changes in real-time
 *
 * SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER
 * READY FOR LIVE METRICS INTEGRATION HERE
 */
export function useMetrics(projectId?: string) {
  const [metrics, setMetrics] = useState<Metrics>(DEMO_BASE)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Demo: small random fluctuations to simulate live model updates
    // Replace this with a Supabase realtime subscription when backend is ready
    intervalRef.current = setInterval(() => {
      setMetrics((prev) => ({
        gfa: prev.gfa + Math.floor((Math.random() - 0.48) * 20),
        carbon: prev.carbon + Math.floor((Math.random() - 0.48) * 500),
        efficiency: Math.min(99, Math.max(50, prev.efficiency + (Math.random() - 0.5) * 2)),
        codeRisk: prev.codeRisk, // Code risk only changes on explicit analysis
      }))
    }, 4000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [projectId])

  return metrics
}
