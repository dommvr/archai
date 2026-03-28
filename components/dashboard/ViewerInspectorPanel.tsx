'use client'

import { cn } from '@/lib/utils'
import type { ViewerSelectedObject } from '@/types'
import { X, Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface ViewerInspectorPanelProps {
  selectedObject: ViewerSelectedObject | null
  /** Source model version info to display in the panel when available. */
  modelRef?: { streamId: string; versionId: string } | null
  onClose?: () => void
}

/** Extract a non-empty string from raw Speckle object properties under any of the given keys. */
function getString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = raw[key]
    if (typeof val === 'string' && val.trim() !== '') return val.trim()
  }
  return undefined
}

/** Extract a number from a raw Speckle object property. */
function getNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const val = raw[key]
  return typeof val === 'number' ? val : undefined
}

interface PropRowProps {
  label: string
  value: string
  mono?: boolean
}

function PropRow({ label, value, mono }: PropRowProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 pt-px">{label}</span>
      <span
        className={cn(
          'text-[10px] text-white/80 text-right break-all',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * ViewerInspectorPanel — floating object properties panel.
 *
 * Slides in from the right edge of the viewer when an object is clicked.
 * Displays available Speckle object properties from the tree node's raw data.
 *
 * TODO READY FOR ADVANCED PROPERTY DATA INTEGRATION HERE
 * Future: fetch extended BIM properties (parameters, materials, type info)
 * via viewer.getWorldTree().findId(selectedObject.id) and traverse ancestors
 * for family/type context. These require async tree traversal once the
 * viewer's WorldTree API is fully explored.
 */
export function ViewerInspectorPanel({ selectedObject, modelRef, onClose }: ViewerInspectorPanelProps) {
  const visible = selectedObject !== null
  const [copied, setCopied] = useState(false)

  const raw = selectedObject?.raw ?? {}

  // Object identity
  const speckleType = getString(raw, 'speckle_type')
  const name        = getString(raw, 'name', '@elementName', 'family', 'type')
  const appId       = getString(raw, 'applicationId')

  // Architectural context
  const level    = getString(raw, 'level', '@level')
  const category = getString(raw, 'category', 'elementClass')
  const layer    = getString(raw, 'layer', '@layer', 'renderMaterial.name')

  // Measurements
  const volume    = getNumber(raw, 'volume')
  const area      = getNumber(raw, 'area')
  const height    = getNumber(raw, 'height') ?? getNumber(raw, 'Height')
  const width     = getNumber(raw, 'width')  ?? getNumber(raw, 'Width')
  const thickness = getNumber(raw, 'thickness')

  const hasAnyProp = speckleType || name || level || category || layer
    || typeof volume === 'number' || typeof area === 'number'
    || typeof height === 'number' || typeof width === 'number'
    || typeof thickness === 'number'

  function handleCopyId() {
    if (!selectedObject) return
    void navigator.clipboard.writeText(selectedObject.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className={cn(
        'absolute top-4 right-4 z-20 w-64',
        'transition-transform duration-200 ease-out',
        visible ? 'translate-x-0' : 'translate-x-[calc(100%+2rem)]',
      )}
      aria-hidden={!visible}
    >
      <div className="glass-panel rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Properties
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-white transition-colors shrink-0"
              aria-label="Close properties"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Object ID — full, copyable */}
        {selectedObject && (
          <div className="mx-3 mb-2 rounded-lg bg-archai-graphite/40 px-2 py-1.5">
            <div className="flex items-start justify-between gap-1.5">
              <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider shrink-0 mt-px">
                ID
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/80 break-all flex-1 text-right leading-relaxed">
                {selectedObject.id}
              </span>
              <button
                onClick={handleCopyId}
                className="shrink-0 mt-px text-muted-foreground/60 hover:text-white transition-colors"
                aria-label="Copy object ID"
                title="Copy ID"
              >
                {copied
                  ? <Check className="h-2.5 w-2.5 text-green-400" />
                  : <Copy className="h-2.5 w-2.5" />
                }
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-archai-graphite/60 mx-3" />

        {/* Properties */}
        <div className="px-3 py-2.5 space-y-1.5">
          {speckleType && <PropRow label="Type"     value={speckleType} />}
          {name        && <PropRow label="Name"     value={name} />}
          {appId       && <PropRow label="App ID"   value={appId} mono />}
          {level       && <PropRow label="Level"    value={level} />}
          {category    && <PropRow label="Category" value={category} />}
          {layer       && <PropRow label="Layer"    value={layer} />}

          {/* Measurements section */}
          {(typeof volume === 'number' || typeof area === 'number' ||
            typeof height === 'number' || typeof width === 'number' ||
            typeof thickness === 'number') && (
            <>
              <div className="h-px bg-archai-graphite/40 my-1" />
              {typeof volume    === 'number' && <PropRow label="Volume"    value={`${volume.toFixed(2)} m³`} />}
              {typeof area      === 'number' && <PropRow label="Area"      value={`${area.toFixed(2)} m²`} />}
              {typeof height    === 'number' && <PropRow label="Height"    value={`${height.toFixed(2)} m`} />}
              {typeof width     === 'number' && <PropRow label="Width"     value={`${width.toFixed(2)} m`} />}
              {typeof thickness === 'number' && <PropRow label="Thickness" value={`${thickness.toFixed(3)} m`} />}
            </>
          )}

          {/* Source model info if available */}
          {modelRef && (
            <>
              <div className="h-px bg-archai-graphite/40 my-1" />
              <PropRow label="Stream" value={modelRef.streamId} mono />
              <PropRow label="Version" value={modelRef.versionId} mono />
            </>
          )}

          {/* Fallback */}
          {!hasAnyProp && (
            <p className="text-[10px] text-muted-foreground/50 italic">
              No properties available for this object.
            </p>
          )}
        </div>

        {/* TODO READY FOR ADVANCED PROPERTY DATA INTEGRATION HERE */}
        {/* Future: Show BIM parameters, materials, type data fetched via WorldTree */}
        {/* via viewer.getWorldTree().findId(selectedObject.id) tree traversal */}
      </div>
    </div>
  )
}
