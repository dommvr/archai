import type { CheckResultStatus, IssueSeverity, MetricKey } from "./constants"
import type { ExtractedRule, GeometrySnapshot, SiteContext } from "./types"

export type MetricMap = Partial<Record<MetricKey, number>>

export type RuleEvaluationContext = {
  siteContext: SiteContext | null
  geometrySnapshot: GeometrySnapshot | null
  metricMap: MetricMap
}

export type RuleEvaluationResult = {
  ruleId: string
  metricKey: MetricKey
  status: CheckResultStatus
  severity: IssueSeverity
  actualValue?: number
  expectedValue?: number
  expectedMin?: number
  expectedMax?: number
  units?: string
  title: string
  summary: string
  explanation?: string
  affectedObjectIds: string[]
}

export function getMetricValue(
  snapshot: GeometrySnapshot | null,
  key: MetricKey
): number | undefined {
  if (!snapshot) return undefined
  return snapshot.metrics.find((m) => m.key === key)?.value
}

export function evaluateRule(
  rule: ExtractedRule,
  context: RuleEvaluationContext
): RuleEvaluationResult {
  const actualValue =
    context.metricMap[rule.metricKey] ??
    getMetricValue(context.geometrySnapshot, rule.metricKey)

  if (actualValue === undefined) {
    return {
      ruleId: rule.id,
      metricKey: rule.metricKey,
      status: "missing_input",
      severity: "warning",
      title: rule.title,
      summary: `Missing metric required to evaluate ${rule.metricKey}.`,
      affectedObjectIds: [],
    }
  }

  if (rule.operator === "<=" && rule.valueNumber != null) {
    const pass = actualValue <= rule.valueNumber
    return {
      ruleId: rule.id,
      metricKey: rule.metricKey,
      status: pass ? "pass" : "fail",
      severity: pass ? "info" : "error",
      actualValue,
      expectedValue: rule.valueNumber,
      units: rule.units ?? undefined,
      title: rule.title,
      summary: pass
        ? `${rule.metricKey} is within the allowed limit.`
        : `${rule.metricKey} exceeds the allowed limit.`,
      affectedObjectIds: [],
    }
  }

  if (rule.operator === ">=" && rule.valueNumber != null) {
    const pass = actualValue >= rule.valueNumber
    return {
      ruleId: rule.id,
      metricKey: rule.metricKey,
      status: pass ? "pass" : "fail",
      severity: pass ? "info" : "error",
      actualValue,
      expectedValue: rule.valueNumber,
      units: rule.units ?? undefined,
      title: rule.title,
      summary: pass
        ? `${rule.metricKey} meets the minimum requirement.`
        : `${rule.metricKey} is below the minimum requirement.`,
      affectedObjectIds: [],
    }
  }

  if (
    rule.operator === "between" &&
    rule.valueMin != null &&
    rule.valueMax != null
  ) {
    const pass = actualValue >= rule.valueMin && actualValue <= rule.valueMax
    return {
      ruleId: rule.id,
      metricKey: rule.metricKey,
      status: pass ? "pass" : "fail",
      severity: pass ? "info" : "error",
      actualValue,
      expectedMin: rule.valueMin,
      expectedMax: rule.valueMax,
      units: rule.units ?? undefined,
      title: rule.title,
      summary: pass
        ? `${rule.metricKey} falls within the allowed range.`
        : `${rule.metricKey} falls outside the allowed range.`,
      affectedObjectIds: [],
    }
  }

  return {
    ruleId: rule.id,
    metricKey: rule.metricKey,
    status: "ambiguous",
    severity: "warning",
    actualValue,
    units: rule.units ?? undefined,
    title: rule.title,
    summary: "Rule operator/value combination is not fully supported yet.",
    affectedObjectIds: [],
  }
}