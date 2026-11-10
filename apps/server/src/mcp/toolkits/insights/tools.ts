import {
  EnvironmentId,
  InsightAttributionInput,
  InsightUpdateInput,
  InsightsEvidenceInput,
  InsightsEvidenceResult,
  InsightsProject,
  InsightsReport,
  InsightsSettings,
  InsightsSnapshot,
  InsightsSubmitInput,
  InsightRecommendation,
  ThreadId,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as Insights from "../../../insights/InsightsService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const common = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    Insights.InsightsService,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};

export const InsightsToolkit = Toolkit.make(
  Tool.make("t3_insights_collect", {
    ...common,
    description:
      "Begin or resume this thread's workflow analysis. Returns bounded evidence, prior reports and recommendations, and project roots. Empty means no new work. Only collect when asked to analyze workflow insights; submit with t3_insights_submit.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({
      report: InsightsReport,
      previousReports: Schema.Array(InsightsReport),
      recommendations: Schema.Array(InsightRecommendation),
      projects: Schema.Array(
        Schema.Struct({
          ...InsightsProject.fields,
          environmentId: Schema.optionalKey(EnvironmentId),
          environmentLabel: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  }),
  Tool.make("t3_insights_submit", {
    ...common,
    description:
      "Save this thread's collected analysis. Cite evidence IDs from collect. A new problem is a recommendation with its exact edits, absolute paths, find text copied from the file; a tracked problem seen again is a recurrence under its key. Only assess implemented recommendations using later evidence. Never invent success, costs or measurements.",
    parameters: InsightsSubmitInput,
    success: InsightsReport,
  }),
  Tool.make("t3_insights_record", {
    ...common,
    description:
      "Record the skill, canonical source, toolkit revision, phase and outcome actually used in the current turn. This is agent-reported attribution, not proof of success. Use when a workflow requests attribution; never guess an unknown revision.",
    parameters: InsightAttributionInput,
    success: Schema.Void,
  }),
  Tool.make("t3_insights_evidence", {
    ...common,
    description: "This environment's evidence for a linked environment's workflow analysis.",
    parameters: InsightsEvidenceInput,
    success: InsightsEvidenceResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForLinks),
  Tool.make("t3_insights", {
    ...common,
    description:
      "Read workflow insights with list, report or recommendation (id required). configure needs settings. update needs update. run starts analysis. implement starts a thread that applies a recommendation's change and opens a pull request (id required); only when the user asks for it. Status changes preserve evidence and history.",
    parameters: Schema.Struct({
      action: Schema.Literals([
        "list",
        "report",
        "recommendation",
        "configure",
        "update",
        "run",
        "implement",
      ]),
      id: Schema.optional(TrimmedNonEmptyString),
      settings: Schema.optional(InsightsSettings),
      update: Schema.optional(InsightUpdateInput),
    }),
    success: Schema.Union([
      InsightsSnapshot,
      InsightsReport,
      InsightRecommendation,
      Schema.Struct({ threadId: Schema.NullOr(ThreadId) }),
    ]),
  }),
);
