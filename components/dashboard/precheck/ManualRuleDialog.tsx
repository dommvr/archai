'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { METRIC_KEYS } from '@/lib/precheck/constants'
import type { CreateManualRuleInput, ExtractedRule, UpdateManualRuleInput } from '@/lib/precheck/types'

const METRIC_LABELS: Record<string, string> = {
  building_height_m:       'Building Height (m)',
  front_setback_m:         'Front Setback (m)',
  side_setback_left_m:     'Side Setback Left (m)',
  side_setback_right_m:    'Side Setback Right (m)',
  rear_setback_m:          'Rear Setback (m)',
  gross_floor_area_m2:     'Gross Floor Area (m²)',
  far:                     'Floor Area Ratio (FAR)',
  lot_coverage_pct:        'Lot Coverage (%)',
  parking_spaces_required: 'Parking Spaces Required',
  parking_spaces_provided: 'Parking Spaces Provided',
}

const OPERATOR_LABELS: Record<string, string> = {
  '<=': '≤ max',
  '>=': '≥ min',
  '<':  '< strict max',
  '>':  '> strict min',
  '=':  '= exactly',
  between: 'between min – max',
}

interface ManualRuleDialogProps {
  open:      boolean
  onClose:   () => void
  projectId: string
  runId?:    string
  /**
   * When provided, the dialog opens in edit mode with the rule's values
   * pre-filled. `onUpdate` must also be provided in this case.
   */
  editRule?: ExtractedRule
  /** Called with the new rule after successful creation. */
  onCreate:  (input: CreateManualRuleInput) => Promise<ExtractedRule>
  /** Called when saving an edit. Required when `editRule` is set. */
  onUpdate?: (input: UpdateManualRuleInput) => Promise<ExtractedRule>
}

const DEFAULT_FORM = {
  ruleCode:      '',
  title:         '',
  description:   '',
  metricKey:     'building_height_m' as CreateManualRuleInput['metricKey'],
  operator:      '<=' as CreateManualRuleInput['operator'],
  valueNumber:   '',
  valueMin:      '',
  valueMax:      '',
  units:         '',
  conditionText: '',
  exceptionText: '',
  versionLabel:  '',
  effectiveDate: '',
}

export function ManualRuleDialog({
  open,
  onClose,
  projectId,
  runId,
  editRule,
  onCreate,
  onUpdate,
}: ManualRuleDialogProps) {
  const isEditing = Boolean(editRule)

  // Pre-fill form from editRule when in edit mode, otherwise use defaults.
  const [form, setForm] = useState(() =>
    editRule
      ? {
          ruleCode:      editRule.ruleCode,
          title:         editRule.title,
          description:   editRule.description ?? '',
          metricKey:     editRule.metricKey as CreateManualRuleInput['metricKey'],
          operator:      editRule.operator as CreateManualRuleInput['operator'],
          valueNumber:   editRule.valueNumber != null ? String(editRule.valueNumber) : '',
          valueMin:      editRule.valueMin    != null ? String(editRule.valueMin)    : '',
          valueMax:      editRule.valueMax    != null ? String(editRule.valueMax)    : '',
          units:         editRule.units ?? '',
          conditionText: editRule.conditionText ?? '',
          exceptionText: editRule.exceptionText ?? '',
          versionLabel:  editRule.versionLabel  ?? '',
          effectiveDate: editRule.effectiveDate
            ? new Date(editRule.effectiveDate).toISOString().slice(0, 10)
            : '',
        }
      : DEFAULT_FORM
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-sync form whenever the dialog opens or the rule being edited changes.
  // The useState initializer only runs once on mount, so without this effect
  // the form would retain stale values when the user edits different rules
  // in sequence without unmounting the component.
  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      editRule
        ? {
            ruleCode:      editRule.ruleCode,
            title:         editRule.title,
            description:   editRule.description ?? '',
            metricKey:     editRule.metricKey as CreateManualRuleInput['metricKey'],
            operator:      editRule.operator as CreateManualRuleInput['operator'],
            valueNumber:   editRule.valueNumber != null ? String(editRule.valueNumber) : '',
            valueMin:      editRule.valueMin    != null ? String(editRule.valueMin)    : '',
            valueMax:      editRule.valueMax    != null ? String(editRule.valueMax)    : '',
            units:         editRule.units ?? '',
            conditionText: editRule.conditionText ?? '',
            exceptionText: editRule.exceptionText ?? '',
            versionLabel:  editRule.versionLabel  ?? '',
            effectiveDate: editRule.effectiveDate
              ? new Date(editRule.effectiveDate).toISOString().slice(0, 10)
              : '',
          }
        : DEFAULT_FORM
    )
  }, [open, editRule])

  const isBetween = form.operator === 'between'

  function update(field: keyof typeof DEFAULT_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.ruleCode.trim() || !form.title.trim()) {
      setError('Rule code and title are required.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && editRule && onUpdate) {
        // Edit mode: build UpdateManualRuleInput
        const updateInput: UpdateManualRuleInput = {
          ruleId:       editRule.id,
          ruleCode:     form.ruleCode.trim(),
          title:        form.title.trim(),
          description:  form.description.trim() || null,
          operator:     form.operator,
          units:        form.units.trim() || null,
          conditionText: form.conditionText.trim() || null,
          exceptionText: form.exceptionText.trim() || null,
          versionLabel:  form.versionLabel.trim()  || null,
          effectiveDate: form.effectiveDate.trim()  || null,
        }

        if (isBetween) {
          const min = parseFloat(form.valueMin)
          const max = parseFloat(form.valueMax)
          if (isNaN(min) || isNaN(max)) {
            setError('Both min and max values are required for "between".')
            setSaving(false)
            return
          }
          updateInput.valueNumber = null
          updateInput.valueMin    = min
          updateInput.valueMax    = max
        } else {
          const val = parseFloat(form.valueNumber)
          if (isNaN(val)) {
            setError('A numeric value is required.')
            setSaving(false)
            return
          }
          updateInput.valueNumber = val
          updateInput.valueMin    = null
          updateInput.valueMax    = null
        }

        await onUpdate(updateInput)
      } else {
        // Create mode
        const input: CreateManualRuleInput = {
          projectId,
          runId,
          ruleCode:    form.ruleCode.trim(),
          title:       form.title.trim(),
          description: form.description.trim() || undefined,
          metricKey:   form.metricKey,
          operator:    form.operator,
          units:       form.units.trim() || undefined,
          conditionText: form.conditionText.trim() || undefined,
          exceptionText: form.exceptionText.trim() || undefined,
          versionLabel:  form.versionLabel.trim() || undefined,
          effectiveDate: form.effectiveDate.trim() || undefined,
        }

        if (isBetween) {
          const min = parseFloat(form.valueMin)
          const max = parseFloat(form.valueMax)
          if (isNaN(min) || isNaN(max)) {
            setError('Both min and max values are required for "between".')
            setSaving(false)
            return
          }
          input.valueMin = min
          input.valueMax = max
        } else {
          const val = parseFloat(form.valueNumber)
          if (isNaN(val)) {
            setError('A numeric value is required.')
            setSaving(false)
            return
          }
          input.valueNumber = val
        }

        await onCreate(input)
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? 'Failed to update rule.' : 'Failed to create rule.')
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md bg-archai-charcoal border-archai-graphite text-white">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEditing ? 'Edit Manual Rule' : 'Add Manual Rule'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {isEditing
              ? 'Update the fields below. Changes take effect on the next compliance run.'
              : 'Manual rules are authoritative by default and drive compliance results immediately.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Rule code + title */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rule code *</Label>
              <Input
                placeholder="e.g. ZC-4.2.1"
                value={form.ruleCode}
                onChange={(e) => update('ruleCode', e.target.value)}
                className="bg-archai-black border-archai-graphite text-white text-sm h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Version / edition</Label>
              <Input
                placeholder="e.g. 2023"
                value={form.versionLabel}
                onChange={(e) => update('versionLabel', e.target.value)}
                className="bg-archai-black border-archai-graphite text-white text-sm h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Title *</Label>
            <Input
              placeholder="e.g. Maximum building height"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className="bg-archai-black border-archai-graphite text-white text-sm h-8"
            />
          </div>

          {/* Metric + operator */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Metric *{isEditing && <span className="ml-1 text-muted-foreground/50">(locked)</span>}
              </Label>
              <select
                value={form.metricKey}
                onChange={(e) => update('metricKey', e.target.value)}
                disabled={isEditing}
                className="w-full h-8 rounded-md border border-archai-graphite bg-archai-black px-2 text-sm text-white appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {METRIC_KEYS.map((k) => (
                  <option key={k} value={k}>{METRIC_LABELS[k] ?? k}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Operator *</Label>
              <select
                value={form.operator}
                onChange={(e) => update('operator', e.target.value)}
                className="w-full h-8 rounded-md border border-archai-graphite bg-archai-black px-2 text-sm text-white appearance-none cursor-pointer"
              >
                {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                  <option key={op} value={op}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Value(s) + units */}
          <div className={`grid gap-3 ${isBetween ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {isBetween ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Min *</Label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={form.valueMin}
                    onChange={(e) => update('valueMin', e.target.value)}
                    className="bg-archai-black border-archai-graphite text-white text-sm h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max *</Label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="100"
                    value={form.valueMax}
                    onChange={(e) => update('valueMax', e.target.value)}
                    className="bg-archai-black border-archai-graphite text-white text-sm h-8"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Value *</Label>
                <Input
                  type="number"
                  step="any"
                  placeholder="e.g. 12"
                  value={form.valueNumber}
                  onChange={(e) => update('valueNumber', e.target.value)}
                  className="bg-archai-black border-archai-graphite text-white text-sm h-8"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Units</Label>
              <Input
                placeholder="m / m² / %"
                value={form.units}
                onChange={(e) => update('units', e.target.value)}
                className="bg-archai-black border-archai-graphite text-white text-sm h-8"
              />
            </div>
          </div>

          {/* Condition / exception */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Condition (optional)</Label>
            <Input
              placeholder="e.g. Applies to R-2 districts only"
              value={form.conditionText}
              onChange={(e) => update('conditionText', e.target.value)}
              className="bg-archai-black border-archai-graphite text-white text-sm h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Exception (optional)</Label>
            <Input
              placeholder="e.g. Mechanical penthouses excluded"
              value={form.exceptionText}
              onChange={(e) => update('exceptionText', e.target.value)}
              className="bg-archai-black border-archai-graphite text-white text-sm h-8"
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400 border border-red-400/30 bg-red-400/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="archai" size="sm" type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
