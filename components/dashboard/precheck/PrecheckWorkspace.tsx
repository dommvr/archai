'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type {
  ComplianceIssue,
  ExtractedRule,
  GetRunDetailsResponse,
  IngestSiteInput,
  PrecheckRun,
  SyncSpeckleModelInput,
} from '@/lib/precheck/types'
import type { AuthUser } from '@/types'

import { PrecheckRunsList } from './PrecheckRunsList'
import { CreatePrecheckRunDialog } from './CreatePrecheckRunDialog'
import { SiteContextForm } from './SiteContextForm'
import { DocumentUploadPanel } from './DocumentUploadPanel'
import { RuleExtractionStatusCard } from './RuleExtractionStatusCard'
import { SpeckleModelPicker } from './SpeckleModelPicker'
import { PrecheckProgressCard } from './PrecheckProgressCard'
import { ReadinessScoreCard } from './ReadinessScoreCard'
import { ComplianceIssuesTable } from './ComplianceIssuesTable'
import { ComplianceIssueDrawer } from './ComplianceIssueDrawer'
import { PermitChecklistCard } from './PermitChecklistCard'
import { PrecheckViewerPanel } from './PrecheckViewerPanel'

type Tab = 'setup' | 'issues' | 'checklist'

interface PrecheckWorkspaceProps {
  user: AuthUser
  projectId: string | null
}

export function PrecheckWorkspace({ user, projectId }: PrecheckWorkspaceProps) {
  const [runs, setRuns] = useState<PrecheckRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runDetails, setRunDetails] = useState<GetRunDetailsResponse | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<ComplianceIssue | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('setup')
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const fetchProjectRuns = useCallback(async (preferredRunId?: string) => {
    if (!projectId) {
      setRuns([])
      setSelectedRunId(null)
      return []
    }

    setLoadingRuns(true)
    try {
      const { runs: projectRuns } = await precheckApi.listProjectRuns(projectId)
      setRuns(projectRuns)
      setSelectedRunId((current) => {
        if (preferredRunId && projectRuns.some((run) => run.id === preferredRunId)) {
          return preferredRunId
        }
        if (current && projectRuns.some((run) => run.id === current)) {
          return current
        }
        return projectRuns[0]?.id ?? null
      })
      return projectRuns
    } catch (err) {
      console.error('[PrecheckWorkspace] Failed to fetch project runs:', err)
      return []
    } finally {
      setLoadingRuns(false)
    }
  }, [projectId])

  const fetchRunDetails = useCallback(async (runId: string) => {
    setLoadingDetails(true)
    try {
      const details = await precheckApi.getRunDetails(runId)
      setRunDetails(details)
    } catch (err) {
      console.error('[PrecheckWorkspace] Failed to fetch run details:', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  const refreshRunState = useCallback(async (runId: string) => {
    await Promise.all([
      fetchProjectRuns(runId),
      fetchRunDetails(runId),
    ])
  }, [fetchProjectRuns, fetchRunDetails])

  useEffect(() => {
    if (!projectId) {
      setRuns([])
      setSelectedRunId(null)
      setRunDetails(null)
      return
    }

    void fetchProjectRuns()
  }, [projectId, fetchProjectRuns])

  useEffect(() => {
    if (selectedRunId) {
      void fetchRunDetails(selectedRunId)
      return
    }

    setRunDetails(null)
  }, [selectedRunId, fetchRunDetails])

  async function handleCreateRun(pid: string, uid: string) {
    const run = await precheckApi.createPrecheckRun({ projectId: pid, createdBy: uid })
    await refreshRunState(run.id)
    setSelectedRunId(run.id)
    setActiveTab('setup')
  }

  async function handleIngestSite(input: IngestSiteInput) {
    await precheckApi.ingestSite(input)
    if (selectedRunId) {
      await refreshRunState(selectedRunId)
    }
  }

  async function handleIngestDocuments(documentIds: string[]) {
    if (!selectedRunId) return
    await precheckApi.ingestDocuments({ runId: selectedRunId, documentIds })
    await refreshRunState(selectedRunId)
  }

  async function handleExtractRules() {
    if (!selectedRunId) return
    setExtracting(true)
    try {
      await precheckApi.extractRules({ runId: selectedRunId })
      // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
      await refreshRunState(selectedRunId)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSyncModel(input: SyncSpeckleModelInput) {
    await precheckApi.syncSpeckleModel(input)
    // SPECKLE VIEWER WILL BE MOUNTED HERE
    if (selectedRunId) {
      await refreshRunState(selectedRunId)
    }
  }

  async function handleEvaluate() {
    if (!selectedRunId) return
    await precheckApi.evaluateCompliance({ runId: selectedRunId })
    // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
    await refreshRunState(selectedRunId)
    setActiveTab('issues')
  }

  function handleSelectIssue(issue: ComplianceIssue) {
    setSelectedIssue(issue)
    setDrawerOpen(true)
  }

  const run = runDetails?.run ?? null
  const selectedRun = runs.find((candidate) => candidate.id === selectedRunId) ?? null
  const issues = runDetails?.issues ?? []
  const checklist = runDetails?.checklist ?? []
  const rules: ExtractedRule[] = runDetails?.rules ?? []

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'issues', label: 'Issues', count: issues.length || undefined },
    { id: 'checklist', label: 'Checklist', count: checklist.length || undefined },
  ]

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <PrecheckViewerPanel selectedIssue={selectedIssue} />
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-archai-graphite bg-archai-charcoal">
        <div className="flex shrink-0 items-center justify-between border-b border-archai-graphite px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Code Checker</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Smart Zoning &amp; Permit Pre-Check</p>
          </div>
          <Button
            variant="archai"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setCreateOpen(true)}
            disabled={!projectId}
          >
            <Plus className="mr-1 h-3 w-3" />
            New Run
          </Button>
        </div>

        <div className="shrink-0 border-b border-archai-graphite px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Runs</p>
            {selectedRunId && (
              <button
                onClick={() => void refreshRunState(selectedRunId)}
                className="text-muted-foreground transition-colors hover:text-white"
                aria-label="Refresh run"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
          <PrecheckRunsList
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />
          {loadingRuns && (
            <p className="mt-2 text-[10px] text-muted-foreground">Refreshing runs...</p>
          )}
        </div>

        {selectedRunId && (
          <div className="shrink-0 space-y-3 border-b border-archai-graphite px-4 py-3">
            <ReadinessScoreCard score={run?.readinessScore} isLoading={loadingDetails} />
            <PrecheckProgressCard run={run ?? selectedRun} isLoading={loadingDetails} />
          </div>
        )}

        {selectedRunId && (
          <>
            <div className="flex shrink-0 border-b border-archai-graphite">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex-1 py-2 text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-archai-orange'
                      : 'text-muted-foreground hover:text-white',
                  )}
                >
                  {tab.label}
                  {tab.count != null && (
                    <span className="ml-1 rounded-full bg-archai-graphite px-1.5 text-[10px]">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {activeTab === 'setup' && (
                  <>
                    <SiteContextForm runId={selectedRunId} onSubmit={handleIngestSite} />
                    <DocumentUploadPanel runId={selectedRunId} onDocumentsReady={handleIngestDocuments} />
                    <RuleExtractionStatusCard
                      runId={selectedRunId}
                      rules={rules}
                      canExtract
                      onExtract={handleExtractRules}
                      isExtracting={extracting}
                    />
                    <SpeckleModelPicker runId={selectedRunId} onSync={handleSyncModel} />

                    <Separator />

                    <Button
                      variant="archai"
                      size="sm"
                      className="w-full"
                      onClick={() => void handleEvaluate()}
                      disabled={run?.status === 'completed'}
                    >
                      Run Compliance Check
                    </Button>
                  </>
                )}

                {activeTab === 'issues' && (
                  <ComplianceIssuesTable
                    issues={issues}
                    onSelectIssue={handleSelectIssue}
                    isLoading={loadingDetails}
                  />
                )}

                {activeTab === 'checklist' && (
                  <PermitChecklistCard items={checklist} isLoading={loadingDetails} />
                )}
              </div>
            </ScrollArea>
          </>
        )}

        {!selectedRunId && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">Select a run or start a new check</p>
              <Button
                variant="archai"
                size="sm"
                onClick={() => setCreateOpen(true)}
                disabled={!projectId}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Start New Check
              </Button>
              {!projectId && (
                <p className="text-[10px] text-muted-foreground">
                  Create or select a real project before starting a pre-check run.
                </p>
              )}
            </div>
          </div>
        )}
      </aside>

      {projectId && (
        <CreatePrecheckRunDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={projectId}
          userId={user.id}
          onCreate={handleCreateRun}
        />
      )}

      <ComplianceIssueDrawer
        issue={selectedIssue}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  )
}
