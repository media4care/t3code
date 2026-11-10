import * as Schema from "effect/Schema";

import {
  EnvironmentId,
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
/** `implemented` is a trial that later reviews assess; `kept` and `reverted` close it. */
export const InsightStatus = Schema.Literals([
  "open",
  "accepted",
  "deferred",
  "dismissed",
  "implemented",
  "kept",
  "reverted",
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
  /** Model for threads that apply a recommendation; the analysis model at its default effort when absent. */
  implementationModelSelection: Schema.optionalKey(ModelSelection),
  /** Projects in linked environments whose activity joins this environment's report. */
  linkedProjects: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        environmentId: EnvironmentId,
        projectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      }),
    ).check(Schema.isMaxLength(10)),
  ),
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
  /** Set when the thread lives in a linked environment rather than the report's own. */
  environmentId: Schema.optionalKey(EnvironmentId),
});
export type InsightEvidence = typeof InsightEvidence.Type;

/**
 * Text a model writes. The limit sits on the wire side of the trim, because a tool's JSON schema
 * is built from that side and would otherwise not show it. What each field is for is said in the
 * analysis prompt, which only the analyst reads; the schema is in every agent's context.
 */
const limited = (maximum: number) =>
  Schema.String.check(Schema.isMaxLength(maximum)).pipe(Schema.decodeTo(TrimmedNonEmptyString));

/** One exact replacement in a file: `find` occurs once there and becomes `replace`. */
export const InsightEdit = Schema.Struct({
  /** An absolute path. */
  file: limited(300),
  /** Copied exactly from the file; empty to create the file. */
  find: Schema.String.check(Schema.isMaxLength(3000)),
  replace: Schema.String.check(Schema.isMaxLength(6000)),
});
export type InsightEdit = typeof InsightEdit.Type;

const InsightEvidenceIds = Schema.Array(ShortText).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(12),
);

/** A recommendation as an analysis submits it; the stored record keeps this text as first written. */
export const InsightProposal = Schema.Struct({
  key: limited(300),
  /** The change, as an instruction. */
  title: limited(120),
  category: InsightCategory,
  priority: Schema.Literals(["high", "medium", "low"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
  /** What happened, for a reader who was not there. */
  observation: limited(700),
  /** What the change makes agents do differently. */
  recommendation: limited(400),
  /** The exact change; empty only when `suggestedChange` describes it. */
  edits: Schema.Array(InsightEdit).check(Schema.isMaxLength(4)),
  /** For a code change too large to write without running it; `targetFile` says where. */
  suggestedChange: Schema.optionalKey(limited(700)),
  targetFile: Schema.optionalKey(Schema.NullOr(ShortText)),
  /** What later tasks would show if the change worked. */
  validation: limited(400),
  evidenceIds: InsightEvidenceIds,
});
export type InsightProposal = typeof InsightProposal.Type;

export const InsightRecommendation = Schema.Struct({
  key: ShortText,
  title: ShortText,
  category: InsightCategory,
  priority: Schema.Literals(["high", "medium", "low"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
  observation: Text,
  recommendation: Text,
  targetFile: Schema.NullOr(ShortText),
  /** The exact change; absent from recommendations that predate exact changes. */
  edits: Schema.optionalKey(Schema.Array(InsightEdit)),
  /** Prose for a change no exact edit carries; every recommendation before exact changes has one. */
  suggestedChange: Schema.optionalKey(Text),
  /** Only recommendations that predate exact changes have one. */
  expectedImpact: Schema.optionalKey(Text),
  validation: Text,
  evidenceIds: InsightEvidenceIds,
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
  /** The trial contract, frozen when it entered `implemented`; later proposals do not change it. */
  trial: Schema.optionalKey(
    Schema.Struct({
      startedAt: IsoDateTime,
      validation: Text,
      implementationRef: Schema.NullOr(Schema.String),
    }),
  ),
  evidence: Schema.Array(InsightEvidence),
  /** Later reviews that saw the same problem again; the text above stays as first written. */
  incidents: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        reportId: Schema.String,
        at: IsoDateTime,
        text: Text,
        evidence: Schema.Array(InsightEvidence),
      }),
    ),
  ),
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

/** A detected skill load through a native tool or instruction read, counted once per run. */
export const InsightSkillUsage = Schema.Struct({
  skill: TrimmedNonEmptyString,
  runs: NonNegativeInt,
});
export type InsightSkillUsage = typeof InsightSkillUsage.Type;

/** Failing tool calls that failed the same way: program, exit code and normalized diagnostic. */
export const InsightFrictionCluster = Schema.Struct({
  key: ShortText,
  family: ShortText,
  exitCode: Schema.NullOr(Schema.Int),
  signature: ShortText,
  /** A lone search that found nothing, or a process stopped by a signal. */
  harmless: Schema.Boolean,
  failures: NonNegativeInt,
  tasks: NonNegativeInt,
  /** Most failures of this kind within one task. */
  maxPerTask: NonNegativeInt,
  evidenceIds: Schema.Array(ShortText).check(Schema.isMaxLength(3)),
});
export type InsightFrictionCluster = typeof InsightFrictionCluster.Type;

/** One task (a root thread with its child threads) as measured over a review's sampled runs. */
export const InsightTask = Schema.Struct({
  rootThreadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(50)),
  runs: NonNegativeInt,
  /** Messages the user wrote after the task's first one; agent-written messages are excluded. */
  followUps: NonNegativeInt,
  interrupts: NonNegativeInt,
  agentQuestions: NonNegativeInt,
  failedTools: NonNegativeInt,
  harmlessFailures: NonNegativeInt,
  frictionKeys: Schema.Array(ShortText).check(Schema.isMaxLength(20)),
  firstActivityAt: IsoDateTime,
  lastActivityAt: IsoDateTime,
  latestRunStatus: Schema.String,
  /** A linked PR's state when the report was made (merged before open), not during the window. */
  pullRequest: Schema.NullOr(Schema.Literals(["open", "merged", "closed"])),
  /** Set when the task lives in a linked environment rather than the report's own. */
  environmentId: Schema.optionalKey(EnvironmentId),
});
export type InsightTask = typeof InsightTask.Type;

const InsightDecisionFields = {
  /** `briefing`: how the user briefs and steers agents. `toolkit`: a change to skills, tools or setup. */
  kind: Schema.Literals(["briefing", "toolkit"]),
  title: ShortText,
  /** What to do differently. */
  action: Text,
  /** The chain behind it: the brief, what the agent did, the correction, the outcome. */
  why: Text,
  evidenceIds: Schema.Array(ShortText).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
};

/** One of the few things a review asks the user to decide or change. */
export const InsightDecision = Schema.Struct({
  ...InsightDecisionFields,
  /** The recommendation a toolkit decision is carried out through. */
  recommendationId: Schema.optionalKey(Schema.String),
});
export type InsightDecision = typeof InsightDecision.Type;

export const InsightDecisionBrief = Schema.Struct({
  headline: ShortText,
  decisions: Schema.Array(InsightDecision).check(Schema.isMaxLength(3)),
});
export type InsightDecisionBrief = typeof InsightDecisionBrief.Type;

export const InsightsProject = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
});
export type InsightsProject = typeof InsightsProject.Type;

/** What a linked environment is asked for: activity in its projects after its own cursor. */
export const InsightsEvidenceInput = Schema.Struct({
  projectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  lookbackDays: InsightsSettings.fields.lookbackDays,
  maxRuns: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  fromSequence: NonNegativeInt,
  characterBudget: Schema.Int.check(Schema.isBetween({ minimum: 10000, maximum: 150000 })),
});
export type InsightsEvidenceInput = typeof InsightsEvidenceInput.Type;

export const InsightsEvidenceResult = Schema.Struct({
  projects: Schema.Array(InsightsProject),
  metrics: InsightsMetrics,
  /** Absent from environments that predate skill usage. */
  skills: Schema.optionalKey(Schema.Array(InsightSkillUsage)),
  /** Absent from environments that predate task measures. */
  tasks: Schema.optionalKey(Schema.Array(InsightTask)),
  friction: Schema.optionalKey(Schema.Array(InsightFrictionCluster)),
  evidence: Schema.Array(InsightEvidence),
  throughSequence: NonNegativeInt,
  hasMore: Schema.Boolean,
});
export type InsightsEvidenceResult = typeof InsightsEvidenceResult.Type;

export const InsightsReport = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  status: Schema.Literals(["analyzing", "completed", "failed", "empty"]),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  summary: Schema.String,
  /** Absent from reports that predate decision briefs, and from analyses that found nothing to decide. */
  brief: Schema.optionalKey(InsightDecisionBrief),
  wins: Schema.Array(Schema.Struct({ text: Text, evidenceIds: Schema.Array(ShortText) })),
  limitations: Schema.Array(Text),
  metrics: InsightsMetrics,
  /** Most-loaded first; absent from reports that predate skill usage. */
  skills: Schema.optionalKey(Schema.Array(InsightSkillUsage)),
  /** Most recently active first; absent from reports that predate task measures. */
  tasks: Schema.optionalKey(Schema.Array(InsightTask)),
  /** Most failures first; absent from reports that predate friction clusters. */
  friction: Schema.optionalKey(Schema.Array(InsightFrictionCluster)),
  evidence: Schema.Array(InsightEvidence),
  recommendationIds: Schema.Array(Schema.String),
  scopeKey: Schema.String,
  fromSequence: NonNegativeInt,
  throughSequence: NonNegativeInt,
  hasMore: Schema.Boolean,
  modelSelection: ModelSelection,
  /** Linked environments this report covered, each with its own event cursor. */
  linked: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        environmentId: EnvironmentId,
        label: Schema.String,
        scopeKey: Schema.String,
        fromSequence: NonNegativeInt,
        throughSequence: NonNegativeInt,
        hasMore: Schema.Boolean,
        projects: Schema.Array(InsightsProject),
      }),
    ),
  ),
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
  summary: limited(1200),
  brief: Schema.optionalKey(
    Schema.Struct({
      headline: limited(160),
      decisions: Schema.Array(
        Schema.Struct({
          kind: InsightDecisionFields.kind,
          title: limited(120),
          action: limited(400),
          why: limited(500),
          evidenceIds: InsightDecisionFields.evidenceIds,
          /** Required for `toolkit`: the new or existing recommendation to act on. */
          recommendationKey: Schema.optionalKey(ShortText),
        }),
      ).check(Schema.isMaxLength(3)),
    }),
  ),
  wins: Schema.Array(
    Schema.Struct({
      text: limited(400),
      evidenceIds: Schema.Array(ShortText).check(Schema.isMinLength(1)),
    }),
  ).check(Schema.isMaxLength(5)),
  limitations: Schema.Array(limited(400)).check(Schema.isMaxLength(5)),
  /** New problems only. */
  recommendations: Schema.Array(InsightProposal).check(Schema.isMaxLength(8)),
  /** Tracked recommendations whose problem this review saw again; their text stays as written. */
  recurrences: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        recommendationKey: ShortText,
        /** What happened this time. */
        text: limited(400),
        evidenceIds: Schema.Array(ShortText).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
      }),
    ).check(Schema.isMaxLength(12)),
  ),
  assessments: Schema.Array(
    Schema.Struct({
      recommendationId: ShortText,
      outcome: Schema.Literals(["improved", "unchanged", "regressed", "insufficient_evidence"]),
      explanation: limited(600),
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

/** Why a submitted recommendation or recurrence cannot be saved as written. */
export const InsightChangeProblem = Schema.Literals([
  "missing_change",
  "mixed_change",
  "unknown_recommendation",
  "path_not_absolute",
  "file_missing",
  "file_exists",
  "text_not_found",
  "text_not_unique",
]);
export type InsightChangeProblem = typeof InsightChangeProblem.Type;

export class InsightsError extends Schema.TaggedError<InsightsError>()("InsightsError", {
  reason: Schema.Literals([
    "storage",
    "not_configured",
    "not_found",
    "invalid_evidence",
    "invalid_change",
    "wrong_owner",
    "analysis_running",
    "schedule",
    "launch",
    "invalid_settings",
  ]),
  /** Set with `invalid_change`: what is wrong, in which recommendation, and in which file. */
  problem: Schema.optional(InsightChangeProblem),
  recommendationKey: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === "invalid_change") {
      const where = `Recommendation "${this.recommendationKey ?? ""}"`;
      const file = this.file ?? "";
      const problems = {
        missing_change: `${where} needs an exact edit, or a suggestedChange when no edit can express it.`,
        mixed_change: `${where} has both edits and a suggestedChange. Keep one here and propose the other as a recommendation of its own.`,
        unknown_recommendation: `${where} does not exist, so nothing recurred. Submit it as a new recommendation.`,
        path_not_absolute: `${where}: ${file} is not an absolute path.`,
        file_missing: `${where}: ${file} could not be read. Name the existing file, or leave find empty to create it.`,
        file_exists: `${where}: ${file} already exists, so find cannot be empty. Copy the text to replace from the file.`,
        text_not_found: `${where}: the find text is not in ${file}. Read the file again and copy the text exactly.`,
        text_not_unique: `${where}: the find text occurs more than once in ${file}. Include more of the surrounding text.`,
      };
      return problems[this.problem ?? "missing_change"];
    }
    const messages = {
      storage: "Insights could not read or save its data.",
      not_configured: "Configure Insights before running an analysis.",
      not_found: "This insight or analysis no longer exists.",
      invalid_evidence: "The report references evidence or recommendations outside this analysis.",
      wrong_owner: "Only the thread that collected this analysis can submit it.",
      analysis_running: "An Insights analysis is already running.",
      schedule: "The Insights schedule could not be updated or started.",
      launch: "The implementation thread could not be started.",
      invalid_settings:
        "Choose an available project and a Codex Astra model with max effort. Linked projects need Linked environments on and a link to their environment. A model for applying changes must be one an enabled provider offers.",
    };
    return messages[this.reason];
  }
}
