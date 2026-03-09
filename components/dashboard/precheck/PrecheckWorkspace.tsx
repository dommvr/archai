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

import { PrecheckRunsList }          from './PrecheckRunsList'
import { CreatePrecheckRunDialog }   from './CreatePrecheckRunDialog'
import { SiteContextForm }           from './SiteContextForm'
import { DocumentUploadPanel }       from './DocumentUploadPanel'
import { RuleExtractionStatusCard }  from './RuleExtractionStatusCard'
import { SpeckleModelPicker }        from './SpeckleModelPicker'
import { PrecheckProgressCard }      from './PrecheckProgressCard'
import { ReadinessScoreCard }        from './ReadinessScoreCard'
import { ComplianceIssuesTable }     from './ComplianceIssuesTable'
import { ComplianceIssueDrawer }     from './ComplianceIssueDrawer'
import { PermitChecklistCard }       from './PermitChecklistCard'
import { PrecheckViewerPanel }       from './PrecheckViewerPanel'

type Tab = 'setup' | 'issues' | 'checklist'

// Demo project ID — replace with real project selector when projects feature is built
const DEMO_PROJECT_ID = '00000000-0000-0000-0000-000000000001'

interface PrecheckWorkspaceProps {
  user: AuthUser
}

export function PrecheckWorkspace({ user }: PrecheckWorkspaceProps) {
  const [runs,           setRuns]           = useState<PrecheckRun[]>([])
  const [selectedRunId,  setSelectedRunId]  = useState<string | null>(null)
  const [runDetails,     setRunDetails]     = useState<GetRunDetailsResponse | null>(null)
  const [selectedIssue,  setSelectedIssue]  = useState<ComplianceIssue | null>(null)
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [createOpen,     setCreateOpen]     = useState(false)
  const [activeTab,      setActiveTab]      = useState<Tab>('setup')
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [extracting,     setExtracting]     = useState(false)

  const projectId = DEMO_PROJECT_ID

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

  useEffect(() => {
    if (selectedRunId) {
      void fetchRunDetails(selectedRunId)
    } else {
      setRunDetails(null)
    }
  }, [selectedRunId, fetchRunDetails])

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreateRun(pid: string, uid: string) {
    await precheckApi.createPrecheckRun({ projectId: pid, createdBy: uid })
    // FASTAPI CALL PLACEHOLDER — backend returns the persisted run; stub inserts locally
    const newRun: PrecheckRun = {
      id:                crypto.randomUUID(),
      projectId:         pid,
      status:            'created',
      createdBy:         uid,
      createdAt:         new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
      siteContextId:     null,
      speckleModelRefId: null,
      readinessScore:    null,
    }
    setRuns((prev) => [newRun, ...prev])
    setSelectedRunId(newRun.id)
    setActiveTab('setup')
  }

  async function handleIngestSite(input: IngestSiteInput) {
    await precheckApi.ingestSite(input)
    // FASTAPI CALL PLACEHOLDER
    if (selectedRunId) void fetchRunDetails(selectedRunId)
  }

  async function handleIngestDocuments(documentIds: string[]) {
    if (!selectedRunId) return
    await precheckApi.ingestDocuments({ runId: selectedRunId, documentIds })
    // FASTAPI CALL PLACEHOLDER
    void fetchRunDetails(selectedRunId)
  }

  async function handleExtractRules() {
    if (!selectedRunId) return
    setExtracting(true)
    try {
      await precheckApi.extractRules({ runId: selectedRunId })
      // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
      void fetchRunDetails(selectedRunId)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSyncModel(input: SyncSpeckleModelInput) {
    await precheckApi.syncSpeckleModel(input)
    // SPECKLE VIEWER WILL BE MOUNTED HERE
    if (selectedRunId) void fetchRunDetails(selectedRunId)
  }

  async function handleEvaluate() {
    if (!selectedRunId) return
    await precheckApi.evaluateCompliance({ runId: selectedRunId })
    // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
    void fetchRunDetails(selectedRunId)
    setActiveTab('issues')
  }

  function handleSelectIssue(issue: ComplianceIssue) {
    setSelectedIssue(issue)
    setDrawerOpen(true)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const run       = runDetails?.run     ?? null
  const issues    = runDetails?.issues  ?? []
  const checklist = runDetails?.checklist ?? []
  // READY FOR TOOL 1 INTEGRATION HERE — rules will come from run details once backend is wired
  const rules: ExtractedRule[] = []

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'setup',     label: 'Setup'     },
    { id: 'issues',    label: 'Issues',   count: issues.length    || undefined },
    { id: 'checklist', label: 'Checklist', count: checklist.length || undefined },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left: 3D Viewer */}
      <div className="flex-1 min-w-0 relative">
        <PrecheckViewerPanel selectedIssue={selectedIssue} />
      </div>

      {/* Right: Control Panel */}
      <aside className="w-[360px] shrink-0 bg-archai-charcoal border-l border-archai-graphite flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-archai-graphite flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Code Checker</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Smart Zoning &amp; Permit Pre-Check</p>
          </div>
          <Button
            variant="archai"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            New Run
          </Button>
        </div>

        {/* Run selector */}
        <div className="shrink-0 px-4 py-3 border-b border-archai-graphite">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Runs</p>
            {selectedRunId && (
              <button
                onClick={() => void fetchRunDetails(selectedRunId)}
                className="text-muted-foreground hover:text-white transition-colors"
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
        </div>

        {/* Score + progress — only when a run is selected */}
        {selectedRunId && (
          <div className="shrink-0 px-4 py-3 border-b border-archai-graphite space-y-3">
            <ReadinessScoreCard score={runDetails?.run.readinessScore} isLoading={loadingDetails} />
            <PrecheckProgressCard run={run} isLoading={loadingDetails} />
          </div>
        )}

        {/* Tabs */}
        {selectedRunId && (
          <>
            <div className="shrink-0 flex border-b border-archai-graphite">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex-1 py-2 text-xs font-medium transition-colors relative',
                    activeTab === tab.id
                      ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-archai-orange'
                      : 'text-muted-foreground hover:text-white',
                  )}
                >
                  {tab.label}
                  {tab.count != null && (
                    <span className="ml-1 text-[10px] bg-archai-graphite rounded-full px-1.5">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
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

        {/* Empty state — no run selected */}
        {!selectedRunId && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">Select a run or start a new check</p>
              <Button variant="archai" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Start New Check
              </Button>
            </div>
          </div>
        )}
      </aside>

      {/* Modals */}
      <CreatePrecheckRunDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        userId={user.id}
        onCreate={handleCreateRun}
      />

      <ComplianceIssueDrawer
        issue={selectedIssue}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  )
}
