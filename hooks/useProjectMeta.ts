'use client'

/**
 * useProjectMeta — client-side persistence for project pin and last-opened timestamps.
 *
 * This data is stored in localStorage so it survives page refreshes without
 * requiring a database migration. The server-side Project record is not affected.
 *
 * Shape of the stored object per project:
 *   { pinned: boolean, pinnedAt: string | null, lastOpenedAt: string | null }
 */

import { useCallback } from 'react'

const STORAGE_KEY = 'archai:projectMeta'

interface ProjectMeta {
  pinned: boolean
  pinnedAt: string | null
  lastOpenedAt: string | null
}

type MetaStore = Record<string, ProjectMeta>

function readStore(): MetaStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as MetaStore) : {}
  } catch {
    return {}
  }
}

function writeStore(store: MetaStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore quota errors — the switcher degrades gracefully.
  }
}

function getMeta(projectId: string): ProjectMeta {
  return readStore()[projectId] ?? { pinned: false, pinnedAt: null, lastOpenedAt: null }
}

function setMeta(projectId: string, patch: Partial<ProjectMeta>): void {
  const store = readStore()
  store[projectId] = { ...getMeta(projectId), ...patch }
  writeStore(store)
}

export function useProjectMeta() {
  /** Record that the user opened a project right now. */
  const recordOpened = useCallback((projectId: string) => {
    setMeta(projectId, { lastOpenedAt: new Date().toISOString() })
  }, [])

  /** Toggle the pinned state of a project. Returns the new pinned value. */
  const togglePin = useCallback((projectId: string): boolean => {
    const current = getMeta(projectId)
    const nextPinned = !current.pinned
    setMeta(projectId, {
      pinned: nextPinned,
      pinnedAt: nextPinned ? new Date().toISOString() : null,
    })
    return nextPinned
  }, [])

  /** Read enriched meta for a project. */
  const getProjectMeta = useCallback((projectId: string): ProjectMeta => {
    return getMeta(projectId)
  }, [])

  return { recordOpened, togglePin, getProjectMeta }
}

/**
 * Pure helper (no React): sort a project list for the compact switcher.
 *
 * Rules:
 *   1. Pinned projects first, ordered by pinnedAt DESC (most recently pinned first)
 *   2. Then non-pinned projects ordered by lastOpenedAt DESC (most recently opened)
 *   3. A project that appears in the pinned set is NOT repeated in the recent set
 *   4. Total list capped at maxItems
 */
export function sortProjectsForSwitcher<T extends { id: string }>(
  projects: T[],
  maxItems = 5,
): T[] {
  const store = readStore()

  const pinned = projects
    .filter((p) => store[p.id]?.pinned)
    .sort((a, b) => {
      const at = store[a.id]?.pinnedAt ?? ''
      const bt = store[b.id]?.pinnedAt ?? ''
      return bt.localeCompare(at)
    })

  const pinnedIds = new Set(pinned.map((p) => p.id))

  const recent = projects
    .filter((p) => !pinnedIds.has(p.id))
    .sort((a, b) => {
      const at = store[a.id]?.lastOpenedAt ?? ''
      const bt = store[b.id]?.lastOpenedAt ?? ''
      return bt.localeCompare(at)
    })

  return [...pinned, ...recent].slice(0, maxItems)
}
