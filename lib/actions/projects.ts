'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { Project, ProjectDeleteResult } from '@/types'

/**
 * Fetch all projects for the authenticated user, ordered by most recently updated.
 */
export async function getProjects(): Promise<{ projects: Project[]; error?: string }> {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { projects: [], error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, updated_at, user_id, speckle_stream_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) return { projects: [], error: error.message }

  const projects: Project[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
    speckleStreamId: row.speckle_stream_id ?? undefined,
  }))

  return { projects }
}

/**
 * Create a new project for the authenticated user.
 * Returns the created project on success.
 */
export async function createProject(
  name: string
): Promise<{ project?: Project; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Project name is required.' }

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthenticated' }

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('projects')
    .insert({ name: trimmed, user_id: user.id, created_at: now, updated_at: now })
    .select('id, name, created_at, updated_at, user_id, speckle_stream_id')
    .single()

  if (error) return { error: error.message }

  const project: Project = {
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    userId: data.user_id,
    speckleStreamId: data.speckle_stream_id ?? undefined,
  }

  return { project }
}

/**
 * Rename a project owned by the authenticated user.
 */
export async function renameProject(
  projectId: string,
  name: string
): Promise<{ project?: Project; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Project name is required.' }

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('projects')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('user_id', user.id)
    .select('id, name, created_at, updated_at, user_id, speckle_stream_id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Project not found or permission denied.' }

  return {
    project: {
      id: data.id,
      name: data.name,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      userId: data.user_id,
      speckleStreamId: data.speckle_stream_id ?? undefined,
    },
  }
}

/**
 * Delete a project owned by the authenticated user.
 */
export async function deleteProject(projectId: string): Promise<ProjectDeleteResult> {
  const trimmedProjectId = projectId.trim()
  if (!trimmedProjectId) {
    return { success: false, error: 'Project ID is required.' }
  }

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Unauthenticated' }
  }

  const { data, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', trimmedProjectId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    return { success: false, error: error.message }
  }

  if (!data) {
    return {
      success: false,
      error: 'Project not found or you do not have permission to delete it.',
    }
  }

  return { success: true }
}
