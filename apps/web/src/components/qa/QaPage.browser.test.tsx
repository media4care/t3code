import { EnvironmentId, ProjectId, type QaRun, type QaSnapshot } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { QaPage } from "./QaPage";

const state = vi.hoisted(() => ({
  snapshots: {} as Record<string, QaSnapshot>,
  runs: {} as Record<string, QaRun>,
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
      startQa: { kind: "start", permissionAtom: () => Atom.make(state.allowed) },
      cancelQa: { kind: "cancel" },
    },
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: {
    kind: string;
    target: { input: { projectId: string; runId?: string } };
  }) => {
    const run = state.runs[query.target.input.runId ?? ""];
    return {
      data:
        query.kind === "snapshot"
          ? state.snapshots[query.target.input.projectId]
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
    () =>
    async (target: {
      environmentId: EnvironmentId;
      input: { projectId: ProjectId; suiteId: string };
    }) => {
      const snapshot = state.snapshots[target.input.projectId]!;
      const suite = snapshot.suites.find((item) => item.id === target.input.suiteId)!;
      const run: QaRun = {
        id: `${target.environmentId}:${target.input.projectId}`,
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
      };
      state.runs[run.id] = run;
      state.snapshots[target.input.projectId] = {
        ...snapshot,
        latestRuns: [run],
        recentRuns: [run],
      };
      return { _tag: "Success", value: run };
    },
}));

function setup() {
  state.allowed = true;
  state.runs = {};
  state.snapshots = Object.fromEntries(
    ["alpha", "beta"].map((id) => [
      id,
      {
        workspaceRoot: `/work/${id}`,
        configurationError: null,
        suites: [{ id: "unit", name: `${id} tests`, command: `run-${id}` }],
        latestRuns: [],
        recentRuns: [],
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
  await expect
    .element(screen.getByText("remote:beta: beta tests: captured output", { exact: true }))
    .toBeVisible();
});
