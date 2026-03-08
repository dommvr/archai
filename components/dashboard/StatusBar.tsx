'use client'

import { useState, useEffect } from 'react'
import { Wifi, WifiOff, Clock, Cpu } from 'lucide-react'

export function StatusBar() {
  const [syncTime, setSyncTime] = useState(3)
  const [connected, setConnected] = useState(true)

  // Simulate sync time counter for demo purposes
  // SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER — replace with actual sync events
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncTime((t) => (t >= 60 ? 1 : t + 3))
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const syncLabel = syncTime < 60 ? `${syncTime}s ago` : 'just now'

  return (
    <div className="h-7 bg-archai-black border-t border-archai-graphite/60 flex items-center px-4 gap-6 text-[11px] text-muted-foreground/70 select-none overflow-hidden">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {connected ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <Wifi className="h-3 w-3" />
            <span>Connected to Speckle</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <WifiOff className="h-3 w-3" />
            <span>Disconnected</span>
          </>
        )}
      </div>

      <span className="text-archai-graphite">·</span>

      {/* Model sync */}
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        <span>Model synced {syncLabel}</span>
      </div>

      <span className="text-archai-graphite">·</span>

      {/* AI status */}
      <div className="flex items-center gap-1.5">
        <Cpu className="h-3 w-3 text-archai-orange/70" />
        <span className="text-archai-orange/70">AI ready</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: version info */}
      <span className="text-muted-foreground/40">ArchAI v0.1.0</span>
    </div>
  )
}
