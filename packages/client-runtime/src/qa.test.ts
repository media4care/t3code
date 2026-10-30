import { ProjectId, type QaRun, type QaSuite } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { groupQaSuites, qaDashboard } from "./qa.ts";

const suites: QaSuite[] = [
  { id: "backend", name: "API", command: "vp test run", component: "Backend", kind: "integration" },
  { id: "web", name: "Browser flows", command: "playwright test", cwd: "apps/web" },
  { id: "mobile", name: "Device flows", command: "maestro test flows", component: "Mobile" },
  { id: "tooling", name: "Scripts", command: "./check.sh" },
];

function run(suite: QaSuite, status: QaRun["status"]): QaRun {
  return {
    id: `run-${suite.id}`,
    projectId: ProjectId.make("project"),
    suite,
    status,
    cwd: "/workspace",
    startedAt: "2026-10-30T10:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-10-30T10:01:00.000Z",
    exitCode: null,
    commit: null,
    branch: null,
    dirty: null,
    summary: null,
    note: null,
  };
}

it("uses current catalog metadata while keeping old runs and inferring unlabelled suites", () => {
  const { entries, counts } = qaDashboard(suites, [
    run({ ...suites[0]!, component: "Old component", name: "Old name" }, "passed"),
    run(suites[1]!, "failed"),
    run(suites[2]!, "running"),
    run({ id: "removed", name: "Removed", command: "test" }, "passed"),
  ]);
  expect(counts).toEqual({ total: 4, passed: 1, attention: 1, running: 1, never: 1 });
  expect(entries.map(({ component, kind }) => ({ component, kind }))).toEqual([
    { component: "Backend", kind: "integration" },
    { component: "Web", kind: "playwright" },
    { component: "Mobile", kind: "maestro" },
    { component: "Project", kind: "other" },
  ]);
  expect(entries[0]?.run?.suite.name).toBe("Old name");
});

it.each(["failed", "incomplete", "cancelled", "interrupted"] as const)(
  "keeps %s runs in needs attention, separate from never run",
  (status) => {
    const { entries } = qaDashboard(suites, [run(suites[0]!, status)]);
    expect(
      groupQaSuites(entries, "none", "", "attention")[0]?.entries.map((e) => e.suite.id),
    ).toEqual(["backend"]);
    expect(groupQaSuites(entries, "none", "", "never")[0]?.entries.map((e) => e.suite.id)).toEqual([
      "web",
      "mobile",
      "tooling",
    ]);
  },
);

it("combines case-insensitive search terms, result filters, and component or type grouping", () => {
  const { entries } = qaDashboard(suites, [run(suites[0]!, "passed"), run(suites[1]!, "failed")]);
  expect(groupQaSuites(entries, "component", "", "all").map((g) => g.label)).toEqual([
    "Backend",
    "Mobile",
    "Project",
    "Web",
  ]);
  const groups = groupQaSuites(entries, "kind", "  WEB  playwright ", "attention");
  expect(groups.map((g) => g.label)).toEqual(["Playwright"]);
  expect(groups[0]?.entries.map((e) => e.suite.id)).toEqual(["web"]);
  expect(groupQaSuites(entries, "component", "Web", "passed")).toEqual([]);
  expect(groupQaSuites([], "component", "", "all")).toEqual([]);
});
