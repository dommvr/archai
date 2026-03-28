import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ToolStubPage } from '@/components/dashboard/ToolStubPage'

// READY FOR EXPORT-SYNC INTEGRATION HERE
// SPECKLE EXPORT PLACEHOLDER
export default async function ExportSyncPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle()
  if (!project) redirect('/dashboard')

  return (
    <ToolStubPage
      toolName="Export & Sync"
      description="IFC, Revit, and Rhino export via Speckle connectors. Speckle export integration pending."
    />
  )
}
