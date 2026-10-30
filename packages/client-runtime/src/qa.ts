import type { QaRun, QaRunStatus } from "@t3tools/contracts";

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
        "command": "npm test -- --run"
      }
    ]
  }
}`;
