import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ToolStubPage } from '@/components/dashboard/ToolStubPage'

// READY FOR TOOL 3 INTEGRATION HERE
export default async function SpacePlannerPage({
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
      toolName="Space Planner / Test-Fit"
      description="Generate space layouts from program requirements. LangGraph agent integration pending."
    />
  )
}
