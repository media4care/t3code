import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DeviceFormFactor, DevicePlatform, DevicePoolKey } from "./device.ts";
import type { RepositoryIdentity } from "./environment.ts";
import { RecurringSchedule } from "./scheduledTask.ts";

/** QA tests the remote a checkout pushes to: a fork's origin, not the upstream it tracks. */
export function qaRemoteOf(identity: RepositoryIdentity) {
  return identity.origin?.remoteUrl
    ? {
        key: identity.origin.canonicalKey,
        remoteName: "origin",
        remoteUrl: identity.origin.remoteUrl,
        title: identity.origin.displayName,
      }
    : {
        key: identity.canonicalKey,
        remoteName: identity.locator.remoteName,
        remoteUrl: identity.locator.remoteUrl,
        title: identity.displayName ?? identity.name,
      };
}

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const InputPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^(?!\/|[A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\*?[\]{}\x00]+$/),
);

/** A branch or tag name on the repository's remote, as `git` accepts it. */
export const QaRef = ShortText.check(
  Schema.isPattern(
    /^(?![-/])(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)[^\s~^:?*[\\\x00-\x1f\x7f]+(?<![./])$/,
  ),
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

export const QaDeviceSource = Schema.Literals(["machine", "simlock"]);
export type QaDeviceSource = typeof QaDeviceSource.Type;

export const QaDeviceType = Schema.Literals(["any", "virtual", "physical"]);
export type QaDeviceType = typeof QaDeviceType.Type;

/** A device a suite runs on. QA picks one from the device pool; people can choose another. */
export const QaDeviceRequirement = Schema.Struct({
  /** Names this device in `T3_QA_DEVICE_<ID>`; also keeps a chosen device when the list is reordered. */
  id: Schema.optionalKey(
    TrimmedNonEmptyString.check(
      Schema.isMaxLength(40),
      Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/),
    ),
  ),
  platform: DevicePlatform,
  formFactor: Schema.optionalKey(DeviceFormFactor),
  type: Schema.optionalKey(QaDeviceType),
  /** The name of the device to use when nobody chose one, such as an AVD name. */
  defaultDevice: Schema.optionalKey(ShortText),
});
export type QaDeviceRequirement = typeof QaDeviceRequirement.Type;

/** How a suite's device choices are stored: its `id`, or its position for one without. */
export const qaDeviceRequirementKey = (requirement: QaDeviceRequirement, index: number) =>
  requirement.id ?? String(index);

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
  devices: Schema.optionalKey(
    Schema.Array(QaDeviceRequirement).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4),
      Schema.makeFilter(
        (devices) => new Set(devices.map(qaDeviceRequirementKey)).size === devices.length,
      ),
    ),
  ),
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

/** The device a run used for one of its suite's device requirements. */
export const QaRunDevice = Schema.Struct({
  requirement: ShortText,
  deviceId: Schema.String,
  name: Schema.String,
  platform: DevicePlatform,
  physical: Schema.Boolean,
  version: Schema.String,
});
export type QaRunDevice = typeof QaRunDevice.Type;

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
  /** The branch or tag QA checked out for this run; absent for a run in a project's own checkout. */
  ref: Schema.optionalKey(Schema.String),
  dirty: Schema.NullOr(Schema.Boolean),
  summary: Schema.NullOr(QaReportSummary),
  note: Schema.NullOr(Schema.String),
  outputTail: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(QA_OUTPUT_TAIL_LIMIT))),
  source: Schema.optionalKey(
    Schema.Union([Schema.Struct({ type: Schema.Literal("schedule") }), QaCiSource]),
  ),
  repositoryFile: Schema.optionalKey(InputPath),
  devices: Schema.optionalKey(Schema.Array(QaRunDevice)),
});
export type QaRun = typeof QaRun.Type;

export const QaRunDetails = Schema.Struct({
  run: QaRun,
  output: Schema.String,
  outputTruncated: Schema.Boolean,
  reportXml: Schema.NullOr(Schema.String),
});
export type QaRunDetails = typeof QaRunDetails.Type;

/** Without `ref`, a repository with a remote uses its default branch. */
export const QaProjectInput = Schema.Struct({
  projectId: ProjectId,
  ref: Schema.optionalKey(QaRef),
});
export type QaProjectInput = typeof QaProjectInput.Type;
export const QaStartInput = Schema.Struct({
  projectId: ProjectId,
  suiteId: ShortText,
  ref: Schema.optionalKey(QaRef),
});
export type QaStartInput = typeof QaStartInput.Type;
/** `ref` is the snapshot a client shows the run in, so its details refresh with that snapshot. */
export const QaRunInput = Schema.Struct({
  projectId: ProjectId,
  runId: ShortText,
  ref: Schema.optionalKey(QaRef),
});
export type QaRunInput = typeof QaRunInput.Type;

/** A device someone chose for a suite's requirement, by device pool key. */
export const QaDeviceSelection = Schema.Struct({
  suiteId: ShortText,
  requirement: ShortText,
  deviceKey: DevicePoolKey,
});
export type QaDeviceSelection = typeof QaDeviceSelection.Type;
/** A null `deviceKey` goes back to the device QA picks. */
export const QaSetDeviceInput = Schema.Struct({
  projectId: ProjectId,
  /** The ref whose suites the choice is checked against; choices apply to every ref. */
  ref: Schema.optionalKey(QaRef),
  suiteId: ShortText,
  requirement: ShortText,
  deviceKey: Schema.NullOr(DevicePoolKey),
});
export type QaSetDeviceInput = typeof QaSetDeviceInput.Type;

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
  ref: Schema.optionalKey(QaRef),
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

/** A repository has one schedule per ref; `ref` picks it, and its branch is that ref. */
export const QaSetScheduleInput = Schema.Struct({
  projectId: ProjectId,
  ref: Schema.optionalKey(QaRef),
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
/** QA's own checkout of a ref, synced to the remote before each run. */
export const QaCheckout = Schema.Struct({
  state: Schema.Literals(["missing", "syncing", "setup", "ready", "failed"]),
  path: Schema.String,
  commit: Schema.NullOr(Schema.String),
  syncedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(QA_OUTPUT_TAIL_LIMIT))),
});
export type QaCheckout = typeof QaCheckout.Type;

/** The latest result of each suite on one ref, for comparing refs. */
export const QaRefSummary = Schema.Struct({
  ref: Schema.String,
  isDefault: Schema.Boolean,
  scheduled: Schema.Boolean,
  checkout: Schema.Boolean,
  results: Schema.Array(
    Schema.Struct({
      suiteId: Schema.String,
      suiteName: Schema.String,
      runId: Schema.String,
      status: QaRunStatus,
      commit: Schema.NullOr(Schema.String),
      startedAt: IsoDateTime,
    }),
  ),
});
export type QaRefSummary = typeof QaRefSummary.Type;

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
  deviceSelections: Schema.optionalKey(Schema.Array(QaDeviceSelection)),
  /** The ref this snapshot shows; null for a project tested in its own checkout. */
  ref: Schema.optionalKey(Schema.NullOr(Schema.String)),
  checkout: Schema.optionalKey(Schema.NullOr(QaCheckout)),
  refs: Schema.optionalKey(Schema.Array(QaRefSummary)),
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
    "disabled",
    "ref",
    "checkout",
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
        return "A QA suite is already running in this repository. Wait for it or cancel it first.";
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
      case "disabled":
        return "QA is turned off on this environment. Turn on Run QA here in Settings → Devices.";
      case "ref":
        return "That branch or tag was not found on the repository's remote.";
      case "checkout":
        return "QA could not prepare its checkout of this ref. See the checkout status in QA.";
    }
  }
}
