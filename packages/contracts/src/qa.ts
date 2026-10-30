import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const QaSuite = Schema.Struct({
  id: ShortText.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)),
  name: ShortText,
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(8000)),
  cwd: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  report: Schema.optionalKey(Schema.Literal("junit")),
});
export type QaSuite = typeof QaSuite.Type;

export const QaConfiguration = Schema.Struct({
  suites: Schema.Array(QaSuite).check(
    Schema.isMaxLength(100),
    Schema.makeFilter((suites) => new Set(suites.map((suite) => suite.id)).size === suites.length),
  ),
});

export const QaRunStatus = Schema.Literals([
  "running",
  "passed",
  "failed",
  "cancelled",
  "interrupted",
  "incomplete",
]);
export type QaRunStatus = typeof QaRunStatus.Type;

export const QaReportSummary = Schema.Struct({
  tests: NonNegativeInt,
  failures: NonNegativeInt,
  skipped: NonNegativeInt,
});
export type QaReportSummary = typeof QaReportSummary.Type;

export const QaRun = Schema.Struct({
  id: ShortText,
  projectId: ProjectId,
  suite: QaSuite,
  cwd: Schema.String,
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  status: QaRunStatus,
  exitCode: Schema.NullOr(Schema.Int),
  commit: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  dirty: Schema.NullOr(Schema.Boolean),
  summary: Schema.NullOr(QaReportSummary),
  note: Schema.NullOr(Schema.String),
});
export type QaRun = typeof QaRun.Type;

export const QaRunDetails = Schema.Struct({
  run: QaRun,
  output: Schema.String,
  outputTruncated: Schema.Boolean,
  reportXml: Schema.NullOr(Schema.String),
});
export type QaRunDetails = typeof QaRunDetails.Type;

export const QaProjectInput = Schema.Struct({ projectId: ProjectId });
export type QaProjectInput = typeof QaProjectInput.Type;
export const QaStartInput = Schema.Struct({ projectId: ProjectId, suiteId: ShortText });
export type QaStartInput = typeof QaStartInput.Type;
export const QaRunInput = Schema.Struct({ projectId: ProjectId, runId: ShortText });
export type QaRunInput = typeof QaRunInput.Type;
export const QaSnapshot = Schema.Struct({
  workspaceRoot: Schema.String,
  configurationError: Schema.NullOr(Schema.String),
  suites: Schema.Array(QaSuite),
  latestRuns: Schema.Array(QaRun),
  recentRuns: Schema.Array(QaRun),
});
export type QaSnapshot = typeof QaSnapshot.Type;

export class QaError extends Schema.TaggedError<QaError>()("QaError", {
  reason: Schema.Literals([
    "project-not-found",
    "suite-not-found",
    "run-not-found",
    "busy",
    "configuration",
    "storage",
    "workspace",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "project-not-found":
        return "The QA project no longer exists.";
      case "suite-not-found":
        return "This QA suite is no longer configured. Refresh the catalog.";
      case "run-not-found":
        return "This QA run could not be found in the selected project.";
      case "busy":
        return "A QA suite is already running in this project. Wait for it or cancel it first.";
      case "configuration":
        return "The qa configuration in t3.json is invalid. Check suite IDs, commands, and working directories.";
      case "workspace":
        return "The QA working directory must exist inside the project.";
      case "storage":
        return "QA could not read or save its run history.";
    }
  }
}
