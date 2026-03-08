'use client'

import { useMetrics } from '@/hooks/useMetrics'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react'
import { formatCarbon, formatCompact } from '@/lib/utils'

interface MetricsPanelProps {
  projectId?: string
}

export function MetricsPanel({ projectId }: MetricsPanelProps) {
  const metrics = useMetrics(projectId)

  const codeRiskVariant = {
    low: 'risk_low',
    medium: 'risk_medium',
    high: 'risk_high',
  }[metrics.codeRisk] as 'risk_low' | 'risk_medium' | 'risk_high'

  return (
    <div className="p-4">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-archai-orange" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider">
            Live Metrics
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">
          {/* SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER */}
          live
        </span>
      </div>

      <div className="space-y-3">
        {/* GFA */}
        <MetricCard
          label="GFA"
          value={formatCompact(metrics.gfa)}
          unit="m²"
          trend="up"
          description="Gross Floor Area"
        />

        {/* Embodied Carbon */}
        <MetricCard
          label="Carbon"
          value={formatCarbon(metrics.carbon)}
          trend="neutral"
          description="Embodied carbon estimate"
          valueColor={metrics.carbon > 400000 ? 'text-red-400' : metrics.carbon > 300000 ? 'text-amber-400' : 'text-emerald-400'}
        />

        {/* Efficiency */}
        <div className="rounded-md border border-archai-graphite bg-archai-black/40 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Efficiency</span>
            <span className="text-sm font-semibold text-white">{metrics.efficiency.toFixed(0)}%</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 rounded-full bg-archai-graphite overflow-hidden">
            <div
              className="h-full rounded-full bg-archai-orange transition-all duration-700"
              style={{ width: `${metrics.efficiency}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/50 mt-1 block">Space efficiency</span>
        </div>

        {/* Code Risk */}
        <div className="rounded-md border border-archai-graphite bg-archai-black/40 p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider block mb-1">Code Risk</span>
              <span className="text-[10px] text-muted-foreground/50">Based on last analysis</span>
            </div>
            <Badge variant={codeRiskVariant} className="uppercase text-[10px] tracking-wider">
              {metrics.codeRisk}
            </Badge>
          </div>
        </div>
      </div>

      {/* READY FOR LIVE METRICS INTEGRATION HERE */}
      {/* FASTAPI CALL PLACEHOLDER — metrics should update via Supabase realtime */}
    </div>
  )
}

interface MetricCardProps {
  label: string
  value: string
  unit?: string
  trend: 'up' | 'down' | 'neutral'
  description: string
  valueColor?: string
}

function MetricCard({ label, value, unit, trend, description, valueColor = 'text-white' }: MetricCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-muted-foreground/50'

  return (
    <div className="rounded-md border border-archai-graphite bg-archai-black/40 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider block mb-0.5">{label}</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-semibold tabular-nums ${valueColor}`}>{value}</span>
            {unit && <span className="text-xs text-muted-foreground/60">{unit}</span>}
          </div>
          <span className="text-[10px] text-muted-foreground/50">{description}</span>
        </div>
        <TrendIcon className={`h-4 w-4 ${trendColor}`} />
      </div>
    </div>
  )
}
