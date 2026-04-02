'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react'
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
  SiteContext,
  SyncSpeckleModelInput,
} from '@/lib/precheck/types'
import type { AuthUser } from '@/types'

import { PrecheckRunsList } from './PrecheckRunsList'
import { CreatePrecheckRunDialog } from './CreatePrecheckRunDialog'
import { SiteContextPicker } from './SiteContextPicker'
import { DocumentUploadPanel } from './DocumentUploadPanel'
import { RuleExtractionStatusCard } from './RuleExtractionStatusCard'
import { ManualRuleDialog } from './ManualRuleDialog'
import { SpeckleModelPicker } from './SpeckleModelPicker'
import { PrecheckProgressCard } from './PrecheckProgressCard'
import { RunMetricsStatusCard } from './RunMetricsStatusCard'
import { ReadinessScoreCard } from './ReadinessScoreCard'
import { ComplianceIssuesTable } from './ComplianceIssuesTable'
import { ComplianceIssueDrawer } from './ComplianceIssueDrawer'
import { PermitChecklistCard } from './PermitChecklistCard'
import { PrecheckViewerPanel } from './PrecheckViewerPanel'
import { ResizableVerticalSplit } from '@/components/ui/resizable-vertical-split'
import { ResizableHorizontalSplit } from '@/components/ui/resizable-horizontal-split'
import type { CreateManualRuleInput } from '@/lib/precheck/types'
import type { ParcelSelection } from './SiteContextMapModal'

// Dynamically import the map modal — heavy Mapbox bundle, never SSR'd
const SiteContextMapModal = dynamic(
  () => import('./SiteContextMapModal').then((m) => m.SiteContextMapModal),
  { ssr: false }
)

type Tab = 'setup' | 'issues' | 'checklist'

interface PrecheckWorkspaceProps {
  user: AuthUser
  projectId: string | null
  /**
   * Optional: the project's active model ref (streamId + versionId) to pre-fill
   * the SpeckleModelPicker when the selected run does not yet have its own modelRef.
   * Passed down from the project Models page active model selection.
   */
  projectActiveModelRef?: { streamId: string; versionId: string; branchName?: string; modelName?: string } | null
  /**
   * Optional: the project's default site context to pre-fill SiteContextPicker
   * when the selected run does not yet have its own site context saved.
   */
  projectDefaultSiteContext?: SiteContext | null
}

export function PrecheckWorkspace({ user, projectId, projectActiveModelRef, projectDefaultSiteContext }: PrecheckWorkspaceProps) {
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
  const [computingRunMetrics, setComputingRunMetrics] = useState(false)
  const [manualRuleOpen, setManualRuleOpen] = useState(false)
  // Tracks docs selected in the project library but not yet ingested.
  // Used so hasDocuments is true as soon as the user picks docs, not only after ingestion.
  const [selectedDocCount, setSelectedDocCount] = useState(0)
  const [siteContextMapOpen, setSiteContextMapOpen] = useState(false)
  // Ref to the fill function registered by SiteContextPicker
  const fillSiteContextRef = useRef<((parcel: ParcelSelection) => void) | null>(null)

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
      // DEBUG — remove once realtime behaviour is confirmed
      console.log('[fetchRunDetails] settled', {
        runId,
        status: details.run.status,
        hasModelRef: !!details.modelRef,
        hasSnapshot: !!details.geometrySnapshot,
        requestId,
        currentRequestId: runDetailsRequestIdRef.current,
      })
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const raw = payload.new as Record<string, unknown>
          // DEBUG — remove once realtime behaviour is confirmed
          console.log('[RT:precheck] callback fired', {
            payloadId: raw['id'],
            payloadStatus: raw['status'],
            selectedRunId,
            match: raw['id'] === selectedRunId,
          })
          const patch: Partial<PrecheckRun> = {
            status:             raw['status']               as PrecheckRun['status'],
            readinessScore:     raw['readiness_score']      as number | null | undefined,
            currentStep:        raw['current_step']         as string | null | undefined,
            errorMessage:       raw['error_message']        as string | null | undefined,
            siteContextId:      raw['site_context_id']      as string | null | undefined,
            speckleModelRefId:  raw['speckle_model_ref_id'] as string | null | undefined,
            isStale:            raw['is_stale']             as boolean | undefined,
            rulesChangedAt:     raw['rules_changed_at']     as string | null | undefined,
            updatedAt:          raw['updated_at']           as string,
          }
          setRuns((prev) =>
            prev.map((r) => (r.id === selectedRunId ? { ...r, ...patch } : r))
          )
          setRunDetails((prev) => {
            // DEBUG — remove once realtime behaviour is confirmed
            console.log('[RT:precheck] setRunDetails updater', {
              prevNull: prev === null,
              prevRunId: prev?.run.id,
              selectedRunId,
              patchStatus: patch.status,
            })
            return prev && prev.run.id === selectedRunId
              ? { ...prev, run: { ...prev.run, ...patch } }
              : prev
          })
          // The partial patch updates run.status immediately (clearing the
          // in-progress spinner) but leaves joined data (modelRef,
          // geometrySnapshot) stale. When the run reaches a terminal state,
          // re-fetch the full run details so the viewer can mount and
          // SpeckleModelPicker shows the synced confirmation.
          // Re-fetch full run details (including joined rules, modelRef, snapshot)
          // when the run reaches a terminal state OR returns to 'created' after
          // extraction/ingestion. The partial patch updates run.status immediately
          // but leaves joined data stale — a full fetch is needed to surface new rules.
          if (
            patch.status === 'synced' ||
            patch.status === 'completed' ||
            patch.status === 'failed' ||
            patch.status === 'created'
          ) {
            // DEBUG — remove once realtime behaviour is confirmed
            console.log('[RT:precheck] triggering fetchRunDetails for status:', patch.status)
            void fetchRunDetails(selectedRunId)
          }
        }
      )
      .subscribe((status: string, err?: Error) => {
        // DEBUG — remove once realtime behaviour is confirmed
        console.log('[RT:precheck] subscribe status:', status, err ?? '')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [selectedRunId, fetchRunDetails])

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


  async function handleCreateRun(pid: string, uid: string, name: string | undefined) {
    const run = await precheckApi.createPrecheckRun({ projectId: pid, createdBy: uid, name })
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

  /**
   * Assign an existing project model ref to the current run without creating a
   * new speckle_model_refs row. Called by SpeckleModelPicker when the user picks
   * from the project library (not when they submit new raw stream/version IDs).
   */
  async function handleAssignExistingModel(modelRefId: string) {
    if (!selectedRunId) return
    setSyncingModel(true)
    try {
      await precheckApi.assignModelRefToRun({ runId: selectedRunId, modelRefId })
      await refreshRunState(selectedRunId)
    } finally {
      setSyncingModel(false)
    }
  }

  /**
   * Called by SpeckleModelPicker (and the main-page RunMetricsStatusCard) after
   * compute-run-metrics succeeds. Patches runMetrics into both the runs list and
   * the current runDetails so the FAR/status display updates immediately.
   */
  function handleRunMetricsComputed(updatedRun: PrecheckRun) {
    setRuns((prev) =>
      prev.map((r) => (r.id === updatedRun.id ? { ...r, runMetrics: updatedRun.runMetrics } : r))
    )
    setRunDetails((prev) =>
      prev && prev.run.id === updatedRun.id
        ? { ...prev, run: { ...prev.run, runMetrics: updatedRun.runMetrics } }
        : prev
    )
  }

  /**
   * Main-page "Compute run metrics" handler used by RunMetricsStatusCard.
   * Mirrors the logic inside SpeckleModelPicker but lives at the workspace
   * level so it can drive the computingRunMetrics state used by both the
   * status card and the PrecheckProgressCard.
   */
  async function handleComputeRunMetrics() {
    if (!selectedRunId) return
    setComputingRunMetrics(true)
    try {
      const updatedRun = await precheckApi.computeRunMetrics({ runId: selectedRunId })
      handleRunMetricsComputed(updatedRun)
    } finally {
      setComputingRunMetrics(false)
    }
  }

  /**
   * Assign an existing project SiteContext to the current run without creating
   * a new site_contexts row. Called by SiteContextPicker when the user picks
   * from the project library (not when they submit new site data via the form).
   */
  async function handleAssignExistingSiteContext(siteContextId: string) {
    if (!selectedRunId) return
    await precheckApi.assignSiteContextToRun({ runId: selectedRunId, siteContextId })
    await refreshRunState(selectedRunId)
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

  async function handleApproveRule(ruleId: string) {
    await precheckApi.approveRule({ ruleId })
    if (selectedRunId) {
      await fetchRunDetails(selectedRunId)
    }
  }

  async function handleUnapproveRule(ruleId: string) {
    await precheckApi.unapproveRule({ ruleId })
    if (selectedRunId) {
      await fetchRunDetails(selectedRunId)
    }
  }

  async function handleRejectRule(ruleId: string) {
    await precheckApi.rejectRule({ ruleId })
    if (selectedRunId) {
      await fetchRunDetails(selectedRunId)
    }
  }

  async function handleCreateManualRule(input: CreateManualRuleInput) {
    const rule = await precheckApi.createManualRule(input)
    if (selectedRunId) {
      await fetchRunDetails(selectedRunId)
    }
    return rule
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
    <>
    <ResizableHorizontalSplit
      storageKey="precheck-right-panel"
      defaultLeftPercent={72}
      minLeftPercent={45}
      maxLeftPercent={88}
      leftPanel={
        <div className="relative h-full w-full">
          <PrecheckViewerPanel
            selectedIssue={selectedIssue}
            modelRef={currentRunDetails?.modelRef ?? null}
          />
        </div>
      }
      rightPanel={
      <aside className="flex h-full flex-col overflow-hidden bg-archai-charcoal">
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
            minTopPercent={15}
            maxTopPercent={80}
            topPanel={
              <div className="h-full overflow-y-auto space-y-3 px-4 py-3">
                <ReadinessScoreCard
                  score={run?.readinessScore}
                  readinessBreakdown={currentRunDetails?.readinessBreakdown}
                  isLoading={loadingDetails}
                />
                <PrecheckProgressCard
                  run={run ?? selectedRun}
                  hasSiteContext={
                    currentRunDetails?.siteContext != null ||
                    projectDefaultSiteContext != null
                  }
                  hasDocuments={(currentRunDetails?.documents?.length ?? 0) > 0}
                  hasDocumentsPending={selectedDocCount > 0}
                  hasRules={(currentRunDetails?.rules?.length ?? 0) > 0}
                  hasModelRef={currentRunDetails?.modelRef != null}
                  hasGeometrySnapshot={currentRunDetails?.geometrySnapshot != null}
                  hasRunMetrics={run?.runMetrics != null}
                  isComputingRunMetrics={computingRunMetrics}
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
                            run changes, guaranteeing SiteContextPicker's prefill effect
                            fires with the new run's data and DocumentUploadPanel's
                            pending state is cleared. Safe to mount here because
                            detailsReadyForSelectedRun already guarantees the details
                            belong to selectedRunId.
                          */
                          <>
                            <SiteContextPicker
                              key={selectedRunId}
                              runId={selectedRunId}
                              projectId={projectId ?? ''}
                              siteContext={currentRunDetails?.siteContext}
                              // Pre-fill new-context form from project default when run has no context.
                              projectDefaultSiteContext={
                                currentRunDetails?.siteContext == null
                                  ? projectDefaultSiteContext ?? undefined
                                  : undefined
                              }
                              onPickExisting={handleAssignExistingSiteContext}
                              onSubmit={handleIngestSite}
                              isLoading={false}
                              onMapOpen={() => setSiteContextMapOpen(true)}
                              onFillRef={(fn) => { fillSiteContextRef.current = fn }}
                            />
                            <DocumentUploadPanel
                              key={selectedRunId}
                              projectId={projectId ?? ''}
                              onDocumentsReady={handleIngestDocuments}
                              existingDocuments={currentRunDetails?.documents ?? []}
                              onDeleteDocument={handleDeleteDocument}
                              onSelectionChange={setSelectedDocCount}
                              isLoading={false}
                            />
                            <RuleExtractionStatusCard
                              runId={selectedRunId}
                              rules={rules}
                              canExtract
                              onExtract={handleExtractRules}
                              onApprove={handleApproveRule}
                              onUnapprove={handleUnapproveRule}
                              onReject={handleRejectRule}
                              onAddManual={() => setManualRuleOpen(true)}
                              isExtracting={extracting}
                            />
                            <SpeckleModelPicker
                              key={selectedRunId}
                              runId={selectedRunId}
                              projectId={projectId ?? ''}
                              onSync={handleSyncModel}
                              onAssignExisting={handleAssignExistingModel}
                              modelRef={currentRunDetails?.modelRef}
                              // Pre-fill from project active model when this run has no own ref yet.
                              defaultModelRef={
                                currentRunDetails?.modelRef == null
                                  ? projectActiveModelRef ?? undefined
                                  : undefined
                              }
                              geometrySnapshot={currentRunDetails?.geometrySnapshot}
                              run={run}
                              isLoading={
                                syncingModel ||
                                run?.status === 'syncing_model' ||
                                run?.status === 'computing_metrics'
                              }
                              onRunMetricsComputed={handleRunMetricsComputed}
                            />

                            {/* Main-page run-metrics status + CTA */}
                            {currentRunDetails?.geometrySnapshot != null && (
                              <RunMetricsStatusCard
                                hasModelMetrics={
                                  (currentRunDetails.geometrySnapshot.metrics?.length ?? 0) > 0
                                }
                                hasRunMetrics={run?.runMetrics != null}
                                hasSiteContextParcel={
                                  currentRunDetails.siteContext?.parcelAreaM2 != null
                                }
                                isSyncing={
                                  syncingModel ||
                                  run?.status === 'syncing_model' ||
                                  run?.status === 'computing_metrics'
                                }
                                isComputing={computingRunMetrics}
                                onCompute={() => void handleComputeRunMetrics()}
                              />
                            )}

                            <Separator />

                            {run?.isStale && (
                              <div className="flex items-start gap-2 rounded-lg border border-archai-amber/40 bg-archai-amber/5 px-3 py-2">
                                <AlertTriangle className="h-3.5 w-3.5 text-archai-amber mt-0.5 shrink-0" />
                                <p className="text-[11px] text-archai-amber leading-snug">
                                  Rules have changed since the last run — results may be outdated. Rerun to update.
                                </p>
                              </div>
                            )}

                            <Button
                              variant="archai"
                              size="sm"
                              className="w-full"
                              onClick={() => void handleEvaluate()}
                              disabled={
                                run?.status === 'evaluating' ||
                                run?.status === 'generating_report'
                              }
                            >
                              {run?.isStale ? 'Rerun Compliance Check' : 'Run Compliance Check'}
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
      }
    />

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

      {projectId && (
        <ManualRuleDialog
          open={manualRuleOpen}
          onClose={() => setManualRuleOpen(false)}
          projectId={projectId}
          runId={selectedRunId ?? undefined}
          onCreate={handleCreateManualRule}
        />
      )}

      {/* Site context map modal — dynamically imported, never SSR'd */}
      {projectId && (
        <SiteContextMapModal
          open={siteContextMapOpen}
          onClose={() => setSiteContextMapOpen(false)}
          projectId={projectId}
          onConfirm={(parcel) => {
            fillSiteContextRef.current?.(parcel)
          }}
        />
      )}
    </>
  )
}
