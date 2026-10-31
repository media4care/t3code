import {
  EnvironmentId,
  ProjectId,
  type QaRun,
  type QaSnapshot,
  type QaSuite,
  type QaScheduleConfiguration,
  type QaCiReport,
  type QaTestCase,
  type QaTestStatus,
} from "@t3tools/contracts";
import { QA_CI_REPORT_EXAMPLE } from "@t3tools/client-runtime/qa";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { QaPage } from "./QaPage";

const state = vi.hoisted(() => ({
  snapshots: {} as Record<string, QaSnapshot>,
  runs: {} as Record<string, QaRun>,
  tests: {} as Record<string, QaTestCase[]>,
  allowed: true,
}));

vi.mock("../../state/entities", () => ({
  useProjects: () => [
    { id: "alpha", environmentId: "laptop", title: "Alpha" },
    { id: "beta", environmentId: "remote", title: "Beta" },
  ],
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      { environmentId: "laptop", label: "Laptop", connection: { phase: "connected" } },
      { environmentId: "remote", label: "Remote", connection: { phase: "connected" } },
    ],
  }),
}));
vi.mock("../../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    serverEnvironment: {
      qaLive: (input: unknown) => ({ kind: "snapshot", target: input }),
      qaDetails: (input: unknown) => ({ kind: "details", target: input }),
      qaTests: (input: unknown) => ({ kind: "tests", target: input }),
      setQaSchedule: { kind: "setSchedule", permissionAtom: () => Atom.make(state.allowed) },
      importQaReport: { kind: "import", permissionAtom: () => Atom.make(state.allowed) },
      startQa: { kind: "start", permissionAtom: () => Atom.make(state.allowed) },
      startAffectedQa: { kind: "startAffected", permissionAtom: () => Atom.make(state.allowed) },
      cancelAffectedQa: { kind: "cancelAffected", permissionAtom: () => Atom.make(state.allowed) },
      cancelQa: { kind: "cancel" },
    },
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: {
    kind: string;
    target: {
      input: {
        projectId: string;
        runId?: string;
        search?: string;
        offset?: number;
        status?: QaTestStatus;
      };
    };
  }) => {
    const run = state.runs[query.target.input.runId ?? ""];
    const allTests = state.tests[query.target.input.runId ?? ""];
    const terms = (query.target.input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (allTests ?? []).filter(
      (test) =>
        (!query.target.input.status || query.target.input.status === test.status) &&
        terms.every((term) =>
          `${test.name} ${test.group ?? ""} ${test.file ?? ""}`.toLowerCase().includes(term),
        ),
    );
    const offset = query.target.input.offset ?? 0;
    return {
      data:
        query.kind === "snapshot"
          ? state.snapshots[query.target.input.projectId]
          : query.kind === "tests"
            ? {
                run,
                tests: matches.slice(offset, offset + 50),
                total: allTests?.length ?? 0,
                matched: matches.length,
                offset,
                nextOffset: offset + 50 < matches.length ? offset + 50 : null,
                unavailableReason: allTests
                  ? null
                  : "This run has no per-test report. Run the suite with JUnit reporting to see individual results.",
              }
            : run
              ? {
                  run,
                  output: `${run.id}: ${run.suite.name}: captured output`,
                  outputTruncated: false,
                  reportXml: null,
                }
              : null,
      error: null,
      isPending: false,
      refresh: () => {},
    };
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand:
    (command: { kind: string }) =>
    async (target: {
      environmentId: EnvironmentId;
      input: {
        projectId: ProjectId;
        suiteId: string;
        configuration?: QaScheduleConfiguration | null;
        report?: QaCiReport;
      };
    }) => {
      const snapshot = state.snapshots[target.input.projectId]!;
      if (command.kind === "setSchedule") {
        state.snapshots[target.input.projectId] = {
          ...snapshot,
          schedule: target.input.configuration
            ? {
                configuration: target.input.configuration,
                revision: target.input.configuration.enabled ? "enabled" : "paused",
                nextRunAt: target.input.configuration.enabled ? "2026-10-31T09:00:00.000Z" : null,
                lastRunAt: null,
                lastStatus: "never",
                note: null,
                runIds: [],
              }
            : null,
        };
        return { _tag: "Success", value: undefined };
      }
      if (command.kind === "startAffected") {
        const ids =
          snapshot.freshness?.filter((item) => item.needsRun).map((item) => item.suiteId) ?? [];
        state.snapshots[target.input.projectId] = {
          ...snapshot,
          batchRunning: true,
          queuedSuiteIds: ids,
        };
        return { _tag: "Success", value: ids };
      }
      if (command.kind === "cancelAffected") {
        state.snapshots[target.input.projectId] = {
          ...snapshot,
          batchRunning: false,
          queuedSuiteIds: [],
        };
        return { _tag: "Success", value: undefined };
      }
      const suite = snapshot.suites.find(
        (item) => item.id === (target.input.report?.suiteId ?? target.input.suiteId),
      )!;
      const run: QaRun = {
        id: `${target.environmentId}:${target.input.projectId}${target.input.report ? ":ci" : ""}`,
        projectId: target.input.projectId,
        suite,
        cwd: snapshot.workspaceRoot,
        startedAt: "2026-10-30T10:00:00.000Z",
        finishedAt: "2026-10-30T10:00:02.000Z",
        status: "passed",
        exitCode: 0,
        commit: "12345678",
        branch: "main",
        dirty: false,
        summary: null,
        note: null,
        ...(target.input.report ? { source: target.input.report.source } : {}),
      };
      state.runs[run.id] = run;
      state.snapshots[target.input.projectId] = {
        ...snapshot,
        latestRuns: target.input.report ? snapshot.latestRuns : [run],
        latestCiRuns: target.input.report ? [run] : (snapshot.latestCiRuns ?? []),
        recentRuns: [run],
      };
      return { _tag: "Success", value: run };
    },
}));

function setup() {
  state.allowed = true;
  state.runs = {};
  state.tests = {};
  state.snapshots = Object.fromEntries(
    ["alpha", "beta"].map((id) => [
      id,
      {
        workspaceRoot: `/work/${id}`,
        configurationError: null,
        suites: [{ id: "unit", name: `${id} tests`, command: `run-${id}` }],
        latestRuns: [],
        recentRuns: [],
        branch: "main",
        schedule: null,
        latestCiRuns: [],
        testResultsAvailable: true,
      },
    ]),
  );
}

it("keeps runs scoped to the selected project and environment when switching the catalog", async () => {
  setup();
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  await screen.getByRole("button", { name: "Run", exact: true }).click();
  await screen.getByText("Run output", { exact: true }).click();
  await expect
    .element(screen.getByText("laptop:alpha: alpha tests: captured output", { exact: true }))
    .toBeVisible();
  await screen.getByRole("combobox", { name: "QA project" }).click();
  await page.getByRole("option", { name: "Beta · Remote" }).click();
  await expect.element(screen.getByRole("heading", { name: "beta tests" })).toBeVisible();
  await expect
    .element(screen.getByText("laptop:alpha: alpha tests: captured output", { exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Run", exact: true }).click();
  await screen.getByText("Run output", { exact: true }).click();
  await expect
    .element(screen.getByText("remote:beta: beta tests: captured output", { exact: true }))
    .toBeVisible();
});

it("opens failed run output without a report and lets it be collapsed", async () => {
  dashboardFixture();
  const run = state.runs["family-web"]!;
  const failure: QaRun = {
    ...run,
    summary: null,
    outputTail: "Cannot connect to the Docker daemon",
    note: "No valid JUnit report was produced.",
  };
  state.runs[run.id] = failure;
  state.snapshots.alpha = {
    ...state.snapshots.alpha!,
    latestRuns: state.snapshots.alpha!.latestRuns.map((item) =>
      item.id === run.id ? failure : item,
    ),
  };
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  const suite = screen.getByRole("region", { name: run.suite.name, exact: true });
  await expect.element(suite.getByText(failure.outputTail!, { exact: true })).toBeVisible();
  await suite.getByRole("button", { name: "View run", exact: true }).click();
  const details = screen.getByRole("region", { name: "Run details", exact: true });
  const output = details.getByText(`${run.id}: ${run.suite.name}: captured output`, {
    exact: true,
  });
  await expect.element(output).toBeVisible();
  await details.getByText("Run output", { exact: true }).click();
  await expect.element(output).not.toBeVisible();
});

it("manages recurring runs and imports CI results in the selected environment", async () => {
  setup();
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  await screen.getByRole("combobox", { name: "QA project" }).click();
  await page.getByRole("option", { name: "Beta · Remote" }).click();
  await screen.getByRole("button", { name: "Add schedule", exact: true }).click();
  await screen.getByRole("combobox", { name: "Scheduled suites" }).click();
  await page.getByRole("option", { name: "Affected suites", exact: true }).click();
  await screen.getByRole("textbox", { name: "Time zone", exact: true }).fill("Europe/Berlin");
  await screen.getByRole("button", { name: "Save schedule", exact: true }).click();
  await vi.waitFor(() =>
    expect(state.snapshots.beta?.schedule?.configuration.target.type).toBe("affected"),
  );
  expect(state.snapshots.alpha?.schedule).toBeNull();
  await screen.rerender(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "Pause schedule", exact: true }).click();
  await vi.waitFor(() => expect(state.snapshots.beta?.schedule?.configuration.enabled).toBe(false));
  await screen.rerender(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "Resume schedule", exact: true }).click();
  await vi.waitFor(() => expect(state.snapshots.beta?.schedule?.configuration.enabled).toBe(true));
  await screen.rerender(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "Remove schedule", exact: true }).click();
  await vi.waitFor(() => expect(state.snapshots.beta?.schedule).toBeNull());
  await screen.rerender(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
  );
  await screen.getByText("Import CI report", { exact: true }).click();
  await screen.getByRole("textbox", { name: "CI report JSON" }).fill("bad json");
  await screen.getByRole("button", { name: "Import result", exact: true }).click();
  await expect
    .element(screen.getByText("Use the CI report JSON format shown below", { exact: false }))
    .toBeVisible();
  await screen.getByRole("textbox", { name: "CI report JSON" }).fill(QA_CI_REPORT_EXAMPLE);
  await screen.getByRole("button", { name: "Import result", exact: true }).click();
  await screen.getByText("Run output", { exact: true }).click();
  await expect
    .element(screen.getByText("remote:beta:ci: beta tests: captured output", { exact: true }))
    .toBeVisible();
  expect(state.snapshots.alpha?.recentRuns).toHaveLength(0);
  expect(state.snapshots.beta?.latestRuns).toHaveLength(0);
  state.allowed = false;
  await screen.rerender(
    <SidebarProvider key="denied">
      <QaPage />
    </SidebarProvider>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Add schedule", exact: true }))
    .toBeDisabled();
  await screen.getByText("Import CI report", { exact: true }).click();
  await screen.getByRole("textbox", { name: "CI report JSON" }).fill(QA_CI_REPORT_EXAMPLE);
  await expect
    .element(screen.getByRole("button", { name: "Import result", exact: true }))
    .toBeDisabled();
});

function dashboardFixture() {
  setup();
  const suites: QaSuite[] = [
    {
      id: "api",
      name: "API integration tests",
      command: "yarn test:api",
      component: "Backend",
      kind: "integration",
    },
    {
      id: "backend",
      name: "Backend unit tests",
      command: "yarn test:unit",
      component: "Backend",
      kind: "unit",
    },
    {
      id: "family-web",
      name: "Family browser journeys",
      command: "playwright test",
      component: "Family",
      kind: "playwright",
    },
    {
      id: "family-native",
      name: "Family mobile flows",
      command: "maestro test flows",
      component: "Family",
      kind: "maestro",
    },
    {
      id: "senior-web",
      name: "Senior browser journeys",
      command: "playwright test",
      component: "Senior",
      kind: "playwright",
    },
    {
      id: "senior-native",
      name: "Senior mobile flows",
      command: "maestro test flows",
      component: "Senior",
      kind: "maestro",
    },
    {
      id: "cross-app",
      name: "Family to Senior video calls",
      command: "yarn test:cross-app",
      component: "Cross-app",
      kind: "e2e",
    },
  ];
  const latestRuns = suites.slice(0, 4).map((suite, index): QaRun => ({
    id: suite.id,
    projectId: ProjectId.make("alpha"),
    suite,
    cwd: "/work/alpha",
    startedAt: "2026-10-30T10:00:00.000Z",
    finishedAt: "2026-10-30T10:01:42.000Z",
    status: index === 2 ? "failed" : "passed",
    exitCode: index === 2 ? 1 : 0,
    commit: "12345678",
    branch: "main",
    dirty: false,
    summary: { tests: 48, failures: index === 2 ? 2 : 0, skipped: 1 },
    note: null,
  }));
  state.snapshots.alpha = {
    workspaceRoot: "/Users/javier/dev/m4c/app",
    configurationError: null,
    suites,
    latestRuns,
    recentRuns: latestRuns,
    schedule: null,
    latestCiRuns: [],
    testResultsAvailable: true,
    checkedAt: "2026-10-30T11:00:00.000Z",
    freshness: suites.map((suite, index) => ({
      suiteId: suite.id,
      state: index === 0 ? "stale" : index < 4 ? "current" : "never",
      reason:
        index === 0
          ? "Backend authentication changed since this run."
          : "Configured inputs match this run.",
      changedPaths: index === 0 ? ["backend/auth.ts"] : [],
      changedFileCount: index === 0 ? 1 : 0,
      needsRun: index === 0 || index === 2 || index > 3,
      lastPassedAt: index < 4 ? "2026-10-30T10:01:42.000Z" : null,
    })),
  };
  state.runs = Object.fromEntries(latestRuns.map((run) => [run.id, run]));
}

it("groups the catalog and combines search with result filters", async () => {
  dashboardFixture();
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  await expect
    .element(screen.getByRole("heading", { name: "Test suites", exact: true }))
    .toBeVisible();
  await screen.getByText("Backend", { exact: true }).click();
  await expect
    .element(
      screen
        .getByRole("group", { name: "Backend", exact: true })
        .getByText("API integration tests", { exact: true }),
    )
    .not.toBeVisible();
  await screen.getByText("Backend", { exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "API integration tests", exact: true }))
    .toBeVisible();
  await screen.getByRole("combobox", { name: "Group suites by" }).click();
  await page.getByRole("option", { name: "Test type", exact: true }).click();
  await expect
    .element(screen.getByRole("group", { name: "Playwright", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("group", { name: "Backend", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("searchbox", { name: "Search suites" }).fill("FAMILY");
  await screen.getByRole("button", { name: "Needs attention 1", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Family browser journeys", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Family mobile flows", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("1 of 7 suites", { exact: true })).toBeVisible();
  await screen.getByRole("searchbox", { name: "Search suites" }).fill("unknown");
  await expect
    .element(screen.getByText("No suites match these filters", { exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect.element(screen.getByText("7 of 7 suites", { exact: true })).toBeVisible();
});

it("shows freshness separately from results, filters affected suites and controls the server queue", async () => {
  dashboardFixture();
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  const api = screen.getByRole("region", { name: "API integration tests" });
  await expect.element(api.getByText("Passed", { exact: true })).toBeVisible();
  await expect.element(api.getByText("Needs rerun", { exact: true })).toBeVisible();
  await api.getByText("Changed inputs (1)").click();
  await expect.element(api.getByText("backend/auth.ts")).toBeVisible();
  await screen.getByRole("button", { name: "Show affected", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Backend unit tests" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("heading", { name: "Family browser journeys" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Run affected suites (5)" }).click();
  await expect
    .element(screen.getByText("5 queued · Runs continue when you leave QA."))
    .toBeVisible();
  await expect.element(api.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await screen.getByRole("button", { name: "Stop queued run" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Run affected suites (5)" }))
    .toBeEnabled();
  state.allowed = false;
  await screen.rerender(
    <SidebarProvider key="denied">
      <QaPage />
    </SidebarProvider>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Run affected suites (5)" }))
    .toBeDisabled();
});

it("lists individual results with paging, search, result filters, and failure details", async () => {
  dashboardFixture();
  const tests: QaTestCase[] = Array.from({ length: 123 }, (_, index) => ({
    id: index,
    name:
      [
        "signs in with valid credentials",
        "refreshes an expiring access token",
        "rejects an expired session",
        "keeps the session after relaunch",
      ][index] ?? `validates user record ${index}`,
    group: "Authentication › Sessions",
    file: "apps/server/src/auth/session.test.ts",
    durationMs: 12 + index * 2,
    status: index === 2 ? "failed" : index === 3 ? "skipped" : "passed",
    details:
      index === 2
        ? "Expected 401 (Unauthorized)\nReceived 200 (OK)\n  at session.test.ts:42"
        : index === 3
          ? "Requires a physical device"
          : null,
    truncated: false,
  }));
  state.tests.api = tests;
  const run: QaRun = {
    ...state.runs.api!,
    status: "failed",
    exitCode: 1,
    summary: { tests: 123, failures: 1, skipped: 1 },
  };
  state.runs.api = run;
  state.snapshots.alpha = { ...state.snapshots.alpha!, latestRuns: [run], recentRuns: [run] };
  await using screen = await render(
    <SidebarProvider>
      <QaPage />
    </SidebarProvider>,
    { router: "/qa" },
  );
  await screen.getByRole("button", { name: "View tests (123)", exact: true }).click();
  const results = screen.getByRole("region", { name: "Individual tests", exact: true });
  await expect.element(results.getByText("1–50 of 123 tests", { exact: true })).toBeVisible();
  await expect
    .element(results.getByText("signs in with valid credentials", { exact: true }))
    .toBeVisible();
  await results.getByRole("button", { name: "Next tests", exact: true }).click();
  await expect.element(results.getByText("51–100 of 123 tests", { exact: true })).toBeVisible();
  await expect
    .element(results.getByText("signs in with valid credentials", { exact: true }))
    .not.toBeInTheDocument();
  await results.getByRole("searchbox", { name: "Search tests" }).fill("RECORD 122");
  await expect
    .element(results.getByText("1–1 of 1 tests · 123 in report", { exact: true }))
    .toBeVisible();
  await expect
    .element(results.getByText("validates user record 122", { exact: true }))
    .toBeVisible();
  await results.getByRole("button", { name: "Clear test filters", exact: true }).click();
  await results.getByRole("combobox", { name: "Filter tests" }).click();
  await page.getByRole("option", { name: "Failed", exact: true }).click();
  await expect
    .element(results.getByText("rejects an expired session", { exact: true }))
    .toBeVisible();
  await results.getByText("Failure details", { exact: true }).click();
  await expect.element(results.getByText("Received 200 (OK)", { exact: false })).toBeVisible();
  await results.getByRole("combobox", { name: "Filter tests" }).click();
  await page.getByRole("option", { name: "Skipped", exact: true }).click();
  await results.getByText("Skip reason", { exact: true }).click();
  await expect
    .element(results.getByText("Requires a physical device", { exact: true }))
    .toBeVisible();
  await results.getByRole("searchbox", { name: "Search tests" }).fill("nothing matches");
  await expect
    .element(results.getByText("No tests match these filters.", { exact: true }))
    .toBeVisible();
  state.allowed = false;
  await screen.rerender(
    <SidebarProvider key="read-only">
      <QaPage />
    </SidebarProvider>,
  );
  await expect
    .element(screen.getByRole("button", { name: "View tests (123)", exact: true }))
    .toBeEnabled();
  await screen.getByRole("button", { name: "View tests (123)", exact: true }).click();
  await expect.element(screen.getByRole("table", { name: "Test results" })).toBeVisible();
  state.snapshots.alpha = { ...state.snapshots.alpha!, testResultsAvailable: false };
  await screen.rerender(
    <SidebarProvider key="old-server">
      <QaPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "View tests (123)", exact: true }).click();
  await expect
    .element(
      screen.getByText("Update this environment’s server to view individual test results.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(screen.getByRole("table", { name: "Test results" })).not.toBeInTheDocument();
});
