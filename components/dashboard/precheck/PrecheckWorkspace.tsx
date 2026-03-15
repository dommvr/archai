'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
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
import { ResizableVerticalSplit } from '@/components/ui/resizable-vertical-split'

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
  const [syncingModel, setSyncingModel] = useState(false)

  // Ref that always reflects the current selectedRunId without closure staleness.
  // handleSelectRun and fetchProjectRuns read this instead of the closed-over
  // state value so that stale useCallback closures never misfire the early-return
  // guard and cause double-invalidation.
  const selectedRunIdRef = useRef<string | null>(null)

  // Monotonically-increasing counter. Each call to fetchRunDetails increments it
  // and captures the current value. After the async fetch resolves, we compare
  // the captured value against the ref. If they differ, a newer fetch has started
  // (because selectedRunId changed) and this response is stale — we discard it.
  const runDetailsRequestIdRef = useRef(0)
  const runDetailsAbortRef = useRef<AbortController | null>(null)

  const invalidateRunDetails = useCallback((nextLoadingDetails: boolean) => {
    runDetailsAbortRef.current?.abort()
    runDetailsAbortRef.current = null
    runDetailsRequestIdRef.current += 1
    setRunDetails(null)
    setLoadingDetails(nextLoadingDetails)
  }, [])

  // Reads selectedRunIdRef (always fresh) instead of the closed-over state value.
  // This prevents stale useCallback closures from firing when selectedRunId has
  // already been updated by a concurrent state flush — the root cause of the
  // double-invalidation / stuck-loading bug on new-run creation and run-switching.
  const handleSelectRun = useCallback((runId: string) => {
    if (runId === selectedRunIdRef.current) return
    invalidateRunDetails(true)
    setSelectedRunId(runId)
  }, [invalidateRunDetails])

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
      // Read the ref (not the closed-over state) so this callback never acts on
      // a stale selectedRunId value even if it was recreated before this await
      // resolved.
      const currentSelectedRunId = selectedRunIdRef.current
      const nextSelectedRunId =
        preferredRunId && projectRuns.some((run) => run.id === preferredRunId)
          ? preferredRunId
          : currentSelectedRunId && projectRuns.some((run) => run.id === currentSelectedRunId)
            ? currentSelectedRunId
            : projectRuns[0]?.id ?? null

      if (nextSelectedRunId == null) {
        invalidateRunDetails(false)
        setSelectedRunId(null)
      } else if (nextSelectedRunId !== currentSelectedRunId) {
        handleSelectRun(nextSelectedRunId)
      }
      return projectRuns
    } catch (err) {
      console.error('[PrecheckWorkspace] Failed to fetch project runs:', err)
      return []
    } finally {
      setLoadingRuns(false)
    }
  }, [handleSelectRun, invalidateRunDetails, projectId])

  const fetchRunDetails = useCallback(async (runId: string) => {
    // Increment the version counter and capture the version for this fetch.
    // If selectedRunId changes before this fetch resolves, a newer call will
    // increment the counter again. The stale response is discarded by the guard
    // below, preventing a previous run's data from overwriting the current run.
    runDetailsAbortRef.current?.abort()
    const controller = new AbortController()
    runDetailsAbortRef.current = controller
    const requestId = ++runDetailsRequestIdRef.current

    // Clear stale data and show skeleton before the fetch starts.
    // Both setState calls are synchronous so React batches them into one render,
    // preventing a brief "No run selected" flash between clearing and loading.
    setRunDetails(null)
    setLoadingDetails(true)
    try {
      const details = await precheckApi.getRunDetails(runId, { signal: controller.signal })
      if (runDetailsRequestIdRef.current !== requestId) return
      setRunDetails(details)
    } catch (err) {
      if (controller.signal.aborted || runDetailsRequestIdRef.current !== requestId) return
      console.error('[PrecheckWorkspace] Failed to fetch run details:', err)
    } finally {
      if (runDetailsRequestIdRef.current === requestId) {
        runDetailsAbortRef.current = null
        setLoadingDetails(false)
      }
    }
  }, [])

  const refreshRunState = useCallback(async (runId: string) => {
    await Promise.all([
      fetchProjectRuns(runId),
      fetchRunDetails(runId),
    ])
  }, [fetchProjectRuns, fetchRunDetails])

  // Silent refresh: updates runDetails and the run in the runs list without
  // showing a loading skeleton. Used by the sync poller below so the UI stays
  // populated while background processing is in progress.
  const refreshRunDetailsSilent = useCallback(async (runId: string) => {
    runDetailsAbortRef.current?.abort()
    const controller = new AbortController()
    runDetailsAbortRef.current = controller
    const requestId = ++runDetailsRequestIdRef.current
    try {
      const details = await precheckApi.getRunDetails(runId, { signal: controller.signal })
      if (runDetailsRequestIdRef.current !== requestId) return
      setRunDetails(details)
      // Keep the runs list status badge in sync so it updates without a full refetch.
      setRuns((prev) => prev.map((r) => (r.id === runId ? details.run : r)))
    } catch (err) {
      if (controller.signal.aborted || runDetailsRequestIdRef.current !== requestId) return
      console.error('[PrecheckWorkspace] Background poll failed:', err)
    } finally {
      if (runDetailsRequestIdRef.current === requestId) {
        runDetailsAbortRef.current = null
      }
    }
  }, [])

  // Keep the ref in sync with the state so that callbacks reading
  // selectedRunIdRef.current always see the latest committed value.
  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  // Realtime subscription: listen for precheck_runs UPDATE events for the
  // selected run. Replaces the 2s polling interval. The subscription is
  // torn down and re-established whenever the selected run changes.
  //
  // payload.new uses snake_case DB column names — map to camelCase manually
  // because PrecheckRunSchema expects camelCase (as returned by FastAPI).
  useEffect(() => {
    if (!selectedRunId) return

    const supabase = getSupabaseBrowserClient()
    const channel = supabase
      .channel(`precheck-run-${selectedRunId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'precheck_runs',
          filter: `id=eq.${selectedRunId}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>
          const patch: Partial<PrecheckRun> = {
            status:             raw['status']               as PrecheckRun['status'],
            readinessScore:     raw['readiness_score']      as number | null | undefined,
            currentStep:        raw['current_step']         as string | null | undefined,
            errorMessage:       raw['error_message']        as string | null | undefined,
            siteContextId:      raw['site_context_id']      as string | null | undefined,
            speckleModelRefId:  raw['speckle_model_ref_id'] as string | null | undefined,
            updatedAt:          raw['updated_at']           as string,
          }
          setRuns((prev) =>
            prev.map((r) => (r.id === selectedRunId ? { ...r, ...patch } : r))
          )
          setRunDetails((prev) =>
            prev && prev.run.id === selectedRunId
              ? { ...prev, run: { ...prev.run, ...patch } }
              : prev
          )
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [selectedRunId])

  useEffect(() => {
    if (!projectId) {
      invalidateRunDetails(false)
      setRuns([])
      setSelectedRunId(null)
      return
    }

    void fetchProjectRuns()
  }, [fetchProjectRuns, invalidateRunDetails, projectId])

  useEffect(() => {
    if (selectedRunId) {
      void fetchRunDetails(selectedRunId)
      return
    }

    invalidateRunDetails(false)
  }, [fetchRunDetails, invalidateRunDetails, selectedRunId])

  useEffect(() => {
    return () => {
      runDetailsAbortRef.current?.abort()
    }
  }, [])

  // Poll run details while the backend is actively processing a model sync.
  // Activates when the selected run's status is syncing_model or computing_metrics.
  // Stops automatically when the status transitions to any other value (including
  // created / failed / completed), or when the selected run changes or the
  // component unmounts. The interval cleanup in the return ensures no timer leaks.
  const pollingRunStatus =
    runDetails?.run.id === selectedRunId ? (runDetails?.run.status ?? null) : null

  useEffect(() => {
    if (!selectedRunId) return
    if (pollingRunStatus !== 'syncing_model' && pollingRunStatus !== 'computing_metrics') return

    const id = setInterval(() => {
      void refreshRunDetailsSilent(selectedRunId)
    }, 2000)

    return () => clearInterval(id)
  }, [selectedRunId, pollingRunStatus, refreshRunDetailsSilent])

  async function handleCreateRun(pid: string, uid: string) {
    const run = await precheckApi.createPrecheckRun({ projectId: pid, createdBy: uid })
    setActiveTab('setup')
    // refreshRunState calls fetchProjectRuns(run.id) which internally calls
    // handleSelectRun(run.id) — that is sufficient. Do NOT call handleSelectRun
    // again here: handleCreateRun is an inline closure that captures the
    // handleSelectRun from the render it was created in. By the time this await
    // resolves the component has re-rendered (selectedRunId changed), so the
    // captured handleSelectRun has a stale selectedRunId in its closure. Calling
    // it would misfire the early-return guard, spuriously clear runDetails, set
    // loadingDetails=true, and then never reset it (selectedRunId didn't change
    // so the useEffect doesn't re-fire) → stuck blank form.
    await refreshRunState(run.id)
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
    setSyncingModel(true)
    try {
      await precheckApi.syncSpeckleModel(input)
      // SPECKLE VIEWER WILL BE MOUNTED HERE
      if (selectedRunId) {
        await refreshRunState(selectedRunId)
      }
    } finally {
      setSyncingModel(false)
    }
  }

  async function handleEvaluate() {
    if (!selectedRunId) return
    await precheckApi.evaluateCompliance({ runId: selectedRunId })
    // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
    await refreshRunState(selectedRunId)
    setActiveTab('issues')
  }

  async function handleDeleteDocument(documentId: string) {
    await precheckApi.deleteDocument(documentId)
    if (selectedRunId) {
      await refreshRunState(selectedRunId)
    }
  }

  async function handleDeleteRun(runId: string) {
    await precheckApi.deleteRun(runId)
    // Remove the deleted run from the local list immediately so the UI updates
    // without waiting for a full project-runs refetch.
    setRuns((prev) => prev.filter((r) => r.id !== runId))
    if (selectedRunId === runId) {
      // Select the next available run, or null if none remain
      const remaining = runs.filter((r) => r.id !== runId)
      const nextRunId = remaining[0]?.id ?? null
      if (nextRunId) {
        handleSelectRun(nextRunId)
      } else {
        invalidateRunDetails(false)
        setSelectedRunId(null)
      }
    }
    // Sync with backend to confirm final state
    await fetchProjectRuns()
  }

  function handleSelectIssue(issue: ComplianceIssue) {
    setSelectedIssue(issue)
    setDrawerOpen(true)
  }

  const currentRunDetails =
    runDetails?.run.id === selectedRunId
      ? runDetails
      : null
  const run = currentRunDetails?.run ?? null
  const selectedRun = runs.find((candidate) => candidate.id === selectedRunId) ?? null
  const issues = currentRunDetails?.issues ?? []
  const checklist = currentRunDetails?.checklist ?? []
  const rules: ExtractedRule[] = currentRunDetails?.rules ?? []

  // True only when the fetched details belong to the currently-selected run and
  // the fetch has fully settled. This is the render gate for setup panels —
  // until this is true we show a skeleton, never a partially-populated or
  // wrong-run form.
  const detailsReadyForSelectedRun =
    selectedRunId !== null &&
    !loadingDetails &&
    runDetails?.run.id === selectedRunId

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'issues', label: 'Issues', count: issues.length || undefined },
    { id: 'checklist', label: 'Checklist', count: checklist.length || undefined },
  ]

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <PrecheckViewerPanel
          selectedIssue={selectedIssue}
          modelRef={currentRunDetails?.modelRef ?? null}
        />
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
            onSelect={handleSelectRun}
            onDeleteRun={handleDeleteRun}
          />
          {loadingRuns && (
            <p className="mt-2 text-[10px] text-muted-foreground">Refreshing runs...</p>
          )}
        </div>

        {selectedRunId && (
          <ResizableVerticalSplit
            className="flex-1 min-h-0"
            storageKey="precheck-right-split"
            defaultTopPercent={38}
            minTopPercent={20}
            maxTopPercent={65}
            topPanel={
              <div className="h-full overflow-y-auto space-y-3 px-4 py-3">
                <ReadinessScoreCard score={run?.readinessScore} isLoading={loadingDetails} />
                <PrecheckProgressCard
                  run={run ?? selectedRun}
                  hasSiteContext={currentRunDetails?.siteContext != null}
                  hasDocuments={(currentRunDetails?.documents?.length ?? 0) > 0}
                  hasRules={(currentRunDetails?.rules?.length ?? 0) > 0}
                  hasModelRef={currentRunDetails?.modelRef != null}
                  hasGeometrySnapshot={currentRunDetails?.geometrySnapshot != null}
                  isLoading={loadingDetails}
                />
              </div>
            }
            bottomPanel={
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
                        {!detailsReadyForSelectedRun ? (
                          /*
                            Skeleton shown whenever selectedRunId is set but details
                            have not yet settled for THAT run. This prevents any
                            possibility of showing a stale run's site context, a blank
                            disabled form, or a double/stacked setup panel during
                            transitions (run switching, new-run creation, or refresh).
                          */
                          <div className="space-y-4" aria-busy="true" aria-label="Loading run details">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-3">
                                <div className="h-4 w-32 rounded bg-archai-graphite animate-pulse" />
                                <div className="h-3 w-full rounded bg-archai-graphite animate-pulse opacity-60" />
                                <div className="h-3 w-3/4 rounded bg-archai-graphite animate-pulse opacity-40" />
                                <div className="h-7 w-full rounded bg-archai-graphite animate-pulse opacity-50 mt-2" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          /*
                            key={selectedRunId} forces a remount whenever the selected
                            run changes, guaranteeing SiteContextForm's prefill effect
                            fires with the new run's data and DocumentUploadPanel's
                            pending state is cleared. Safe to mount here because
                            detailsReadyForSelectedRun already guarantees the details
                            belong to selectedRunId.
                          */
                          <>
                            <SiteContextForm
                              key={selectedRunId}
                              runId={selectedRunId}
                              onSubmit={handleIngestSite}
                              siteContext={currentRunDetails?.siteContext}
                              isLoading={false}
                            />
                            <DocumentUploadPanel
                              key={selectedRunId}
                              runId={selectedRunId}
                              onDocumentsReady={handleIngestDocuments}
                              existingDocuments={currentRunDetails?.documents ?? []}
                              onDeleteDocument={handleDeleteDocument}
                              isLoading={false}
                            />
                            <RuleExtractionStatusCard
                              runId={selectedRunId}
                              rules={rules}
                              canExtract
                              onExtract={handleExtractRules}
                              isExtracting={extracting}
                            />
                            <SpeckleModelPicker
                              key={selectedRunId}
                              runId={selectedRunId}
                              onSync={handleSyncModel}
                              modelRef={currentRunDetails?.modelRef}
                              geometrySnapshot={currentRunDetails?.geometrySnapshot}
                              run={run}
                              isLoading={
                                syncingModel ||
                                run?.status === 'syncing_model' ||
                                run?.status === 'computing_metrics'
                              }
                            />

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
            }
          />
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
