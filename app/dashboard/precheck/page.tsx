import { redirect } from "next/navigation"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export default async function PrecheckPage() {
  const supabase = await getSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/")

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">
          Smart Zoning & Code Checker
        </h1>
        <p className="text-sm text-muted-foreground">
          Tool 1 foundation is ready. UI and live workflows will mount here.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-muted-foreground">
          READY FOR TOOL 1 INTEGRATION HERE
        </p>
      </div>
    </div>
  )
}