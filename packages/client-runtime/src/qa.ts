import {
  QaCiReport,
  qaCombinedStatus,
  qaRemoteOf,
  qaSuiteLanes,
  type EnvironmentId,
  type QaApp,
  type QaLane,
  type QaCheckout,
  type RepositoryIdentity,
  type QaFreshness,
  type QaRun,
  type QaRunProgress,
  type QaRunStatus,
  type QaRunStep,
  type QaRunStepId,
  type QaSuite,
  type QaTestKind,
  type QaScheduleConfiguration,
  type QaTestCase,
} from "@t3tools/contracts";
import { qaDeviceRequirementLabel, qaOsLabel, qaOsMajor } from "@t3tools/shared/qaDevices";
import * as Schema from "effect/Schema";

export const decodeQaCiReport = Schema.decodeUnknownSync(Schema.fromJsonString(QaCiReport));

export const QA_TEST_FILTERS = [
  { value: "all", label: "All tests" },
  { value: "failed", label: "Failed" },
  { value: "passed", label: "Passed" },
  { value: "skipped", label: "Skipped" },
] as const;
export type QaTestFilter = (typeof QA_TEST_FILTERS)[number]["value"];

export function qaTestDuration(test: QaTestCase) {
  if (test.durationMs === null) return "Not reported";
  return test.durationMs < 1000
    ? `${Math.round(test.durationMs)} ms`
    : `${(test.durationMs / 1000).toFixed(2)} s`;
}

export function qaScheduleLabel(configuration: QaScheduleConfiguration) {
  const timing = configuration.timing;
  return timing.type === "interval"
    ? `Every ${timing.everyMs / 60_000} minutes`
    : `${timing.weekdays?.length ? timing.weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ") : "Daily"} at ${timing.timeOfDay} · ${configuration.timeZone}`;
}

export function qaRunSource(run: QaRun) {
  return run.repositoryFile
    ? "Repository result"
    : run.source?.type === "ci"
      ? `${run.source.provider} · ${run.source.environment}`
      : run.source?.type === "schedule"
        ? "Scheduled"
        : "Manual";
}

/** Projects on environments that run QA; one whose settings are unknown yet still counts. */
export function qaProjects<
  Project extends { readonly environmentId: EnvironmentId; readonly isScratch?: true },
>(
  projects: ReadonlyArray<Project>,
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly serverConfig: { readonly settings: { readonly qaEnabled: boolean } } | null;
  }>,
) {
  const off = new Set(
    environments
      .filter((environment) => environment.serverConfig?.settings.qaEnabled === false)
      .map((environment) => environment.environmentId),
  );
  return projects.filter((project) => !project.isScratch && !off.has(project.environmentId));
}

/**
 * QA belongs to a repository, so clones and worktrees of one remote are one entry per
 * environment, opened through its first project. Projects without a remote stay on their own.
 */
export function qaRepositories<
  Project extends {
    readonly environmentId: EnvironmentId;
    readonly id: string;
    readonly title: string;
    readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
  },
>(projects: ReadonlyArray<Project>) {
  const entries = new Map<string, { key: string; title: string; project: Project }>();
  for (const project of projects) {
    const remote = project.repositoryIdentity ? qaRemoteOf(project.repositoryIdentity) : null;
    const key = `${project.environmentId}:${remote ? `repository:${remote.key}` : project.id}`;
    if (!entries.has(key))
      entries.set(key, { key, title: remote?.title ?? project.title, project });
  }
  return [...entries.values()];
}

/** What QA's own checkout of a ref is doing, for a status line. */
export function qaCheckoutLabel(ref: string, checkout: QaCheckout) {
  switch (checkout.state) {
    case "missing":
      return `Preparing QA's checkout of ${ref}…`;
    case "syncing":
      return `Fetching ${ref}…`;
    case "setup":
      return `Running the setup script for ${ref}…`;
    case "failed":
      return `QA could not prepare ${ref}.`;
    case "ready":
      return `${ref} at ${checkout.commit?.slice(0, 8) ?? "unknown"}`;
  }
}

export const QA_OFF_EVERYWHERE =
  "QA is off on every environment with projects. Turn on Run QA here in Settings → Devices on the machine that should run your suites.";

export const QA_SHARED_RESULTS_NOTICE =
  "Run summaries are saved in t3.qa-results/. Commit and share these files with your changes so other checkouts can reuse matching results. Full logs and reports stay on the execution environment.";

export const QA_PHYSICAL_ONLY_HINT =
  "Skips every run that would use an emulator or simulator. Suites without devices still run.";

export function qaDefaultSchedule(branch: string): QaScheduleConfiguration {
  return {
    enabled: true,
    timing: { type: "fixed_time", timeOfDay: "09:00" },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    branch,
    target: { type: "all" },
  };
}

export const QA_CI_REPORT_EXAMPLE = `{
  "suiteId": "unit",
  "source": { "type": "ci", "provider": "GitHub Actions", "runId": "123:1", "environment": "ubuntu-latest" },
  "commit": "0123456789012345678901234567890123456789",
  "branch": "main",
  "startedAt": "2026-01-01T09:00:00.000Z",
  "finishedAt": "2026-01-01T09:01:00.000Z",
  "exitCode": 0,
  "reportXml": "<testsuite><testcase name=\\"example\\"/></testsuite>"
}`;

export const QA_KIND_LABELS: Record<QaTestKind, string> = {
  unit: "Unit tests",
  integration: "Integration",
  playwright: "Playwright",
  maestro: "Maestro",
  e2e: "End-to-end",
  tooling: "Tooling",
  other: "Other",
};

export const QA_GROUP_OPTIONS = [
  { value: "app", label: "App" },
  { value: "kind", label: "Test type" },
  { value: "none", label: "All suites" },
] as const;
export type QaGrouping = (typeof QA_GROUP_OPTIONS)[number]["value"];

export const QA_FILTER_OPTIONS = [
  { value: "all", label: "All results" },
  { value: "affected", label: "Needs rerun" },
  { value: "attention", label: "Needs attention" },
  { value: "never", label: "Never run" },
  { value: "passed", label: "Passed" },
  { value: "running", label: "Running" },
] as const;
export type QaResultFilter = (typeof QA_FILTER_OPTIONS)[number]["value"];

function qaSuiteKind(suite: QaSuite): QaTestKind {
  if (suite.kind) return suite.kind;
  const text = `${suite.name} ${suite.command}`.toLowerCase();
  if (/maestro/.test(text)) return "maestro";
  if (/playwright/.test(text)) return "playwright";
  if (/integration/.test(text)) return "integration";
  if (/\be2e\b|end.to.end/.test(text)) return "e2e";
  if (/\bunit\b|\bjest\b|\bvitest\b|\bmocha\b|vp test/.test(text)) return "unit";
  return "other";
}

function qaSuiteComponent(suite: QaSuite) {
  if (suite.component) return suite.component;
  const parts = suite.cwd
    ?.replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== ".");
  const directory = parts?.[0] === "apps" || parts?.[0] === "packages" ? parts[1] : parts?.[0];
  return directory
    ? directory.replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase())
    : "Project";
}

function qaResultCategory(run: QaRun | undefined): Exclude<QaResultFilter, "all" | "affected"> {
  if (!run) return "never";
  if (run.status === "passed" || run.status === "running") return run.status;
  return "attention";
}

/** Where one lane of a suite run per device stands. */
export type QaLaneOutcome = "running" | "queued" | "passed" | "failed" | "not-run" | "never";

export interface QaLaneResult {
  readonly lane: QaLane;
  readonly run: QaRun | undefined;
  readonly outcome: QaLaneOutcome;
}

function qaLaneOutcome(run: QaRun | undefined, queued: boolean): QaLaneOutcome {
  if (run?.status === "running") return "running";
  if (queued) return "queued";
  if (!run) return "never";
  if (run.status === "passed") return "passed";
  // Its command never ran: no device, or stopped before it started.
  return run.exitCode === null ? "not-run" : "failed";
}

export function qaDashboard(
  suites: readonly QaSuite[],
  latestRuns: readonly QaRun[],
  freshness: readonly QaFreshness[] = [],
  queuedLanes: ReadonlyArray<{ suiteId: string; lane: string }> = [],
) {
  const assessments = new Map(freshness.map((item) => [item.suiteId, item]));
  const counts = { total: suites.length, passed: 0, attention: 0, running: 0, never: 0 };
  const entries = suites.map((suite) => {
    const runs = latestRuns.filter((run) => run.suite.id === suite.id);
    const lanes = qaSuiteLanes(suite).map((lane): QaLaneResult => {
      const run = runs.find((candidate) => candidate.lane === lane.key);
      const queued = queuedLanes.some(
        (item) => item.suiteId === suite.id && item.lane === lane.key,
      );
      return { lane, run, outcome: qaLaneOutcome(run, queued) };
    });
    const ran = lanes.flatMap(({ run }) => (run ? [run] : []));
    // The run that speaks for the suite: the one running, else the worst.
    const status = qaCombinedStatus(ran.map((run) => run.status));
    const run = lanes.length
      ? ran.find((candidate) => candidate.status === status)
      : runs.find((candidate) => candidate.lane === undefined);
    const category = !lanes.length
      ? qaResultCategory(run)
      : !ran.length
        ? "never"
        : status === "running"
          ? "running"
          : lanes.every(({ outcome }) => outcome === "passed")
            ? "passed"
            : "attention";
    counts[category] += 1;
    return {
      suite,
      run,
      lanes,
      category,
      freshness: assessments.get(suite.id),
      component: qaSuiteComponent(suite),
      kind: qaSuiteKind(suite),
    };
  });
  return { entries, counts };
}

/** What a suite run per device leads with: "Running 1 of 4", "1 of 4 failed", "4 of 4 passed". */
export function qaLanesHeadline(lanes: ReadonlyArray<QaLaneResult>) {
  const total = lanes.length;
  const running = lanes.findIndex(({ outcome }) => outcome === "running");
  if (running !== -1) return `Running ${running + 1} of ${total}`;
  const count = (outcome: QaLaneOutcome) => lanes.filter((lane) => lane.outcome === outcome).length;
  if (count("queued")) return `${count("queued")} of ${total} queued`;
  if (count("failed")) return `${count("failed")} of ${total} failed`;
  const notRun = count("not-run") + count("never");
  if (notRun === total) return count("never") === total ? "Never run" : "Not run";
  if (notRun) return `${notRun} of ${total} not run`;
  return `${total} of ${total} passed`;
}

/** One lane's cell: its outcome, and how the run went when it ran its command. */
export function qaLaneHeadline({ run, outcome }: QaLaneResult) {
  switch (outcome) {
    case "queued":
      return "Queued";
    case "never":
      return "Never run";
    case "not-run":
      return run?.status === "cancelled" ? "Cancelled" : "Not run";
    default:
      return run ? qaRunHeadline(run) : "Never run";
  }
}

/** A lane's device and OS version, without its variant: "Android tablet · Android 13". */
export function qaLaneDeviceLabel(lane: QaLane) {
  const device = qaDeviceRequirementLabel(lane.requirement);
  return lane.os ? `${device} · ${qaOsLabel(lane.requirement.platform, lane.os)}` : device;
}

export function qaLaneLabel(lane: QaLane) {
  const device = qaLaneDeviceLabel(lane);
  return lane.variant ? `${device} · ${lane.variant.name}` : device;
}

/** A suite's lanes in rows under their variant's name; one untitled section without variants. */
export function qaLaneSections(lanes: ReadonlyArray<QaLaneResult>) {
  const sections = new Map<string, { title: string | null; lanes: QaLaneResult[] }>();
  for (const result of lanes) {
    const key = result.lane.variant?.id ?? "";
    const section = sections.get(key) ?? { title: result.lane.variant?.name ?? null, lanes: [] };
    section.lanes.push(result);
    sections.set(key, section);
  }
  return [...sections.values()];
}

/** How a run's device is shown: "Physical", or the kind of virtual device. */
export function qaDeviceKind(device: { readonly platform: string; readonly physical: boolean }) {
  return device.physical ? "Physical" : device.platform === "ios" ? "Simulator" : "Emulator";
}

/** A run's name in lists: its suite, and its lane for a suite run per device. */
export function qaRunTitle(run: QaRun) {
  const lane = qaSuiteLanes(run.suite).find((candidate) => candidate.key === run.lane);
  return lane ? `${run.suite.name} · ${qaLaneLabel(lane)}` : run.suite.name;
}
export type QaDashboardEntry = ReturnType<typeof qaDashboard>["entries"][number];

export interface QaSuiteGroup {
  readonly key: string;
  readonly label: string;
  /** The apps its suites test, whose icons it shows. */
  readonly apps: ReadonlyArray<QaApp>;
  /** Suites that test no app, when others do; it starts closed. */
  readonly other: boolean;
  readonly entries: ReadonlyArray<QaDashboardEntry>;
}

/**
 * By app, suites go under the app they test, under one group for each set of apps they test
 * together, and the rest under Other. Without apps, by component.
 */
export function groupQaSuites(
  entries: readonly QaDashboardEntry[],
  grouping: QaGrouping,
  search: string,
  filter: QaResultFilter,
  apps: ReadonlyArray<QaApp> = [],
): ReadonlyArray<QaSuiteGroup> {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const byApp = grouping === "app" && entries.some((entry) => entry.suite.apps?.length);
  const groups = new Map<string, { label: string; apps: QaApp[]; entries: QaDashboardEntry[] }>();
  for (const entry of entries) {
    if (
      filter === "affected"
        ? !entry.freshness?.needsRun
        : filter !== "all" && entry.category !== filter
    )
      continue;
    const tested = (entry.suite.apps ?? []).flatMap((id) => apps.filter((app) => app.id === id));
    const text =
      `${entry.suite.name} ${entry.suite.id} ${entry.component} ${QA_KIND_LABELS[entry.kind]} ${entry.suite.command} ${tested.map((app) => app.name).join(" ")}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) continue;
    const key = !byApp
      ? grouping === "app"
        ? entry.component
        : grouping === "kind"
          ? QA_KIND_LABELS[entry.kind]
          : "All suites"
      : tested.length
        ? `app:${tested.map((app) => app.id).join("+")}`
        : "other";
    const group = groups.get(key) ?? {
      label: !byApp
        ? key
        : tested.length === 0
          ? "Other"
          : tested.length === 1
            ? tested[0]!.name
            : `${entry.suite.component ?? tested.map((app) => app.name).join(" + ")} · ${tested.length === 2 ? "both apps" : `${tested.length} apps`}`,
      apps: byApp ? tested : [],
      entries: [],
    };
    group.entries.push(entry);
    groups.set(key, group);
  }
  // Groups keep the catalog's order, so a project lists what matters most first; Other goes last.
  return [...groups]
    .map(([key, group]) => ({ key, ...group, other: byApp && key === "other" }))
    .sort((a, b) => Number(a.other) - Number(b.other));
}

/** A suite that passed but should run again: its inputs changed or its result expired. */
export function qaNeedsRerun(entry: QaDashboardEntry) {
  // Without declared inputs freshness is unknown, which is no reason to call a pass stale.
  return (
    entry.category === "passed" &&
    !!entry.freshness?.needsRun &&
    entry.freshness.state !== "unknown"
  );
}

/** Where each of a group's suites, or its lanes, stands. */
function qaGroupItems(entries: ReadonlyArray<QaDashboardEntry>) {
  return entries.flatMap((entry) =>
    entry.lanes.length
      ? entry.lanes.map(({ lane, run, outcome }) => ({
          key: `${entry.suite.id}/${lane.key}`,
          run,
          outcome,
        }))
      : [{ key: entry.suite.id, run: entry.run, outcome: qaLaneOutcome(entry.run, false) }],
  );
}

/**
 * How a group stands on the commit QA tests: its headline, a cell per suite or lane, and how
 * many ran on `commit`; null when the commit is unknown.
 */
export function qaGroupSummary(entries: ReadonlyArray<QaDashboardEntry>, commit: string | null) {
  const items = qaGroupItems(entries);
  const count = (outcome: QaLaneOutcome) => items.filter((item) => item.outcome === outcome).length;
  const passed = count("passed");
  const failed = count("failed") + count("not-run");
  const stale = entries.some(qaNeedsRerun);
  const tone: QaLaneOutcome | "stale" =
    count("running") || count("queued")
      ? "running"
      : failed
        ? "failed"
        : passed === items.length
          ? stale
            ? "stale"
            : "passed"
          : "never";
  const headline = {
    running: count("running") ? "Running" : "Queued",
    queued: "Queued",
    failed: `${failed} failed`,
    "not-run": `${failed} failed`,
    stale: "Needs rerun",
    passed: "Passed",
    never: passed ? `${items.length - passed} not run` : "Not run",
  }[tone];
  const latest =
    commit === null ? null : items.filter((item) => item.run?.commit === commit).length;
  return {
    tone,
    headline,
    cells: items.map(({ key, outcome }) => ({ key, outcome })),
    passed,
    total: items.length,
    detail: `${passed}/${items.length} passed${latest === null ? "" : latest === items.length ? " · all latest" : ` · ${latest} on latest`}`,
  };
}

export interface QaAttentionItem {
  readonly key: string;
  readonly entry: QaDashboardEntry;
  readonly lane?: QaLane;
  readonly run: QaRun | undefined;
  readonly reason: "failed" | "not-run" | "stale";
}

/** What needs someone: failed suites and lanes, ones that could not run, then passed ones whose inputs changed. */
export function qaAttention(
  entries: ReadonlyArray<QaDashboardEntry>,
): ReadonlyArray<QaAttentionItem> {
  const items = entries.flatMap((entry): ReadonlyArray<QaAttentionItem> => {
    if (entry.lanes.length)
      return entry.lanes.flatMap(({ lane, run, outcome }) =>
        outcome === "failed" || outcome === "not-run"
          ? [{ key: `${entry.suite.id}/${lane.key}`, entry, lane, run, reason: outcome }]
          : [],
      );
    const outcome = qaLaneOutcome(entry.run, false);
    if (outcome === "failed" || outcome === "not-run")
      return [{ key: entry.suite.id, entry, run: entry.run, reason: outcome }];
    return [];
  });
  const stale = entries.flatMap((entry): ReadonlyArray<QaAttentionItem> =>
    qaNeedsRerun(entry)
      ? [{ key: `${entry.suite.id}:stale`, entry, run: entry.run, reason: "stale" }]
      : [],
  );
  const order = { failed: 0, "not-run": 1, stale: 2 };
  return [...items, ...stale].sort((a, b) => order[a.reason] - order[b.reason]);
}

/** The latest result on one OS version, by the kind of device it ran on. */
export interface QaCoverageCell {
  readonly platform: "ios" | "android";
  readonly os: string;
  readonly virtual?: QaRun;
  readonly physical?: QaRun;
}

const COVERAGE_STATUSES: ReadonlyArray<QaRunStatus> = ["passed", "failed", "running"];

/** The suites whose runs count for a group's devices: those testing all its apps, or its own. */
export function qaGroupSuiteIds(group: QaSuiteGroup, entries: ReadonlyArray<QaDashboardEntry>) {
  const suites = group.apps.length
    ? entries.filter((entry) => group.apps.every((app) => entry.suite.apps?.includes(app.id)))
    : group.entries;
  return new Set(suites.map((entry) => entry.suite.id));
}

/**
 * The OS versions these suites ran on, with the latest result per version and device kind. Any
 * run counts, including one on a device someone chose by hand, but not one that never ran its command.
 */
export function qaDeviceCoverage(
  suiteIds: ReadonlySet<string>,
  runs: ReadonlyArray<QaRun>,
): ReadonlyArray<QaCoverageCell> {
  const cells = new Map<
    string,
    { platform: "ios" | "android"; os: string; virtual?: QaRun; physical?: QaRun }
  >();
  for (const run of runs) {
    if (!suiteIds.has(run.suite.id) || !COVERAGE_STATUSES.includes(run.status)) continue;
    for (const device of run.devices ?? []) {
      const os = qaOsMajor(device.version);
      if (os === null) continue;
      const key = `${device.platform}:${os}`;
      const cell = cells.get(key) ?? { platform: device.platform, os };
      const kind = device.physical ? "physical" : "virtual";
      const current = cell[kind];
      if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) cell[kind] = run;
      cells.set(key, cell);
    }
  }
  return [...cells.values()].sort(
    (a, b) => a.platform.localeCompare(b.platform) || Number(a.os) - Number(b.os),
  );
}

export function qaFreshnessLabel(freshness: QaFreshness) {
  switch (freshness.state) {
    case "current":
      return "Inputs unchanged";
    case "stale":
      return "Needs rerun";
    case "unknown":
      return "Freshness unknown";
    case "never":
      return "Not yet tested";
  }
}

export const QA_RUN_STATUS_LABELS: Record<QaRunStatus, string> = {
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  incomplete: "Incomplete",
};

export function qaStatusLabel(run: QaRun | undefined) {
  if (!run) return "Never run";
  if (run.status === "passed" && !run.summary) return "Command passed";
  return QA_RUN_STATUS_LABELS[run.status];
}

function formatSeconds(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function qaRunDuration(run: QaRun) {
  if (!run.finishedAt) return "In progress";
  return formatSeconds(Date.parse(run.finishedAt) - Date.parse(run.startedAt));
}

export const QA_STEP_LABELS: Record<QaRunStepId, string> = {
  checkout: "Update checkout",
  setup: "Run setup script",
  devices: "Prepare devices",
  command: "Run tests",
  report: "Read test report",
};

export const QA_STEP_STATUS_LABELS: Record<QaRunStep["status"], string> = {
  pending: "not started",
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

/** The devices a run got, by name; empty until its devices are ready. */
export function qaRunDeviceNames(run: QaRun) {
  return (run.devices ?? []).map((device) => device.name).join(", ");
}

/** A run's steps; one left running by a run that ended is where that run stopped. */
export function qaRunSteps(run: QaRun): ReadonlyArray<QaRunStep> {
  const steps = run.steps ?? [];
  return run.status === "running"
    ? steps
    : steps.map((step) =>
        step.status === "running"
          ? { ...step, status: "failed", finishedAt: run.finishedAt }
          : step,
      );
}

/** How long a step took, or has taken by `now` while it runs. */
export function qaStepDuration(step: QaRunStep, now: number) {
  if (!step.startedAt || step.status === "pending" || step.status === "skipped") return null;
  const elapsed =
    (step.finishedAt ? Date.parse(step.finishedAt) : now) - Date.parse(step.startedAt);
  return Number.isFinite(elapsed) ? formatSeconds(elapsed) : null;
}

/** A run being watched: its state and the output received so far. */
export interface QaLiveRun {
  readonly run: QaRun;
  readonly output: string;
  readonly outputTruncated: boolean;
}

const QA_LIVE_OUTPUT_LIMIT = 128 * 1024;

export function applyQaRunProgress(view: QaLiveRun | null, event: QaRunProgress): QaLiveRun {
  const output = event.reset || !view ? event.output : view.output + event.output;
  return {
    run: event.run,
    output: output.slice(-QA_LIVE_OUTPUT_LIMIT),
    outputTruncated: event.outputTruncated || output.length > QA_LIVE_OUTPUT_LIMIT,
  };
}

/**
 * The last lines of a run's output as a terminal would leave them: colors removed, and a line
 * redrawn with carriage returns shown as its final text.
 */
export function qaOutputTail(output: string, lines = 12) {
  return output
    .slice(-lines * 400)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.slice(line.lastIndexOf("\r") + 1).trimEnd())
    .filter((line, index, all) => line || index < all.length - 1)
    .slice(-lines)
    .join("\n");
}

export function qaRunSummary(run: QaRun) {
  const summary = run.summary;
  return summary
    ? `${summary.tests - summary.failures - summary.skipped} passed · ${summary.failures} failed · ${summary.skipped} skipped`
    : run.status === "running"
      ? "Executing on the selected environment"
      : "No test report";
}

/** The outcome a suite card leads with: counts from the report when there is one, then how long it took. */
export function qaRunHeadline(run: QaRun | undefined) {
  if (!run) return "Never run";
  if (run.status === "running") return "Running";
  const summary = run.summary;
  const outcome = summary?.failures
    ? `${summary.failures} failed of ${summary.tests}`
    : summary && run.status === "passed"
      ? `${summary.tests - summary.skipped} passed${summary.skipped ? ` · ${summary.skipped} skipped` : ""}`
      : qaStatusLabel(run);
  return `${outcome} · ${qaRunDuration(run)}`;
}

const DAY = 24 * 60 * 60 * 1000;
const time24 = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// @effect-diagnostics-next-line globalDate:off - Labels render in clients, outside an Effect runtime.
const localMidnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** When something QA happened or will happen, in 24-hour time: "today 09:41", "Wed 14:02", "3 Nov 08:15". */
// @effect-diagnostics-next-line globalDate:off
export function qaWhen(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const days = Math.round((localMidnight(now) - localMidnight(at)) / DAY);
  const time = time24.format(at);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  if (days === -1) return `tomorrow ${time}`;
  if (Math.abs(days) < 7) return `${weekday.format(at)} ${time}`;
  const year = (ms: number) => dayMonthYear.formatToParts(ms).find((part) => part.type === "year");
  return `${(year(at)?.value === year(now)?.value ? dayMonth : dayMonthYear).format(at)} ${time}`;
}

export const QA_CONFIGURATION_EXAMPLE = `{
  "qa": {
    "suites": [
      {
        "id": "unit",
        "name": "Unit tests",
        "component": "Backend",
        "kind": "unit",
        "command": "npm test -- --run"
      }
    ]
  }
}`;
