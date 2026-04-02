export const PRECHECK_RUN_STATUSES = [
  "created",
  "ingesting_site",
  "ingesting_docs",
  "extracting_rules",
  "syncing_model",
  "computing_metrics",
  "synced",
  "evaluating",
  "generating_report",
  "completed",
  "failed",
] as const

export type PrecheckRunStatus = (typeof PRECHECK_RUN_STATUSES)[number]

export const RULE_STATUSES = [
  "draft",
  "reviewed",
  "approved",
  "auto_approved",
  "superseded",
  "rejected",
] as const

export type RuleStatus = (typeof RULE_STATUSES)[number]

export const RULE_SOURCE_KINDS = ["extracted", "manual"] as const
export type RuleSourceKind = (typeof RULE_SOURCE_KINDS)[number]

/** Statuses that count as authoritative for compliance scoring. */
export const AUTHORITATIVE_RULE_STATUSES = new Set<RuleStatus>([
  "reviewed",
  "approved",
  "auto_approved",
])

export const ISSUE_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const

export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

export const CHECK_RESULT_STATUSES = [
  "pass",
  "fail",
  "ambiguous",
  "not_applicable",
  "missing_input",
] as const

export type CheckResultStatus = (typeof CHECK_RESULT_STATUSES)[number]

export const METRIC_KEYS = [
  "building_height_m",
  "front_setback_m",
  "side_setback_left_m",
  "side_setback_right_m",
  "rear_setback_m",
  "gross_floor_area_m2",
  "far",
  "lot_coverage_pct",
  "parking_spaces_required",
  "parking_spaces_provided",
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export const CHECKLIST_CATEGORIES = [
  "site_data",
  "zoning_data",
  "model_data",
  "rules_data",
  "submission_data",
] as const

export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number]

export const ISSUE_TYPES = [
  "violation",
  "warning",
  "missing_data",
  "ambiguous_rule",
  "unsupported_basis",
] as const

export type IssueType = (typeof ISSUE_TYPES)[number]

export const READINESS_LABELS = [
  "permit_ready",
  "issues_to_resolve",
  "incomplete_input",
  "not_yet_evaluated",
] as const

export type ReadinessLabel = (typeof READINESS_LABELS)[number]