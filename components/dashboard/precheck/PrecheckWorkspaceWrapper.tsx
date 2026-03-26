'use client'

/**
 * PrecheckWorkspaceWrapper — bridges the server page and PrecheckWorkspace.
 *
 * Fetches the project's DB-backed active model ref and default site context
 * in parallel and passes them down so new runs are pre-seeded with project
 * defaults in SpeckleModelPicker and SiteContextForm.
 *
 * Falls back to null (no pre-fill) if no defaults have been designated.
 */

import { useState, useEffect } from 'react'
import { PrecheckWorkspace } from './PrecheckWorkspace'
import * as precheckApi from '@/lib/precheck/api'
import type { AuthUser } from '@/types'
import type { SiteContext } from '@/lib/precheck/types'

interface PrecheckWorkspaceWrapperProps {
  user: AuthUser
  projectId: string
}

type ActiveModelRef = {
  streamId: string
  versionId: string
  branchName?: string
  modelName?: string
} | null

// Sentinel value to distinguish "not yet resolved" from "resolved to null"
const PENDING = Symbol('pending')

export function PrecheckWorkspaceWrapper({ user, projectId }: PrecheckWorkspaceWrapperProps) {
  const [projectActiveModelRef, setProjectActiveModelRef] = useState<ActiveModelRef | typeof PENDING>(PENDING)
  const [projectDefaultSiteContext, setProjectDefaultSiteContext] = useState<SiteContext | null | typeof PENDING>(PENDING)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      precheckApi.getProjectActiveModelRef(projectId),
      precheckApi.getProjectDefaultSiteContext(projectId),
    ])
      .then(([activeRef, defaultCtx]) => {
        if (cancelled) return
        setProjectActiveModelRef(
          activeRef
            ? {
                streamId:   activeRef.streamId,
                versionId:  activeRef.versionId,
                branchName: activeRef.branchName ?? undefined,
                modelName:  activeRef.modelName  ?? undefined,
              }
            : null
        )
        setProjectDefaultSiteContext(defaultCtx ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setProjectActiveModelRef(null)
          setProjectDefaultSiteContext(null)
        }
      })

    return () => { cancelled = true }
  }, [projectId])

  // Wait until both are resolved to avoid components re-initialising
  if (projectActiveModelRef === PENDING || projectDefaultSiteContext === PENDING) return null

  return (
    <PrecheckWorkspace
      user={user}
      projectId={projectId}
      projectActiveModelRef={projectActiveModelRef}
      projectDefaultSiteContext={projectDefaultSiteContext}
    />
  )
}
