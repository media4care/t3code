import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ScheduledTask } from "./scheduledTask.ts";
import { OrchestrationV2RunStatus } from "./orchestrationV2.ts";

const Text = TrimmedNonEmptyString.check(Schema.isMaxLength(12000));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(300));
export const InsightStatus = Schema.Literals([
  "open",
  "accepted",
  "deferred",
  "dismissed",
  "implemented",
]);
export type InsightStatus = typeof InsightStatus.Type;
export const InsightCategory = Schema.Literals([
  "skill",
  "orchestration",
  "model",
  "tooling",
  "environment",
  "verification",
]);

export const InsightsSettings = Schema.Struct({
  enabled: Schema.Boolean,
  projectId: ProjectId,
  projectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(100)),
  modelSelection: ModelSelection,
  timeOfDay: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  lookbackDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
  maxRuns: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 200 })),
});
export type InsightsSettings = typeof InsightsSettings.Type;

export const InsightEvidence = Schema.Struct({
  id: ShortText,
  threadId: ThreadId,
  runId: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  projectId: ProjectId,
  occurredAt: IsoDateTime,
  title: Schema.String,
  kind: Schema.Literals(["run", "message", "tool", "workflow", "attribution"]),
  text: Schema.String,
});
export type InsightEvidence = typeof InsightEvidence.Type;

export const InsightProposal = Schema.Struct({
  key: ShortText,
  title: ShortText,
  category: InsightCategory,
  priority: Schema.Literals(["high", "medium", "low"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
  observation: Text,
  recommendation: Text,
  targetFile: Schema.NullOr(ShortText),
  suggestedChange: Text,
  expectedImpact: Text,
  validation: Text,
  evidenceIds: Schema.Array(ShortText).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
});
export type InsightProposal = typeof InsightProposal.Type;

export const InsightRecommendation = Schema.Struct({
  ...InsightProposal.fields,
  id: Schema.String,
  status: InsightStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  occurrences: NonNegativeInt,
  note: Schema.String,
  deferredUntil: Schema.NullOr(IsoDateTime),
  implementationThreadId: Schema.NullOr(ThreadId),
  implementationRef: Schema.NullOr(Schema.String),
  evidence: Schema.Array(InsightEvidence),
  assessments: Schema.Array(
    Schema.Struct({
      reportId: Schema.String,
      createdAt: IsoDateTime,
      outcome: Schema.Literals(["improved", "unchanged", "regressed", "insufficient_evidence"]),
      explanation: Text,
      evidence: Schema.Array(InsightEvidence),
    }),
  ),
  history: Schema.Array(
    Schema.Struct({ at: IsoDateTime, status: InsightStatus, note: Schema.String }),
  ),
});
export type InsightRecommendation = typeof InsightRecommendation.Type;

export const InsightsMetrics = Schema.Struct({
  runs: NonNegativeInt,
  completed: NonNegativeInt,
  failed: NonNegativeInt,
  interrupted: NonNegativeInt,
  active: NonNegativeInt,
  toolFailures: NonNegativeInt,
  humanRequests: NonNegativeInt,
  subagents: NonNegativeInt,
  tokens: NonNegativeInt,
  runsWithTokenUsage: NonNegativeInt,
  activeMilliseconds: NonNegativeInt,
});
export type InsightsMetrics = typeof InsightsMetrics.Type;

export const InsightsReport = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  status: Schema.Literals(["analyzing", "completed", "failed", "empty"]),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  summary: Schema.String,
  wins: Schema.Array(Schema.Struct({ text: Text, evidenceIds: Schema.Array(ShortText) })),
  limitations: Schema.Array(Text),
  metrics: InsightsMetrics,
  evidence: Schema.Array(InsightEvidence),
  recommendationIds: Schema.Array(Schema.String),
  scopeKey: Schema.String,
  fromSequence: NonNegativeInt,
  throughSequence: NonNegativeInt,
  hasMore: Schema.Boolean,
  modelSelection: ModelSelection,
});
export type InsightsReport = typeof InsightsReport.Type;

export const InsightsSnapshot = Schema.Struct({
  settings: Schema.NullOr(InsightsSettings),
  schedule: Schema.NullOr(ScheduledTask),
  latestAnalysis: Schema.NullOr(
    Schema.Struct({ threadId: ThreadId, status: OrchestrationV2RunStatus }),
  ),
  reports: Schema.Array(InsightsReport),
  recommendations: Schema.Array(InsightRecommendation),
  truncated: Schema.Boolean,
});
export type InsightsSnapshot = typeof InsightsSnapshot.Type;

export const InsightsSubmitInput = Schema.Struct({
  reportId: ShortText,
  summary: Text,
  wins: Schema.Array(
    Schema.Struct({
      text: Text,
      evidenceIds: Schema.Array(ShortText).check(Schema.isMinLength(1)),
    }),
  ).check(Schema.isMaxLength(8)),
  limitations: Schema.Array(Text).check(Schema.isMaxLength(12)),
  recommendations: Schema.Array(InsightProposal).check(Schema.isMaxLength(8)),
  assessments: Schema.Array(
    Schema.Struct({
      recommendationId: ShortText,
      outcome: Schema.Literals(["improved", "unchanged", "regressed", "insufficient_evidence"]),
      explanation: Text,
      evidenceIds: Schema.Array(ShortText).check(Schema.isMaxLength(12)),
    }),
  ).check(Schema.isMaxLength(20)),
});
export type InsightsSubmitInput = typeof InsightsSubmitInput.Type;

export const InsightUpdateInput = Schema.Struct({
  id: ShortText,
  status: InsightStatus,
  note: Schema.String.check(Schema.isMaxLength(4000)),
  deferredUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  implementationRef: Schema.optional(Schema.NullOr(ShortText)),
});
export type InsightUpdateInput = typeof InsightUpdateInput.Type;

export const InsightAttributionInput = Schema.Struct({
  skill: ShortText,
  sourcePath: ShortText,
  toolkitRevision: ShortText,
  phase: ShortText,
  outcome: Schema.Literals(["started", "completed", "blocked", "failed"]),
  detail: Schema.String.check(Schema.isMaxLength(2000)),
});
export type InsightAttributionInput = typeof InsightAttributionInput.Type;

export class InsightsError extends Schema.TaggedError<InsightsError>()("InsightsError", {
  reason: Schema.Literals([
    "storage",
    "not_configured",
    "not_found",
    "invalid_evidence",
    "wrong_owner",
    "analysis_running",
    "schedule",
    "launch",
    "invalid_settings",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const messages = {
      storage: "Insights could not read or save its data.",
      not_configured: "Configure Insights before running an analysis.",
      not_found: "This insight or analysis no longer exists.",
      invalid_evidence: "The report references evidence or recommendations outside this analysis.",
      wrong_owner: "Only the thread that collected this analysis can submit it.",
      analysis_running: "An Insights analysis is already running.",
      schedule: "The Insights schedule could not be updated or started.",
      launch: "The implementation thread could not be started.",
      invalid_settings: "Choose an available project and a Codex Astra model with max effort.",
    };
    return messages[this.reason];
  }
}
