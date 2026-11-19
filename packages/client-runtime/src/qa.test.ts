import {
  EnvironmentId,
  ProjectId,
  type QaRun,
  type QaRunStatus,
  type QaSuite,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  applyQaRunProgress,
  groupQaSuites,
  qaDashboard,
  qaOutputTail,
  qaAttention,
  qaDeviceCoverage,
  qaGroupSuiteIds,
  qaGroupSummary,
  qaLaneSections,
  qaLanesHeadline,
  qaProjects,
  qaRepositories,
  qaRunHeadline,
  qaRunTitle,
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

it("sums up a suite run per device from each lane's latest run, ignoring older single runs", () => {
  const phones: QaSuite = {
    id: "phones",
    name: "Phone flows",
    command: "maestro test flows",
    runPer: "device",
    devices: [
      { id: "android", platform: "android", formFactor: "tablet" },
      { id: "ios", platform: "ios", formFactor: "phone" },
    ],
    variants: [
      { id: "swOnly", name: "SW only" },
      { id: "swAndHw", name: "SW + HW", devices: ["android"] },
    ],
  };
  const single = { ...run(phones, "failed"), id: "single", exitCode: 1 };
  const lane = (key: string, status: QaRunStatus) => ({
    ...run(phones, status),
    id: key,
    lane: key,
  });
  const passed = [lane("android/swOnly", "passed"), lane("android/swAndHw", "passed")];
  const ios = lane("ios/swOnly", "incomplete");
  const finished = qaDashboard([phones], [single, ...passed, ios]).entries[0]!;
  expect(finished.lanes.map(({ outcome }) => outcome)).toEqual(["passed", "passed", "not-run"]);
  expect(finished.run?.id).toBe("ios/swOnly");
  expect(finished.category).toBe("attention");
  expect(qaLanesHeadline(finished.lanes)).toBe("1 of 3 not run");
  expect(
    qaLaneSections(finished.lanes).map((section) => [
      section.title,
      ...section.lanes.map(({ lane }) => lane.key),
    ]),
  ).toEqual([
    ["SW only", "android/swOnly", "ios/swOnly"],
    ["SW + HW", "android/swAndHw"],
  ]);
  expect(qaRunTitle(ios)).toBe("Phone flows · iOS phone · SW only");

  const failed = { ...ios, status: "failed" as const, exitCode: 1 };
  expect(qaLanesHeadline(qaDashboard([phones], [...passed, failed]).entries[0]!.lanes)).toBe(
    "1 of 3 failed",
  );
  expect(
    qaDashboard([phones], [...passed, { ...ios, status: "passed" }]).entries[0]?.category,
  ).toBe("passed");

  const running = qaDashboard(
    [phones],
    [{ ...passed[0]!, status: "running" }],
    [],
    [{ suiteId: "phones", lane: "ios/swOnly" }],
  ).entries[0]!;
  expect(running.lanes.map(({ outcome }) => outcome)).toEqual(["running", "never", "queued"]);
  expect(running.category).toBe("running");
  expect(qaLanesHeadline(running.lanes)).toBe("Running 1 of 3");
  expect(qaDashboard([phones], [single]).entries[0]?.category).toBe("never");
});

it("combines case-insensitive search terms, result filters, and component or type grouping in catalog order", () => {
  const { entries } = qaDashboard(suites, [run(suites[0]!, "passed"), run(suites[1]!, "failed")]);
  expect(groupQaSuites(entries, "app", "", "all").map((g) => g.label)).toEqual([
    "Backend",
    "Web",
    "Mobile",
    "Project",
  ]);
  const groups = groupQaSuites(entries, "kind", "  WEB  playwright ", "attention");
  expect(groups.map((g) => g.label)).toEqual(["Playwright"]);
  expect(groups[0]?.entries.map((e) => e.suite.id)).toEqual(["web"]);
  expect(groupQaSuites(entries, "app", "Web", "passed")).toEqual([]);
  expect(groupQaSuites([], "app", "", "all")).toEqual([]);
});

it("groups suites by the apps they test, sums each app up, and lists what needs attention", () => {
  const apps = [
    { id: "pro", name: "Betreuung Pro" },
    { id: "home", name: "Senioren" },
  ];
  const tablets: QaSuite = {
    id: "tablets",
    name: "Tablet flows",
    command: "maestro test",
    component: "Senior",
    apps: ["pro"],
    runPer: "device",
    devices: [{ id: "tablet", platform: "android", os: ["13", "15"] }],
  };
  const shared: QaSuite = { ...suites[0]!, id: "unit", component: "Senior", apps: ["pro", "home"] };
  const home: QaSuite = { ...suites[1]!, id: "home", apps: ["home"] };
  const catalog = [suites[3]!, tablets, shared, home];
  const lane = (key: string, status: QaRunStatus, version: string, physical = false): QaRun => ({
    ...run(tablets, status),
    id: key,
    lane: key,
    commit: "head",
    exitCode: status === "failed" ? 1 : 0,
    devices: [
      { requirement: "tablet", deviceId: key, name: key, platform: "android", physical, version },
    ],
  });
  const runs = [
    lane("tablet@13", "passed", "Android 13"),
    lane("tablet@15", "failed", "Android 15"),
  ];
  const { entries } = qaDashboard(
    catalog,
    [...runs, { ...run(shared, "passed"), commit: "old" }],
    [
      {
        suiteId: "unit",
        state: "stale",
        reason: "Inputs changed",
        changedPaths: [],
        changedFileCount: 1,
        needsRun: true,
        lastPassedAt: null,
      },
    ],
  );
  const groups = groupQaSuites(entries, "app", "", "all", apps);
  expect(groups.map(({ label, other }) => [label, other])).toEqual([
    ["Betreuung Pro", false],
    ["Senior · both apps", false],
    ["Senioren", false],
    ["Other", true],
  ]);
  // Other groupings mix apps, so their groups name none.
  expect(groupQaSuites(entries, "kind", "", "all", apps).flatMap((group) => group.apps)).toEqual(
    [],
  );
  expect(qaGroupSummary(groups[0]!.entries, "head")).toMatchObject({
    tone: "failed",
    headline: "1 failed",
    cells: [
      { key: "tablets/tablet@13", outcome: "passed" },
      { key: "tablets/tablet@15", outcome: "failed" },
    ],
    detail: "1/2 passed · all latest",
  });
  expect(qaGroupSummary(groups[1]!.entries, "head")).toMatchObject({
    tone: "stale",
    detail: "1/1 passed · 0 on latest",
  });
  expect(qaAttention(entries).map(({ key, reason }) => [key, reason])).toEqual([
    ["tablets/tablet@15", "failed"],
    ["unit:stale", "stale"],
  ]);

  // A device someone chose by hand counts for the version it runs; the latest run on each wins.
  const physical = { ...lane("tablet@13", "passed", "Android 14.0", true), id: "hand" };
  const older = {
    ...lane("tablet@15", "passed", "Android 15"),
    id: "older",
    startedAt: "2026-10-29T10:00:00.000Z",
  };
  const coverage = qaDeviceCoverage(qaGroupSuiteIds(groups[0]!, entries), [
    ...runs,
    physical,
    older,
  ]);
  expect(
    coverage.map(({ os, virtual, physical }) => [
      os,
      virtual?.status ?? null,
      physical?.id ?? null,
    ]),
  ).toEqual([
    ["13", "passed", null],
    ["14", null, "hand"],
    ["15", "failed", null],
  ]);
  expect(qaGroupSuiteIds(groups[1]!, entries)).toEqual(new Set(["unit"]));
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
