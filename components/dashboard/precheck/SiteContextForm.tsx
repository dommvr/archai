'use client'

import { useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IngestSiteInput } from '@/lib/precheck/types'

interface SiteContextFormProps {
  runId: string
  onSubmit: (input: IngestSiteInput) => Promise<void>
  isLoading?: boolean
}

export function SiteContextForm({ runId, onSubmit, isLoading }: SiteContextFormProps) {
  const [address,          setAddress]          = useState('')
  const [municipality,     setMunicipality]     = useState('')
  const [jurisdictionCode, setJurisdictionCode] = useState('')
  const [zoningDistrict,   setZoningDistrict]   = useState('')
  const [parcelAreaM2,     setParcelAreaM2]      = useState('')
  const [submitting,       setSubmitting]        = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const input: IngestSiteInput = {
        runId,
        address: address.trim() || undefined,
        manualOverrides: {
          municipality:     municipality.trim()     || undefined,
          jurisdictionCode: jurisdictionCode.trim() || undefined,
          zoningDistrict:   zoningDistrict.trim()   || undefined,
          parcelAreaM2:     parcelAreaM2 ? Number(parcelAreaM2) : undefined,
        },
      }
      await onSubmit(input)
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Site Context</p>
      </div>

      <div className="space-y-3">
        {/* Address */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Address</label>
          <Input
            placeholder="123 Main St, City, State"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="bg-archai-black border-archai-graphite text-sm h-8"
            disabled={disabled}
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
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Jurisdiction Code</label>
            <Input
              placeholder="e.g. NYC-2024"
              value={jurisdictionCode}
              onChange={(e) => setJurisdictionCode(e.target.value)}
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
              value={zoningDistrict}
              onChange={(e) => setZoningDistrict(e.target.value)}
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
              value={parcelAreaM2}
              onChange={(e) => setParcelAreaM2(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <Button type="submit" variant="archai" size="sm" className="w-full" disabled={disabled}>
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
        {submitting ? 'Saving Site Context…' : 'Save Site Context'}
      </Button>

      {/* FASTAPI CALL PLACEHOLDER — will trigger SiteDataProviderService */}
    </form>
  )
}
