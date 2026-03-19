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
  "rejected",
] as const

export type RuleStatus = (typeof RULE_STATUSES)[number]

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