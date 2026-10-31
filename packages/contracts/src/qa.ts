import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RecurringSchedule } from "./scheduledTask.ts";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const InputPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^(?!\/|[A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\*?[\]{}\x00]+$/),
);

export const QaTestKind = Schema.Literals([
  "unit",
  "integration",
  "playwright",
  "maestro",
  "e2e",
  "tooling",
  "other",
]);
export type QaTestKind = typeof QaTestKind.Type;

export const QaSuite = Schema.Struct({
  id: ShortText.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)),
  name: ShortText,
  component: Schema.optionalKey(ShortText),
  kind: Schema.optionalKey(QaTestKind),
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(8000)),
  cwd: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  report: Schema.optionalKey(Schema.Literal("junit")),
  inputs: Schema.optionalKey(
    Schema.Array(InputPath).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
  workspacePackage: Schema.optionalKey(ShortText),
  maxAgeHours: Schema.optionalKey(
    Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(8760)),
  ),
  environment: Schema.optionalKey(Schema.Literals(["workspace", "external"])),
  environmentFile: Schema.optionalKey(InputPath),
});
export type QaSuite = typeof QaSuite.Type;

export const QaConfiguration = Schema.Struct({
  sharedResults: Schema.optionalKey(Schema.Boolean),
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

const QaCiSource = Schema.Struct({
  type: Schema.Literal("ci"),
  provider: ShortText,
  runId: ShortText,
  environment: ShortText,
  url: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//)),
  ),
});

export const QA_OUTPUT_TAIL_LIMIT = 2000;

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
  outputTail: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(QA_OUTPUT_TAIL_LIMIT))),
  source: Schema.optionalKey(
    Schema.Union([Schema.Struct({ type: Schema.Literal("schedule") }), QaCiSource]),
  ),
  repositoryFile: Schema.optionalKey(InputPath),
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

export const QaTestStatus = Schema.Literals(["passed", "failed", "skipped"]);
export type QaTestStatus = typeof QaTestStatus.Type;
export const QaTestCase = Schema.Struct({
  id: NonNegativeInt,
  name: Schema.String,
  group: Schema.NullOr(Schema.String),
  file: Schema.NullOr(Schema.String),
  status: QaTestStatus,
  durationMs: Schema.NullOr(Schema.Number),
  details: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
});
export type QaTestCase = typeof QaTestCase.Type;
export const QA_TEST_PAGE_SIZE = 50;
export const QaTestsInput = Schema.Struct({
  projectId: ProjectId,
  runId: ShortText,
  search: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  status: Schema.optionalKey(QaTestStatus),
  offset: Schema.optionalKey(NonNegativeInt),
});
export type QaTestsInput = typeof QaTestsInput.Type;
export const QaTestResults = Schema.Struct({
  run: QaRun,
  tests: Schema.Array(QaTestCase).check(Schema.isMaxLength(QA_TEST_PAGE_SIZE)),
  total: NonNegativeInt,
  matched: NonNegativeInt,
  offset: NonNegativeInt,
  nextOffset: Schema.NullOr(NonNegativeInt),
  unavailableReason: Schema.NullOr(Schema.String),
});
export type QaTestResults = typeof QaTestResults.Type;

export const QaScheduleConfiguration = Schema.Struct({
  enabled: Schema.Boolean,
  timing: RecurringSchedule,
  timeZone: ShortText,
  branch: ShortText,
  target: Schema.Union([
    Schema.Struct({ type: Schema.Literals(["all", "affected"]) }),
    Schema.Struct({ type: Schema.Literal("suite"), suiteId: ShortText }),
  ]),
});
export type QaScheduleConfiguration = typeof QaScheduleConfiguration.Type;

export const QaSchedule = Schema.Struct({
  configuration: QaScheduleConfiguration,
  revision: ShortText,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastStatus: Schema.Literals([
    "never",
    "running",
    "passed",
    "failed",
    "skipped",
    "missed",
    "interrupted",
  ]),
  note: Schema.NullOr(Schema.String),
  runIds: Schema.Array(ShortText),
});
export type QaSchedule = typeof QaSchedule.Type;

export const QaSetScheduleInput = Schema.Struct({
  projectId: ProjectId,
  configuration: Schema.NullOr(QaScheduleConfiguration),
});
export type QaSetScheduleInput = typeof QaSetScheduleInput.Type;

export const QaCiReport = Schema.Struct({
  suiteId: ShortText,
  source: QaCiSource,
  commit: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/)),
  branch: ShortText,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
  exitCode: Schema.Int,
  reportXml: Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024)),
});
export type QaCiReport = typeof QaCiReport.Type;
export const QaImportInput = Schema.Struct({ projectId: ProjectId, report: QaCiReport });
export type QaImportInput = typeof QaImportInput.Type;
export const QaFreshness = Schema.Struct({
  suiteId: ShortText,
  state: Schema.Literals(["current", "stale", "unknown", "never"]),
  reason: Schema.String,
  changedPaths: Schema.Array(Schema.String),
  changedFileCount: NonNegativeInt,
  needsRun: Schema.Boolean,
  lastPassedAt: Schema.NullOr(IsoDateTime),
});
export type QaFreshness = typeof QaFreshness.Type;
export const QaSnapshot = Schema.Struct({
  workspaceRoot: Schema.String,
  configurationError: Schema.NullOr(Schema.String),
  suites: Schema.Array(QaSuite),
  latestRuns: Schema.Array(QaRun),
  recentRuns: Schema.Array(QaRun),
  freshness: Schema.optionalKey(Schema.Array(QaFreshness)),
  checkedAt: Schema.optionalKey(IsoDateTime),
  queuedSuiteIds: Schema.optionalKey(Schema.Array(ShortText)),
  batchError: Schema.optionalKey(Schema.NullOr(Schema.String)),
  batchRunning: Schema.optionalKey(Schema.Boolean),
  schedule: Schema.optionalKey(Schema.NullOr(QaSchedule)),
  latestCiRuns: Schema.optionalKey(Schema.Array(QaRun)),
  branch: Schema.optionalKey(Schema.NullOr(Schema.String)),
  testResultsAvailable: Schema.optionalKey(Schema.Boolean),
  sharedResults: Schema.optionalKey(
    Schema.Struct({ enabled: Schema.Boolean, warning: Schema.NullOr(Schema.String) }),
  ),
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
    "schedule",
    "branch",
    "report",
    "duplicate",
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
      case "schedule":
        return "The QA schedule needs a valid time zone, branch, and configured suite.";
      case "branch":
        return "The project is on a different branch. Scheduled execution stopped.";
      case "report":
        return "The CI report must contain valid JUnit XML (maximum 2 MiB) and valid completion times.";
      case "duplicate":
        return "This CI run ID already has a different report. Use a separate ID for each attempt.";
    }
  }
}
