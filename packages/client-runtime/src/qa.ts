import {
  QaCiReport,
  type QaFreshness,
  type QaRun,
  type QaRunStatus,
  type QaSuite,
  type QaTestKind,
  type QaScheduleConfiguration,
  type QaTestCase,
} from "@t3tools/contracts";
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
  return run.source?.type === "ci"
    ? `${run.source.provider} · ${run.source.environment}`
    : run.source?.type === "schedule"
      ? "Scheduled"
      : "Manual";
}

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
  { value: "component", label: "Component" },
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

export function qaDashboard(
  suites: readonly QaSuite[],
  latestRuns: readonly QaRun[],
  freshness: readonly QaFreshness[] = [],
) {
  const latest = new Map(latestRuns.map((run) => [run.suite.id, run]));
  const assessments = new Map(freshness.map((item) => [item.suiteId, item]));
  const counts = { total: suites.length, passed: 0, attention: 0, running: 0, never: 0 };
  const entries = suites.map((suite) => {
    const run = latest.get(suite.id);
    const category = qaResultCategory(run);
    counts[category] += 1;
    return {
      suite,
      run,
      category,
      freshness: assessments.get(suite.id),
      component: qaSuiteComponent(suite),
      kind: qaSuiteKind(suite),
    };
  });
  return { entries, counts };
}
export type QaDashboardEntry = ReturnType<typeof qaDashboard>["entries"][number];

export function groupQaSuites(
  entries: readonly QaDashboardEntry[],
  grouping: QaGrouping,
  search: string,
  filter: QaResultFilter,
) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const groups = new Map<string, QaDashboardEntry[]>();
  for (const entry of entries) {
    if (
      filter === "affected"
        ? !entry.freshness?.needsRun
        : filter !== "all" && entry.category !== filter
    )
      continue;
    const text =
      `${entry.suite.name} ${entry.suite.id} ${entry.component} ${QA_KIND_LABELS[entry.kind]} ${entry.suite.command}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) continue;
    const label =
      grouping === "component"
        ? entry.component
        : grouping === "kind"
          ? QA_KIND_LABELS[entry.kind]
          : "All suites";
    const group = groups.get(label) ?? [];
    group.push(entry);
    groups.set(label, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({ label, entries: items }));
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

const STATUS_LABELS: Record<QaRunStatus, string> = {
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
  return STATUS_LABELS[run.status];
}

export function qaRunDuration(run: QaRun) {
  if (!run.finishedAt) return "In progress";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000),
  );
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function qaRunSummary(run: QaRun) {
  const summary = run.summary;
  return summary
    ? `${summary.tests - summary.failures - summary.skipped} passed · ${summary.failures} failed · ${summary.skipped} skipped`
    : run.status === "running"
      ? "Executing on the selected environment"
      : "No test report";
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
