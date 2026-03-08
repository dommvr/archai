export type SiteDataProviderServiceContract = {
  geocodeAddress(address: string): Promise<unknown>
  getParcelByPoint(lat: number, lng: number): Promise<unknown>
  getZoningByParcel(parcelId: string): Promise<unknown>
  normalizeSiteContext(input: unknown): Promise<unknown>
}

export type DocumentIngestionServiceContract = {
  createUploadedDocument(input: unknown): Promise<unknown>
  extractText(storagePath: string): Promise<string>
  chunkDocument(input: { documentId: string; text: string }): Promise<unknown[]>
  storeChunks(chunks: unknown[]): Promise<void>
  embedChunks(chunks: unknown[]): Promise<void>
}

export type RuleExtractionServiceContract = {
  extractRulesFromChunks(input: { runId: string; documentIds?: string[] }): Promise<unknown[]>
  normalizeRule(rule: unknown): Promise<unknown>
  storeRules(rules: unknown[]): Promise<void>
  markRuleStatus(ruleId: string, status: "draft" | "reviewed" | "rejected"): Promise<void>
}

export type SpeckleServiceContract = {
  getModelVersions(projectId: string): Promise<unknown[]>
  fetchVersionObjects(input: { streamId: string; versionId: string }): Promise<unknown>
  deriveGeometrySnapshot(input: { runId: string; streamId: string; versionId: string }): Promise<unknown>
}

export type ComplianceEngineServiceContract = {
  selectApplicableRules(runId: string): Promise<unknown[]>
  resolveMetrics(runId: string): Promise<Record<string, number>>
  evaluateRules(runId: string): Promise<unknown[]>
  generateIssues(runId: string): Promise<unknown[]>
  generateReadinessScore(runId: string): Promise<number>
  generateChecklist(runId: string): Promise<unknown[]>
}

export type RealtimePublisherContract = {
  publishRunStatus(runId: string, status: string, currentStep?: string): Promise<void>
  publishIssues(runId: string, issues: unknown[]): Promise<void>
  publishScore(runId: string, score: number): Promise<void>
}