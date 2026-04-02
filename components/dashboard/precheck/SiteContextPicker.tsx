'use client'

/**
 * SiteContextPicker — mirrors SpeckleModelPicker UX for site context selection.
 *
 * Three modes:
 *   1. No site context yet → show project library to pick from + "Add new" form
 *   2. Site context saved  → show compact status card + "Change" button → library
 *   3. Pre-filled from project default → shown as pre-filled hint, still needs Save
 *
 * Choosing from the library calls onPickExisting(siteContextId) which assigns the
 * existing row to the run (backend: update_run_site_context, no duplication).
 * The "Add new" form calls onSubmit (same as SiteContextForm.onSubmit → ingest_site).
 */

import { useState, useEffect, useCallback } from 'react'
import { MapPin, CheckCircle2, ChevronDown, ChevronUp, Plus, Loader2, Star, X, Map, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type { IngestSiteInput, SiteContext } from '@/lib/precheck/types'
import type { ParcelSelection } from './SiteContextMapModal'

interface SiteContextPickerProps {
  runId: string
  projectId: string
  /** The run's own persisted site context — null if none saved yet. */
  siteContext?: SiteContext | null
  /** Project-level default — used to pre-fill the new-entry form. */
  projectDefaultSiteContext?: SiteContext | null
  /** Called when user picks an existing project context for this run. */
  onPickExisting: (siteContextId: string) => Promise<void>
  /** Called when user submits the new site context form. */
  onSubmit: (input: IngestSiteInput) => Promise<void>
  isLoading?: boolean
  /** Opens the map modal from the parent. Called when user clicks the map icon. */
  onMapOpen?: () => void
  /**
   * If provided, the parent stores the returned setter so it can call
   * fillFromParcel(parcel) after the map modal confirms a selection.
   * Usage: onFillRef={(fn) => { fillRef.current = fn }}
   */
  onFillRef?: (fill: (parcel: ParcelSelection) => void) => void
}

/** Display a site context's key fields concisely. */
function siteContextLabel(ctx: SiteContext): string {
  const parts: string[] = []
  if (ctx.address)        parts.push(ctx.address)
  if (ctx.zoningDistrict) parts.push(ctx.zoningDistrict)
  if (ctx.municipality)   parts.push(ctx.municipality)
  return parts.join(' · ') || 'Site Context'
}

export function SiteContextPicker({
  runId,
  projectId,
  siteContext,
  projectDefaultSiteContext,
  onPickExisting,
  onSubmit,
  isLoading,
  onMapOpen,
  onFillRef,
}: SiteContextPickerProps) {
  const [projectContexts,  setProjectContexts]  = useState<SiteContext[]>([])
  const [defaultContextId, setDefaultContextId] = useState<string | null>(null)
  const [loadingLib,       setLoadingLib]       = useState(false)
  const [showChangePanel,  setShowChangePanel]  = useState(false)
  const [showNewForm,      setShowNewForm]      = useState(false)
  const [submitting,       setSubmitting]       = useState(false)

  // New-context form fields
  const [address,          setAddress]          = useState('')
  const [municipality,     setMunicipality]     = useState('')
  const [jurisdictionCode, setJurisdictionCode] = useState('')
  const [zoningDistrict,   setZoningDistrict]   = useState('')
  const [parcelAreaM2,     setParcelAreaM2]     = useState('')

  // Tracks whether the form was pre-filled from the map (but not yet saved).
  // When true AND siteContext is already saved, show an unsaved-changes warning.
  const [mapPrefilled,     setMapPrefilled]     = useState(false)

  const loadProjectContexts = useCallback(() => {
    if (!projectId) return
    let cancelled = false
    setLoadingLib(true)
    precheckApi.listProjectSiteContexts(projectId)
      .then(({ siteContexts, defaultSiteContextId }) => {
        if (cancelled) return
        setProjectContexts(siteContexts)
        setDefaultContextId(defaultSiteContextId ?? null)
        setLoadingLib(false)
      })
      .catch(() => { if (!cancelled) setLoadingLib(false) })
    return () => { cancelled = true }
  }, [projectId])

  /** Fill the new-context form from a map parcel selection. */
  const fillFromParcel = useCallback((parcel: ParcelSelection) => {
    setAddress(parcel.address)
    setMunicipality(parcel.municipality)
    setJurisdictionCode(parcel.jurisdictionCode)
    setZoningDistrict('')
    setParcelAreaM2(parcel.parcelAreaM2 != null ? String(parcel.parcelAreaM2) : '')
    setMapPrefilled(true)
    // Auto-open the new form so user can see/edit and hit Save
    setShowNewForm(true)
    if (siteContext) {
      // If there is already a saved context, expand the change panel so the
      // user can see the new form alongside the unsaved-changes warning.
      setShowChangePanel(true)
    }
  }, [siteContext])

  useEffect(() => {
    const cleanup = loadProjectContexts()
    return cleanup
  }, [loadProjectContexts])

  // Register fillFromParcel with the parent so the map modal can call it
  useEffect(() => {
    onFillRef?.(fillFromParcel)
  }, [onFillRef, fillFromParcel])

  // Pre-seed new form from project default when it opens
  useEffect(() => {
    if (!showNewForm) return
    const src = projectDefaultSiteContext ?? null
    if (src && !address) {
      setAddress(src.address ?? '')
      setMunicipality(src.municipality ?? '')
      setJurisdictionCode(src.jurisdictionCode ?? '')
      setZoningDistrict(src.zoningDistrict ?? '')
      setParcelAreaM2(src.parcelAreaM2 != null ? String(src.parcelAreaM2) : '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewForm])

  async function handlePickContext(ctx: SiteContext) {
    setSubmitting(true)
    try {
      await onPickExisting(ctx.id)
      setShowChangePanel(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleNewFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit({
        runId,
        address: address.trim() || undefined,
        manualOverrides: {
          municipality: municipality.trim() || undefined,
          jurisdictionCode: jurisdictionCode.trim() || undefined,
          zoningDistrict: zoningDistrict.trim() || undefined,
          parcelAreaM2: parcelAreaM2 ? Number(parcelAreaM2) : undefined,
        },
      })
      setShowChangePanel(false)
      setShowNewForm(false)
      setMapPrefilled(false)
      loadProjectContexts()
    } finally {
      setSubmitting(false)
    }
  }

  const isBusy = Boolean(isLoading || submitting)

  // ── Compact status card (when run already has a site context) ─────────────
  const statusCard = siteContext ? (
    <>
      <div className={cn(
        'rounded-lg border px-3 py-2 space-y-1',
        'border-emerald-400/20 bg-emerald-400/5',
      )}>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-emerald-400 truncate">
              {siteContextLabel(siteContext)}
            </p>
            {siteContext.zoningDistrict && (
              <p className="text-[10px] text-muted-foreground">
                Zone: {siteContext.zoningDistrict}
                {siteContext.municipality ? ` · ${siteContext.municipality}` : ''}
              </p>
            )}
            {siteContext.parcelAreaM2 != null && (
              <p className="text-[10px] text-muted-foreground">
                Parcel: {siteContext.parcelAreaM2.toLocaleString()} m²
              </p>
            )}
          </div>
        </div>
      </div>

      {!showChangePanel && !isBusy && (
        <button
          type="button"
          onClick={() => setShowChangePanel(true)}
          className="text-[10px] text-muted-foreground hover:text-white transition-colors"
        >
          Change site context →
        </button>
      )}
    </>
  ) : null

  // ── Project library picker ────────────────────────────────────────────────
  const libraryPicker = (
    <div className="space-y-2">
      {loadingLib ? (
        <div className="space-y-1.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
          ))}
        </div>
      ) : projectContexts.length === 0 ? (
        <p className="text-[10px] text-muted-foreground py-1">
          No site contexts saved yet. Add one below.
        </p>
      ) : (
        <div className="space-y-1.5">
          {projectContexts.map((ctx) => {
            const isDefault = ctx.id === defaultContextId
            return (
              <button
                key={ctx.id}
                type="button"
                disabled={isBusy}
                onClick={() => void handlePickContext(ctx)}
                className={cn(
                  'w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-colors',
                  isDefault
                    ? 'border-archai-orange/30 bg-archai-orange/5 hover:bg-archai-orange/10'
                    : 'border-archai-graphite bg-archai-black/40 hover:bg-archai-charcoal',
                )}
              >
                <MapPin className={cn('h-3.5 w-3.5 shrink-0', isDefault ? 'text-archai-orange' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-white truncate">
                      {siteContextLabel(ctx)}
                    </p>
                    {isDefault && (
                      <span className="text-[9px] font-medium text-archai-orange border border-archai-orange/30 rounded-full px-1.5 py-0.5 shrink-0">
                        default
                      </span>
                    )}
                  </div>
                  {ctx.zoningDistrict && (
                    <p className="font-mono text-[10px] text-muted-foreground truncate">
                      {ctx.zoningDistrict}{ctx.municipality ? ` · ${ctx.municipality}` : ''}
                    </p>
                  )}
                </div>
                {!submitting && (
                  <span className="text-[10px] text-muted-foreground shrink-0">Use →</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Add new site context — collapsible form */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-white transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add new site context
          {showNewForm ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
        </button>

        {showNewForm && (
          <form onSubmit={handleNewFormSubmit} className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Address</label>
              <Input
                placeholder="123 Main St, City, State"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-archai-black border-archai-graphite text-sm h-8"
                disabled={isBusy}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Municipality</label>
                <Input
                  placeholder="City"
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Jurisdiction Code</label>
                <Input
                  placeholder="e.g. NYC-2024"
                  value={jurisdictionCode}
                  onChange={(e) => setJurisdictionCode(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={isBusy}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Zoning District</label>
                <Input
                  placeholder="e.g. R7A"
                  value={zoningDistrict}
                  onChange={(e) => setZoningDistrict(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Parcel Area (m²)</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="e.g. 850"
                  value={parcelAreaM2}
                  onChange={(e) => setParcelAreaM2(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={isBusy}
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="archai"
              size="sm"
              className="w-full"
              disabled={isBusy}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {isBusy ? 'Saving…' : 'Save Site Context'}
            </Button>
          </form>
        )}
      </div>

      {showChangePanel && (
        <button
          type="button"
          onClick={() => { setShowChangePanel(false); setShowNewForm(false) }}
          className="text-[10px] text-muted-foreground hover:text-white transition-colors"
        >
          ← Keep current site context
        </button>
      )}
    </div>
  )

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Site Context</p>
        {loadingLib && !siteContext && (
          <Loader2 className="h-3 w-3 text-muted-foreground animate-spin ml-auto" />
        )}
        {siteContext && !mapPrefilled && (
          <span className="ml-auto text-[10px] text-emerald-400 font-medium">Saved</span>
        )}
        {!siteContext && projectDefaultSiteContext && !mapPrefilled && (
          <span className="ml-auto text-[10px] text-archai-amber font-medium">Default available</span>
        )}
        {/* Map icon button */}
        {onMapOpen && (
          <button
            type="button"
            onClick={onMapOpen}
            title="Open parcel map"
            aria-label="Open parcel map"
            className={cn(
              'ml-auto flex items-center gap-1 text-[10px] rounded border px-2 py-0.5 transition-colors',
              siteContext
                ? 'border-archai-orange/40 bg-archai-orange/10 text-archai-orange hover:bg-archai-orange/20'
                : 'border-archai-graphite text-muted-foreground hover:text-white hover:border-archai-graphite/80',
            )}
          >
            <Map className="h-3 w-3" />
            Map
          </button>
        )}
      </div>

      {/* Unsaved-changes warning — shown after map pre-fill when a context is already saved */}
      {mapPrefilled && siteContext && (
        <div className="flex items-start gap-2 rounded-lg border border-archai-amber/30 bg-archai-amber/5 px-3 py-2 -mt-1">
          <AlertTriangle className="h-3.5 w-3.5 text-archai-amber shrink-0 mt-0.5" />
          <p className="text-[10px] text-archai-amber/90 leading-snug">
            Form updated from map. The saved site context has not changed yet —
            click <strong>Save Site Context</strong> below to apply these values.
          </p>
        </div>
      )}

      {/* Pre-fill notice — shown when no run context but project default exists */}
      {!siteContext && projectDefaultSiteContext && !showNewForm && projectContexts.length === 0 && !loadingLib && (
        <p className="text-[10px] text-archai-amber/80 -mt-2">
          Project default will pre-fill the form.
        </p>
      )}

      {siteContext ? (
        <>
          {statusCard}
          {showChangePanel && (
            <div className="rounded-lg border border-archai-graphite bg-archai-black/40 p-3 space-y-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Choose from project contexts
              </p>
              {libraryPicker}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground -mt-2">
            Choose a saved site context or add new site data.
          </p>
          {libraryPicker}
        </>
      )}

      {/* FASTAPI CALL PLACEHOLDER — will trigger SiteDataProviderService */}
      {isBusy && (
        <div className="flex items-center gap-1.5 text-[10px] text-archai-amber/70">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving site context…
        </div>
      )}
    </div>
  )
}

// ── ProjectDefaultSiteContextPanel ───────────────────────────────────────────

/**
 * Standalone panel for Project Overview — lets users set/change the project's
 * default site context by picking from existing contexts or viewing the current one.
 * Does not create new site contexts (those come from Tool 1 runs).
 */
interface ProjectDefaultSiteContextPanelProps {
  projectId: string
  /** Opens the map modal from the parent. */
  onMapOpen?: () => void
  /** Called by the parent to pre-fill the form after a map selection. */
  onFillRef?: (fill: (parcel: ParcelSelection) => void) => void
}

export function ProjectDefaultSiteContextPanel({ projectId, onMapOpen, onFillRef }: ProjectDefaultSiteContextPanelProps) {
  const [contexts,      setContexts]     = useState<SiteContext[]>([])
  const [defaultId,     setDefaultId]    = useState<string | null>(null)
  const [loading,       setLoading]      = useState(true)
  const [settingId,     setSettingId]    = useState<string | null>(null)
  const [deletingId,    setDeletingId]   = useState<string | null>(null)
  const [error,         setError]        = useState<string | null>(null)
  const [expanded,      setExpanded]     = useState(false)
  const [showNewForm,   setShowNewForm]  = useState(false)
  const [creating,      setCreating]     = useState(false)

  // New-context form fields
  const [address,          setAddress]          = useState('')
  const [municipality,     setMunicipality]     = useState('')
  const [jurisdictionCode, setJurisdictionCode] = useState('')
  const [zoningDistrict,   setZoningDistrict]   = useState('')
  const [parcelAreaM2,     setParcelAreaM2]     = useState('')

  // Tracks whether the form was pre-filled from the map (but not yet saved)
  const [mapPrefilled, setMapPrefilled] = useState(false)

  const reload = useCallback(() => {
    let cancelled = false
    setLoading(true)
    precheckApi.listProjectSiteContexts(projectId)
      .then(({ siteContexts, defaultSiteContextId }) => {
        if (cancelled) return
        setContexts(siteContexts)
        setDefaultId(defaultSiteContextId ?? null)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    return reload()
  }, [reload])

  // fillFromParcel — called by parent after map modal confirms a selection
  const fillFromParcel = useCallback((parcel: ParcelSelection) => {
    setAddress(parcel.address)
    setMunicipality(parcel.municipality)
    setJurisdictionCode(parcel.jurisdictionCode)
    setZoningDistrict('')
    setParcelAreaM2(parcel.parcelAreaM2 != null ? String(parcel.parcelAreaM2) : '')
    setMapPrefilled(true)
    setShowNewForm(true)
    setExpanded(true)
  }, [])

  useEffect(() => {
    onFillRef?.(fillFromParcel)
  }, [onFillRef, fillFromParcel])

  async function handleSetDefault(ctxId: string) {
    if (settingId) return
    setSettingId(ctxId)
    setError(null)
    try {
      await precheckApi.setProjectDefaultSiteContext({ projectId, siteContextId: ctxId })
      setDefaultId(ctxId)
    } catch {
      setError('Failed to set default site context.')
    } finally {
      setSettingId(null)
    }
  }

  async function handleDelete(ctxId: string) {
    if (deletingId || settingId) return
    setDeletingId(ctxId)
    setError(null)
    try {
      await precheckApi.deleteProjectSiteContext({ projectId, siteContextId: ctxId })
      // If deleted was default, FK ON DELETE SET NULL clears it on the DB side.
      // Clear it locally too so the UI reflects the change immediately.
      if (defaultId === ctxId) setDefaultId(null)
      setContexts((prev) => prev.filter((c) => c.id !== ctxId))
    } catch {
      setError('Failed to delete site context.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await precheckApi.createProjectSiteContext({
        projectId,
        address: address.trim() || undefined,
        manualOverrides: {
          municipality: municipality.trim() || undefined,
          jurisdictionCode: jurisdictionCode.trim() || undefined,
          zoningDistrict: zoningDistrict.trim() || undefined,
          parcelAreaM2: parcelAreaM2 ? Number(parcelAreaM2) : undefined,
        },
        setAsDefault: true,
      })
      // Reset form
      setAddress(''); setMunicipality(''); setJurisdictionCode('')
      setZoningDistrict(''); setParcelAreaM2('')
      setShowNewForm(false)
      setMapPrefilled(false)
      reload()
    } catch {
      setError('Failed to create site context.')
    } finally {
      setCreating(false)
    }
  }

  const defaultCtx = contexts.find((c) => c.id === defaultId) ?? null

  if (loading) {
    return (
      <div className="rounded-lg border border-archai-graphite bg-archai-black/40 p-4 animate-pulse h-16" />
    )
  }

  return (
    <div className="rounded-lg border border-archai-graphite bg-archai-black/40">
      <div className="flex items-center">
        <button
          type="button"
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
          onClick={() => { setExpanded((v) => !v); setShowNewForm(false) }}
        >
          <MapPin className={cn('h-4 w-4 shrink-0', defaultCtx ? 'text-emerald-400' : 'text-muted-foreground')} />
          <div className="flex-1 min-w-0">
            {defaultCtx ? (
              <>
                <p className="text-xs font-medium text-white truncate">{siteContextLabel(defaultCtx)}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Default site context</p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-muted-foreground">No default site context</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Click to add or choose a default site context
                </p>
              </>
            )}
          </div>
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        </button>
        {/* Map icon button */}
        {onMapOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMapOpen() }}
            title="Open parcel map"
            aria-label="Open parcel map"
            className={cn(
              'shrink-0 flex items-center gap-1 text-[10px] rounded border mr-3 px-2 py-0.5 transition-colors',
              defaultCtx
                ? 'border-archai-orange/40 bg-archai-orange/10 text-archai-orange hover:bg-archai-orange/20'
                : 'border-archai-graphite text-muted-foreground hover:text-white hover:border-archai-graphite/80',
            )}
          >
            <Map className="h-3 w-3" />
            Map
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-archai-graphite px-4 pb-3 pt-2 space-y-2">
          {error && <p className="text-[10px] text-red-400">{error}</p>}

          {/* Unsaved-changes warning after map pre-fill */}
          {mapPrefilled && (
            <div className="flex items-start gap-2 rounded-lg border border-archai-amber/30 bg-archai-amber/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-archai-amber shrink-0 mt-0.5" />
              <p className="text-[10px] text-archai-amber/90 leading-snug">
                Form updated from map. Click <strong>Save as Default</strong> below to persist these values.
              </p>
            </div>
          )}

          {/* Existing contexts */}
          {contexts.length > 0 && (
            <div className="space-y-1.5">
              {contexts.map((ctx) => {
                const isDefault  = ctx.id === defaultId
                const isSetting  = settingId === ctx.id
                const isDeleting = deletingId === ctx.id
                const isBusy     = Boolean(settingId) || Boolean(deletingId)
                return (
                  <div
                    key={ctx.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                      isDefault
                        ? 'border-archai-orange/30 bg-archai-orange/5'
                        : 'border-archai-graphite bg-archai-black/40',
                    )}
                  >
                    <MapPin className={cn('h-3 w-3 shrink-0', isDefault ? 'text-archai-orange' : 'text-muted-foreground/50')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{siteContextLabel(ctx)}</p>
                      {ctx.zoningDistrict && (
                        <p className="text-[10px] text-muted-foreground/60 truncate">
                          {ctx.zoningDistrict}{ctx.municipality ? ` · ${ctx.municipality}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isDefault ? (
                        <span className="text-[9px] font-medium text-archai-orange border border-archai-orange/30 rounded-full px-1.5 py-0.5">
                          default
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSetDefault(ctx.id)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-archai-orange transition-colors"
                        >
                          {isSetting
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Star className="h-3 w-3" />}
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(ctx.id)}
                        disabled={isBusy}
                        title="Delete site context"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 transition-colors"
                      >
                        {isDeleting
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <X className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add new site context */}
          {!showNewForm ? (
            <button
              type="button"
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-white transition-colors pt-1"
            >
              <Plus className="h-3 w-3" />
              Add new site context
            </button>
          ) : (
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">New site context</p>
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="text-muted-foreground hover:text-white transition-colors"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Address</label>
                <Input
                  placeholder="123 Main St, City, State"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={creating}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Municipality</label>
                  <Input
                    placeholder="City"
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                    className="bg-archai-black border-archai-graphite text-sm h-8"
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Jurisdiction</label>
                  <Input
                    placeholder="e.g. NYC-2024"
                    value={jurisdictionCode}
                    onChange={(e) => setJurisdictionCode(e.target.value)}
                    className="bg-archai-black border-archai-graphite text-sm h-8"
                    disabled={creating}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Zoning District</label>
                  <Input
                    placeholder="e.g. R7A"
                    value={zoningDistrict}
                    onChange={(e) => setZoningDistrict(e.target.value)}
                    className="bg-archai-black border-archai-graphite text-sm h-8"
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Parcel (m²)</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g. 850"
                    value={parcelAreaM2}
                    onChange={(e) => setParcelAreaM2(e.target.value)}
                    className="bg-archai-black border-archai-graphite text-sm h-8"
                    disabled={creating}
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="archai"
                size="sm"
                className="w-full"
                disabled={creating}
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
                {creating ? 'Saving…' : 'Save as Default'}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
