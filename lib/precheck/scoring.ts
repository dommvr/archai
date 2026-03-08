import type { CheckResultStatus, IssueSeverity } from "./constants"

export type ScoreIssueLike = {
  severity: IssueSeverity
  status: CheckResultStatus
}

export type ScoreContext = {
  hasParcelData: boolean
  hasZoningData: boolean
  hasReviewedRules: boolean
  hasGeometrySnapshot: boolean
}

export function calculateReadinessScore(
  issues: ScoreIssueLike[],
  context: ScoreContext
): number {
  if (!context.hasGeometrySnapshot) return 0

  let score = 100

  for (const issue of issues) {
    if (issue.status === "ambiguous") score -= 5
    if (issue.status === "missing_input") score -= 8

    if (issue.status === "fail") {
      if (issue.severity === "critical") score -= 25
      else if (issue.severity === "error") score -= 15
      else if (issue.severity === "warning") score -= 7
    }
  }

  score = Math.max(0, score)

  if (!context.hasParcelData || !context.hasZoningData) {
    score = Math.min(score, 60)
  }

  if (!context.hasReviewedRules) {
    score = Math.min(score, 50)
  }

  return score
}