'use client'

/**
 * ProjectSettings — project-level settings panel.
 *
 * Sections:
 *  1. General — rename project
 *  2. Preferences — per-project localStorage prefs (auto-delete run assets)
 *  3. Danger Zone — delete project with confirmation
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { renameProject, deleteProject } from '@/lib/actions/projects'
import * as precheckApi from '@/lib/precheck/api'
import type { ProjectExtractionOptions } from '@/lib/precheck/types'

// localStorage key pattern: archai:projectPrefs:[projectId]
function prefsKey(projectId: string) {
  return `archai:projectPrefs:${projectId}`
}

interface ProjectPrefs {
  autoDeleteRunAssets: boolean
}

function loadPrefs(projectId: string): ProjectPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(projectId))
    if (!raw) return { autoDeleteRunAssets: false }
    return JSON.parse(raw) as ProjectPrefs
  } catch {
    return { autoDeleteRunAssets: false }
  }
}

function savePrefs(projectId: string, prefs: ProjectPrefs) {
  try {
    localStorage.setItem(prefsKey(projectId), JSON.stringify(prefs))
  } catch {
    // localStorage unavailable — silently ignore
  }
}

interface ProjectSettingsProps {
  projectId: string
  initialName: string
  createdAt: string
}

export function ProjectSettings({ projectId, initialName, createdAt }: ProjectSettingsProps) {
  const router = useRouter()

  // ── Rename ──────────────────────────────────────────────────────────────────
  const [name, setName]             = useState(initialName)
  const [renaming, setRenaming]     = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameSaved, setRenameSaved] = useState(false)

  const nameChanged = name.trim() !== initialName && name.trim().length > 0

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!nameChanged || renaming) return
    setRenaming(true)
    setRenameError(null)
    setRenameSaved(false)
    const { error } = await renameProject(projectId, name)
    setRenaming(false)
    if (error) {
      setRenameError(error)
    } else {
      setRenameSaved(true)
      setTimeout(() => setRenameSaved(false), 2500)
      // Refresh server component data (project name in sidebar/topbar)
      router.refresh()
    }
  }

  // ── Preferences ─────────────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<ProjectPrefs>({ autoDeleteRunAssets: false })
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  // Load from localStorage after mount (client-only)
  useEffect(() => {
    setPrefs(loadPrefs(projectId))
    setPrefsLoaded(true)
  }, [projectId])

  function updatePref<K extends keyof ProjectPrefs>(key: K, value: ProjectPrefs[K]) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    savePrefs(projectId, next)
  }

  // ── Code Checker options ─────────────────────────────────────────────────────
  const DEFAULT_OPTIONS: ProjectExtractionOptions = {
    projectId,
    ruleAutoApplyEnabled: false,
    ruleAutoApplyConfidenceThreshold: 0.82,
    manualVerificationRequired: true,
    autoResolveConflicts: false,
  }
  const [extractionOptions, setExtractionOptions]       = useState<ProjectExtractionOptions>(DEFAULT_OPTIONS)
  const [optionsLoaded, setOptionsLoaded]               = useState(false)
  const [optionsSaving, setOptionsSaving]               = useState(false)
  const [optionsSaved, setOptionsSaved]                 = useState(false)
  const [optionsError, setOptionsError]                 = useState<string | null>(null)

  const loadExtractionOptions = useCallback(async () => {
    try {
      const opts = await precheckApi.getProjectExtractionOptions(projectId)
      setExtractionOptions(opts)
    } catch {
      // Server unavailable — use defaults, allow user to save later
    } finally {
      setOptionsLoaded(true)
    }
  }, [projectId])

  useEffect(() => {
    void loadExtractionOptions()
  }, [loadExtractionOptions])

  function updateOption<K extends keyof ProjectExtractionOptions>(key: K, value: ProjectExtractionOptions[K]) {
    setExtractionOptions((prev) => ({ ...prev, [key]: value }))
    setOptionsSaved(false)
  }

  async function handleSaveOptions() {
    if (optionsSaving) return
    setOptionsSaving(true)
    setOptionsError(null)
    try {
      const saved = await precheckApi.setProjectExtractionOptions(extractionOptions)
      setExtractionOptions(saved)
      setOptionsSaved(true)
      setTimeout(() => setOptionsSaved(false), 2500)
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : 'Failed to save options.')
    } finally {
      setOptionsSaving(false)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState<string | null>(null)

  const deleteEnabled = deleteConfirm.trim().toLowerCase() === initialName.toLowerCase()

  async function handleDelete() {
    if (!deleteEnabled || deleting) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteProject(projectId)
    setDeleting(false)
    if (!result.success) {
      setDeleteError(result.error ?? 'Failed to delete project.')
      return
    }
    // Clean up localStorage prefs for this project
    try { localStorage.removeItem(prefsKey(projectId)) } catch { /* ignore */ }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-archai-graphite px-6 py-4 flex items-center gap-2">
        <Settings className="h-4 w-4 text-muted-foreground" />
        <div>
          <h1 className="text-base font-semibold text-white">Project Settings</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {initialName} · Created {new Date(createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8 max-w-xl">

        {/* ── General ────────────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">General</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Basic project information.</p>
          </div>

          <form onSubmit={handleRename} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Project Name
              </label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setRenameSaved(false) }}
                className="bg-archai-black border-archai-graphite text-sm h-9 max-w-sm"
                disabled={renaming}
                maxLength={120}
              />
            </div>
            {renameError && (
              <p className="text-xs text-red-400">{renameError}</p>
            )}
            {renameSaved && (
              <p className="text-xs text-emerald-400">Renamed successfully.</p>
            )}
            <Button
              type="submit"
              variant="archai"
              size="sm"
              className="h-8 text-xs"
              disabled={!nameChanged || renaming}
            >
              {renaming && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {renaming ? 'Saving…' : 'Save Name'}
            </Button>
          </form>
        </section>

        {/* Divider */}
        <div className="border-t border-archai-graphite" />

        {/* ── Preferences ────────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Preferences</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Per-project settings stored locally in your browser.
            </p>
          </div>

          {prefsLoaded ? (
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.autoDeleteRunAssets}
                  onChange={(e) => updatePref('autoDeleteRunAssets', e.target.checked)}
                  className="mt-0.5 accent-archai-orange"
                />
                <div>
                  <p className="text-xs font-medium text-white">
                    Auto-delete run assets on run deletion
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    When enabled, deleting a run will also remove its associated documents
                    from storage. Disabled by default — assets are kept for reuse.
                  </p>
                </div>
              </label>
            </div>
          ) : (
            <div className="h-8 w-48 rounded bg-archai-graphite animate-pulse" />
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-archai-graphite" />

        {/* ── Code Checker Options ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Code Checker</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Controls how AI-extracted rules are applied to compliance evaluation.
            </p>
          </div>

          {optionsLoaded ? (
            <div className="space-y-4">
              {/* Auto-apply */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={extractionOptions.ruleAutoApplyEnabled}
                  onChange={(e) => updateOption('ruleAutoApplyEnabled', e.target.checked)}
                  className="mt-0.5 accent-archai-orange"
                />
                <div>
                  <p className="text-xs font-medium text-white">
                    Auto-apply high-confidence extracted rules
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    When enabled, AI-extracted rules above the confidence threshold are
                    treated as authoritative without manual approval. Off by default.
                  </p>
                </div>
              </label>

              {/* Threshold slider — only relevant when auto-apply is on */}
              <div className={`space-y-1.5 pl-6 transition-opacity ${extractionOptions.ruleAutoApplyEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Confidence threshold
                  </label>
                  <span className="text-[10px] text-white font-mono">
                    {Math.round(extractionOptions.ruleAutoApplyConfidenceThreshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.01"
                  value={extractionOptions.ruleAutoApplyConfidenceThreshold}
                  onChange={(e) => updateOption('ruleAutoApplyConfidenceThreshold', parseFloat(e.target.value))}
                  className="w-full max-w-xs accent-archai-orange"
                />
                <p className="text-[10px] text-muted-foreground">
                  Rules below this threshold require manual review. Default: 82%.
                </p>
              </div>

              {/* Manual verification */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={extractionOptions.manualVerificationRequired}
                  onChange={(e) => updateOption('manualVerificationRequired', e.target.checked)}
                  className="mt-0.5 accent-archai-orange"
                />
                <div>
                  <p className="text-xs font-medium text-white">
                    Require manual verification before final evaluation
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Shows a warning if no rules have been reviewed when running compliance.
                    Recommended to keep enabled.
                  </p>
                </div>
              </label>

              {/* Auto-resolve conflicts */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={extractionOptions.autoResolveConflicts}
                  onChange={(e) => updateOption('autoResolveConflicts', e.target.checked)}
                  className="mt-0.5 accent-archai-orange"
                />
                <div>
                  <p className="text-xs font-medium text-white">
                    Auto-resolve rule conflicts
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    When conflicting rules are detected, automatically use the recommended
                    rule (by date &gt; version &gt; confidence). Off by default — manual
                    resolution is preferred for legal accuracy.
                  </p>
                </div>
              </label>

              {optionsError && (
                <p className="text-xs text-red-400">{optionsError}</p>
              )}
              {optionsSaved && (
                <p className="text-xs text-emerald-400">Options saved.</p>
              )}

              <Button
                type="button"
                variant="archai"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void handleSaveOptions()}
                disabled={optionsSaving}
              >
                {optionsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
                {optionsSaving ? 'Saving…' : 'Save Options'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {[60, 90, 75].map((w, i) => (
                <div key={i} className={`h-4 w-${w} rounded bg-archai-graphite animate-pulse`} />
              ))}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-archai-graphite" />

        {/* ── Danger Zone ─────────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-red-400">Danger Zone</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Irreversible actions — proceed with care.
            </p>
          </div>

          <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-red-300">Delete this project</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Permanently deletes the project and all associated runs. Uploaded documents
                in storage are not automatically removed unless the preference above is enabled.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Type <span className="font-mono text-red-400">{initialName}</span> to confirm
              </label>
              <Input
                placeholder={initialName}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="bg-archai-black border-red-400/20 text-sm h-8 max-w-sm"
                disabled={deleting}
              />
            </div>

            {deleteError && (
              <p className="text-xs text-red-400">{deleteError}</p>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-red-400/30 text-red-400 hover:bg-red-900/20 hover:text-red-300 hover:border-red-400/50 disabled:opacity-40"
              disabled={!deleteEnabled || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {deleting ? 'Deleting…' : 'Delete Project'}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
