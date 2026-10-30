import {
  InsightAttributionInput,
  InsightUpdateInput,
  InsightsReport,
  InsightsSettings,
  InsightsSnapshot,
  InsightsSubmitInput,
  InsightRecommendation,
  ProjectId,
  ThreadId,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
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
        Schema.Struct({ projectId: ProjectId, title: Schema.String, workspaceRoot: Schema.String }),
      ),
    }),
  }),
  Tool.make("t3_insights_submit", {
    ...common,
    description:
      "Save this thread's collected analysis. Cite evidence IDs from collect, reuse recommendation keys, distinguish facts from hypotheses, and propose concrete source changes with validation. Only assess implemented recommendations using later evidence. Never invent success, costs or measurements.",
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
  Tool.make("t3_insights", {
    ...common,
    description:
      "Read workflow insights with list, report or recommendation (id required). configure needs settings. update needs update. run starts analysis. implement starts work on a recommendation (id required); only when the user asks to implement it. Status changes preserve evidence and history.",
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
