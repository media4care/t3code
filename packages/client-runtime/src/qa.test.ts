import { EnvironmentId, ProjectId, type QaRun, type QaSuite } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  applyQaRunProgress,
  groupQaSuites,
  qaDashboard,
  qaOutputTail,
  qaPlatformsHeadline,
  qaProjects,
  qaRepositories,
  qaRunHeadline,
  qaRunSteps,
  qaStepDuration,
  qaWhen,
} from "./qa.ts";

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

it("sums up a suite run per platform from each platform's latest run, ignoring older single runs", () => {
  const phones: QaSuite = {
    id: "phones",
    name: "Phone flows",
    command: "maestro test flows",
    runPer: "platform",
    devices: [
      { platform: "android", formFactor: "phone" },
      { platform: "ios", formFactor: "phone" },
    ],
  };
  const single = { ...run(phones, "failed"), id: "single", exitCode: 1 };
  const android = { ...run(phones, "passed"), id: "android", platform: "android" as const };
  const ios = { ...run(phones, "incomplete"), id: "ios", platform: "ios" as const };
  const finished = qaDashboard([phones], [single, android, ios]).entries[0]!;
  expect(finished.platforms.map(({ outcome }) => outcome)).toEqual(["passed", "not-run"]);
  expect(finished.run?.id).toBe("ios");
  expect(finished.category).toBe("attention");
  expect(qaPlatformsHeadline(finished.platforms)).toBe("1 of 2 not run");

  const failed = { ...ios, status: "failed" as const, exitCode: 1 };
  expect(qaPlatformsHeadline(qaDashboard([phones], [android, failed]).entries[0]!.platforms)).toBe(
    "1 of 2 failed",
  );
  expect(qaDashboard([phones], [android, { ...ios, status: "passed" }]).entries[0]?.category).toBe(
    "passed",
  );

  const running = qaDashboard(
    [phones],
    [{ ...android, status: "running" }],
    [],
    [{ suiteId: "phones", platform: "ios" }],
  ).entries[0]!;
  expect(running.platforms.map(({ outcome }) => outcome)).toEqual(["running", "queued"]);
  expect(running.category).toBe("running");
  expect(qaPlatformsHeadline(running.platforms)).toBe("Running 1 of 2");
  expect(qaDashboard([phones], [single]).entries[0]?.category).toBe("never");
});

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

it("lists each repository once per environment that runs QA, by a fork's origin, without scratch projects", () => {
  const studio = EnvironmentId.make("studio");
  const laptop = EnvironmentId.make("laptop");
  const app = {
    canonicalKey: "github.com/acme/app",
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: "git@github.com:acme/app.git",
    },
    displayName: "acme/app",
  };
  const projects = [
    { environmentId: studio, id: "app2", title: "app2", repositoryIdentity: app },
    { environmentId: studio, id: "app3", title: "app3", repositoryIdentity: app },
    { environmentId: studio, id: "local", title: "local", repositoryIdentity: null },
    { environmentId: studio, id: "scratch", title: "No project", isScratch: true as const },
    { environmentId: laptop, id: "app", title: "app", repositoryIdentity: app },
    {
      environmentId: studio,
      id: "fork",
      title: "fork",
      repositoryIdentity: {
        canonicalKey: "github.com/upstream/app",
        locator: {
          source: "git-remote" as const,
          remoteName: "upstream",
          remoteUrl: "https://github.com/upstream/app.git",
        },
        displayName: "upstream/app",
        origin: {
          canonicalKey: "github.com/acme/app",
          remoteUrl: "git@github.com:acme/app.git",
          displayName: "acme/app",
        },
      },
    },
  ];
  const environments = [
    { environmentId: studio, serverConfig: { settings: { qaEnabled: true } } },
    { environmentId: laptop, serverConfig: { settings: { qaEnabled: false } } },
  ];

  expect(
    qaRepositories(qaProjects(projects, environments)).map(({ title, project }) => [
      title,
      project.id,
    ]),
  ).toEqual([
    ["acme/app", "app2"],
    ["local", "local"],
  ]);
});

it("follows a watched run's output, and shows where an interrupted run stopped", () => {
  const running = run(suites[0]!, "running");
  const event = { run: running, outputTruncated: false };
  const first = applyQaRunProgress(null, { ...event, output: "one\n", reset: true });
  const second = applyQaRunProgress(first, { ...event, output: "two\n", reset: false });
  expect(second.output).toBe("one\ntwo\n");
  // The server starts over when it no longer keeps what this client has.
  expect(applyQaRunProgress(second, { ...event, output: "three\n", reset: true }).output).toBe(
    "three\n",
  );
  expect(qaOutputTail("first\n\u001b[32mok\u001b[0m\r\n10%\r50%\r100%\nlast\n", 3)).toBe(
    "ok\n100%\nlast",
  );

  const steps = [
    {
      id: "checkout",
      status: "done",
      startedAt: "2026-10-30T10:00:00.000Z",
      finishedAt: "2026-10-30T10:00:00.400Z",
    },
    { id: "command", status: "running", startedAt: "2026-10-30T10:00:00.400Z", finishedAt: null },
  ] as const;
  const now = Date.parse("2026-10-30T10:01:05.000Z");
  expect(steps.map((step) => qaStepDuration(step, now))).toEqual(["0s", "1m 5s"]);
  expect(qaRunSteps({ ...running, steps }).map((step) => step.status)).toEqual(["done", "running"]);
  expect(
    qaRunSteps({ ...run(suites[0]!, "interrupted"), steps }).map((step) => step.status),
  ).toEqual(["done", "failed"]);
});

it("leads a suite card with its outcome, and dates runs in 24-hour time relative to today", () => {
  const passed = run(suites[0]!, "passed");
  expect(qaRunHeadline(undefined)).toBe("Never run");
  expect(qaRunHeadline(run(suites[0]!, "running"))).toBe("Running");
  expect(qaRunHeadline(passed)).toBe("Command passed · 1m 0s");
  expect(qaRunHeadline({ ...passed, summary: { tests: 298, failures: 0, skipped: 2 } })).toBe(
    "296 passed · 2 skipped · 1m 0s",
  );
  expect(
    qaRunHeadline({
      ...run(suites[0]!, "failed"),
      summary: { tests: 120, failures: 3, skipped: 0 },
    }),
  ).toBe("3 failed of 120 · 1m 0s");

  // Local times, so the labels hold in any time zone the tests run in.
  // @effect-diagnostics-next-line globalDate:off
  const now = new Date(2026, 10, 15, 11, 20).getTime();
  const at = (day: number, hour: number, minute: number) =>
    // @effect-diagnostics-next-line globalDate:off
    new Date(2026, 10, day, hour, minute).toISOString();
  expect(qaWhen(at(15, 9, 5), now)).toBe("today 09:05");
  expect(qaWhen(at(14, 20, 53), now)).toBe("yesterday 20:53");
  expect(qaWhen(at(16, 0, 0), now)).toBe("tomorrow 00:00");
  expect(qaWhen(at(12, 23, 22), now)).toMatch(/^\S+ 23:22$/);
  expect(qaWhen(at(1, 8, 15), now)).not.toMatch(/today|yesterday|AM|PM/);
});
