'use client'

/**
 * RightPanel — contextual tabbed panel for the main workspace.
 *
 * Tabs:
 *   Copilot     — AI chat assistant (always available)
 *   Metrics     — live project metrics
 *   Issues      — compliance issues (populated when a precheck run is active)
 *   Checklist   — permit checklist (populated when a precheck run is active)
 *   Run Details — precheck run progress / readiness (populated when a precheck run is active)
 *
 * The active tab can be controlled externally via `activeTab` + `onTabChange`
 * (so that e.g. clicking an issue auto-switches to "Issues").
 * When uncontrolled, the component manages its own tab state.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChatPanel } from './ChatPanel'
import { MetricsPanel } from './MetricsPanel'
import {
  Bot,
  Zap,
  AlertTriangle,
  ClipboardList,
  ActivitySquare,
} from 'lucide-react'
import type { ComplianceIssue, PermitChecklistItem, PrecheckRun } from '@/lib/precheck/types'
import { ComplianceIssuesTable } from './precheck/ComplianceIssuesTable'
import { PermitChecklistCard } from './precheck/PermitChecklistCard'
import { ReadinessScoreCard } from './precheck/ReadinessScoreCard'
import { PrecheckProgressCard } from './precheck/PrecheckProgressCard'

export type RightPanelTab = 'copilot' | 'metrics' | 'issues' | 'checklist' | 'run-details'

interface RightPanelProps {
  projectId?: string
  /** Controlled active tab. Falls back to internal state when undefined. */
  activeTab?: RightPanelTab
  onTabChange?: (tab: RightPanelTab) => void
  /** Precheck data — only relevant when on the precheck tool route. */
  precheckContext?: {
    run: PrecheckRun | null
    issues: ComplianceIssue[]
    checklist: PermitChecklistItem[]
    isLoading: boolean
    hasSiteContext: boolean
    hasDocuments: boolean
    hasRules: boolean
    hasModelRef: boolean
    hasGeometrySnapshot: boolean
    onSelectIssue?: (issue: ComplianceIssue) => void
  }
}

interface TabDef {
  id: RightPanelTab
  label: string
  Icon: React.ComponentType<{ className?: string }>
}

const TABS: TabDef[] = [
  { id: 'copilot',     label: 'Copilot',     Icon: Bot           },
  { id: 'metrics',     label: 'Metrics',     Icon: Zap           },
  { id: 'issues',      label: 'Issues',      Icon: AlertTriangle  },
  { id: 'checklist',   label: 'Checklist',   Icon: ClipboardList  },
  { id: 'run-details', label: 'Run',         Icon: ActivitySquare },
]

export function RightPanel({
  projectId,
  activeTab: controlledTab,
  onTabChange,
  precheckContext,
}: RightPanelProps) {
  const [internalTab, setInternalTab] = useState<RightPanelTab>('copilot')
  const activeTab = controlledTab ?? internalTab

  const setTab = (tab: RightPanelTab) => {
    if (onTabChange) {
      onTabChange(tab)
    } else {
      setInternalTab(tab)
    }
  }

  // Tabs that are contextual and only meaningful when precheck data is present
  const precheckTabs: RightPanelTab[] = ['issues', 'checklist', 'run-details']
  const hasPrecheckContext = Boolean(precheckContext)

  return (
    <div className="flex flex-col h-full bg-archai-charcoal overflow-hidden">
      {/* Tab strip */}
      <div className="flex shrink-0 border-b border-archai-graphite overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => {
          const isPrecheckOnly = precheckTabs.includes(id)
          const disabled = isPrecheckOnly && !hasPrecheckContext
          const isActive = activeTab === id

          // Badge counts
          const badge =
            id === 'issues' && precheckContext?.issues.length
              ? precheckContext.issues.length
              : id === 'checklist' && precheckContext?.checklist.length
                ? precheckContext.checklist.length
                : undefined

          return (
            <button
              key={id}
              onClick={() => !disabled && setTab(id)}
              disabled={disabled}
              className={cn(
                'relative flex items-center gap-1 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap transition-colors flex-1 justify-center',
                isActive
                  ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-archai-orange'
                  : disabled
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-white',
              )}
              aria-current={isActive ? 'true' : undefined}
              title={disabled ? `Available during an active precheck run` : label}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
              {badge != null && (
                <span className="ml-0.5 rounded-full bg-archai-graphite px-1.5 text-[10px] leading-tight">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'copilot' && (
          <ChatPanel />
        )}

        {activeTab === 'metrics' && (
          <div className="h-full overflow-y-auto">
            <MetricsPanel projectId={projectId} />
          </div>
        )}

        {activeTab === 'issues' && (
          <div className="h-full overflow-y-auto p-4">
            {hasPrecheckContext ? (
              <ComplianceIssuesTable
                issues={precheckContext!.issues}
                onSelectIssue={precheckContext!.onSelectIssue ?? (() => {})}
                isLoading={precheckContext!.isLoading}
              />
            ) : (
              <EmptyPrecheckState label="issues" />
            )}
          </div>
        )}

        {activeTab === 'checklist' && (
          <div className="h-full overflow-y-auto p-4">
            {hasPrecheckContext ? (
              <PermitChecklistCard
                items={precheckContext!.checklist}
                isLoading={precheckContext!.isLoading}
              />
            ) : (
              <EmptyPrecheckState label="checklist" />
            )}
          </div>
        )}

        {activeTab === 'run-details' && (
          <div className="h-full overflow-y-auto space-y-3 p-4">
            {hasPrecheckContext ? (
              <>
                <ReadinessScoreCard
                  score={precheckContext!.run?.readinessScore}
                  isLoading={precheckContext!.isLoading}
                />
                <PrecheckProgressCard
                  run={precheckContext!.run}
                  hasSiteContext={precheckContext!.hasSiteContext}
                  hasDocuments={precheckContext!.hasDocuments}
                  hasRules={precheckContext!.hasRules}
                  hasModelRef={precheckContext!.hasModelRef}
                  hasGeometrySnapshot={precheckContext!.hasGeometrySnapshot}
                  isLoading={precheckContext!.isLoading}
                />
              </>
            ) : (
              <EmptyPrecheckState label="run details" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyPrecheckState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-muted-foreground text-center">
        Open a precheck run to see {label}.
      </p>
    </div>
  )
}
