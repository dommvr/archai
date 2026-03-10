'use client'

import { useState, useEffect } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IngestSiteInput, SiteContext } from '@/lib/precheck/types'

interface SiteContextFormProps {
  runId: string
  onSubmit: (input: IngestSiteInput) => Promise<void>
  /** Existing persisted site context — used to prefill fields on load/run-switch. */
  siteContext?: SiteContext | null
  isLoading?: boolean
}

export function SiteContextForm({ runId, onSubmit, siteContext, isLoading }: SiteContextFormProps) {
  const [formState, setFormState] = useState({
    address: '',
    municipality: '',
    jurisdictionCode: '',
    zoningDistrict: '',
    parcelAreaM2: '',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setFormState({
      address: siteContext?.address ?? '',
      municipality: siteContext?.municipality ?? '',
      jurisdictionCode: siteContext?.jurisdictionCode ?? '',
      zoningDistrict: siteContext?.zoningDistrict ?? '',
      parcelAreaM2: siteContext?.parcelAreaM2 != null ? String(siteContext.parcelAreaM2) : '',
    })
  }, [runId, siteContext])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const input: IngestSiteInput = {
        runId,
        address: formState.address.trim() || undefined,
        manualOverrides: {
          municipality: formState.municipality.trim() || undefined,
          jurisdictionCode: formState.jurisdictionCode.trim() || undefined,
          zoningDistrict: formState.zoningDistrict.trim() || undefined,
          parcelAreaM2: formState.parcelAreaM2 ? Number(formState.parcelAreaM2) : undefined,
        },
      }
      await onSubmit(input)
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting
  const hasSaved = siteContext != null

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-archai-orange" />
          <p className="text-sm font-medium text-white">Site Context</p>
        </div>
        {hasSaved && (
          <span className="text-[10px] text-emerald-400 font-medium">Saved</span>
        )}
      </div>

      <div className="space-y-3">
        {/* Address */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Address</label>
          <Input
            placeholder="123 Main St, City, State"
            value={formState.address}
            onChange={(e) => setFormState((current) => ({ ...current, address: e.target.value }))}
            className="bg-archai-black border-archai-graphite text-sm h-8"
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Municipality</label>
            <Input
              placeholder="City"
              value={formState.municipality}
              onChange={(e) => setFormState((current) => ({ ...current, municipality: e.target.value }))}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Jurisdiction Code</label>
            <Input
              placeholder="e.g. NYC-2024"
              value={formState.jurisdictionCode}
              onChange={(e) => setFormState((current) => ({ ...current, jurisdictionCode: e.target.value }))}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Zoning District</label>
            <Input
              placeholder="e.g. R7A"
              value={formState.zoningDistrict}
              onChange={(e) => setFormState((current) => ({ ...current, zoningDistrict: e.target.value }))}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Parcel Area (m²)</label>
            <Input
              type="number"
              min="0"
              placeholder="e.g. 850"
              value={formState.parcelAreaM2}
              onChange={(e) => setFormState((current) => ({ ...current, parcelAreaM2: e.target.value }))}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <Button type="submit" variant="archai" size="sm" className="w-full" disabled={disabled}>
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
        {submitting ? 'Saving Site Context…' : hasSaved ? 'Update Site Context' : 'Save Site Context'}
      </Button>

      {/* FASTAPI CALL PLACEHOLDER — will trigger SiteDataProviderService */}
    </form>
  )
}
