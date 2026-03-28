import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ToolStubPage } from '@/components/dashboard/ToolStubPage'

// READY FOR TOOL 5 INTEGRATION HERE
export default async function OptionComparisonPage({
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
      toolName="Option Comparison Board"
      description="Side-by-side comparison of design alternatives. Integration pending."
    />
  )
}
