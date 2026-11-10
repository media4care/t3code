import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type InsightStatus,
  type InsightsSettings,
} from "@t3tools/contracts";
import {
  insightChange,
  insightsLinkedEnvironments,
  recurringInsightFriction,
  reviewedInsightThreads,
  setLinkedInsightsProject,
  insightImplementationStatus,
  insightTrial,
  insightImplementationUrl,
  matchesInsightFilter,
} from "./insights.ts";

describe("implementation tracking", () => {
  it.each([
    ["open", null, "not_implemented"],
    ["accepted", null, "not_implemented"],
    ["accepted", ThreadId.make("implementation"), "started"],
    ["implemented", ThreadId.make("implementation"), "implemented"],
    ["implemented", null, "implemented"],
    ["open", ThreadId.make("previous-implementation"), "not_implemented"],
    ["deferred", ThreadId.make("previous-implementation"), "not_implemented"],
    ["dismissed", ThreadId.make("previous-implementation"), "not_implemented"],
    ["kept", ThreadId.make("implementation"), "implemented"],
    ["reverted", ThreadId.make("implementation"), "not_implemented"],
  ] as const)("classifies %s with thread %s as %s", (status, implementationThreadId, expected) => {
    const recommendation = { status, implementationThreadId, deferredUntil: null };
    expect(insightImplementationStatus(recommendation)).toBe(expected);
    for (const filter of ["not_implemented", "started", "implemented"]) {
      expect(matchesInsightFilter(recommendation, `implementation:${filter}`, 0)).toBe(
        filter === expected,
      );
    }
  });

  it("keeps decision filters separate from implementation filters, including expired deferrals", () => {
    const recommendation = {
      status: "deferred" as InsightStatus,
      implementationThreadId: ThreadId.make("previous-implementation"),
      deferredUntil: "2026-10-30T09:00:00Z",
    };
    expect(matchesInsightFilter(recommendation, "active", Date.parse("2026-10-30T08:00:00Z"))).toBe(
      false,
    );
    expect(matchesInsightFilter(recommendation, "active", Date.parse("2026-10-30T09:00:00Z"))).toBe(
      true,
    );
    expect(matchesInsightFilter(recommendation, "deferred", 0)).toBe(true);
    expect(matchesInsightFilter(recommendation, "all", 0)).toBe(true);
    expect(matchesInsightFilter(recommendation, "implementation:started", 0)).toBe(false);
  });

  it("counts only assessments made since the current trial began", () => {
    const assessment = (createdAt: string) => ({
      reportId: createdAt,
      createdAt,
      outcome: "improved" as const,
      explanation: "Fewer retries.",
      evidence: [],
    });
    const trial = insightTrial({
      status: "implemented",
      validation: "Fewer retries, same coverage.",
      history: [
        { at: "2026-11-01T00:00:00.000Z", status: "implemented", note: "" },
        { at: "2026-11-02T00:00:00.000Z", status: "accepted", note: "Revise" },
        { at: "2026-11-03T00:00:00.000Z", status: "implemented", note: "" },
        { at: "2026-11-03T01:00:00.000Z", status: "implemented", note: "Added the PR link" },
      ],
      assessments: [assessment("2026-11-01T12:00:00.000Z"), assessment("2026-11-04T00:00:00.000Z")],
    });
    expect(trial?.startedAt).toBe("2026-11-03T00:00:00.000Z");
    expect(trial?.assessments.map((entry) => entry.createdAt)).toEqual([
      "2026-11-04T00:00:00.000Z",
    ]);
    expect(
      insightTrial({ status: "kept", validation: "", history: [], assessments: [] }),
    ).toBeNull();
  });

  it.each([
    ["https://github.com/acme/app/pull/42", "https://github.com/acme/app/pull/42"],
    ["http://localhost:3000/changes/42", "http://localhost:3000/changes/42"],
    ["abc1234", null],
    ["javascript:alert(1)", null],
    ["file:///workspace/changes", null],
    ["https://", null],
    [null, null],
  ])("only links web change references: %s", (reference, expected) => {
    expect(insightImplementationUrl(reference)).toBe(expected);
  });
});

describe("linked projects", () => {
  const studio = EnvironmentId.make("studio");
  const settings: InsightsSettings = {
    enabled: true,
    projectId: ProjectId.make("app"),
    projectIds: [],
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
    timeOfDay: "09:00",
    lookbackDays: 30,
    maxRuns: 60,
  };

  it("adds and removes linked projects, dropping an environment once nothing is selected", () => {
    const app2 = setLinkedInsightsProject(settings, studio, ProjectId.make("app2"), true);
    const both = setLinkedInsightsProject(app2, studio, ProjectId.make("app3"), true);
    expect(both.linkedProjects).toEqual([{ environmentId: studio, projectIds: ["app2", "app3"] }]);
    const app3 = setLinkedInsightsProject(both, studio, ProjectId.make("app2"), false);
    expect(app3.linkedProjects).toEqual([{ environmentId: studio, projectIds: ["app3"] }]);
    expect(setLinkedInsightsProject(app3, studio, ProjectId.make("app3"), false)).toEqual(settings);
    expect(setLinkedInsightsProject(both, studio, null, false)).toEqual(settings);
  });

  it("keeps an environment that is no longer linked visible so its selection can be removed", () => {
    const gone = EnvironmentId.make("gone");
    const selected = setLinkedInsightsProject(settings, gone, ProjectId.make("old"), true);
    expect(insightsLinkedEnvironments(selected, new Map([[studio, "Mac Studio"]]))).toEqual([
      { environmentId: studio, label: "Mac Studio", linked: true },
      { environmentId: gone, label: "gone", linked: false },
    ]);
  });
});

describe("reviewed threads", () => {
  it("lists each sampled thread once per environment, newest first, with the findings citing it", () => {
    const evidence = (
      id: string,
      threadId: string,
      kind: "run" | "message",
      occurredAt: string,
      environmentId?: EnvironmentId,
    ) => ({
      id,
      threadId: ThreadId.make(threadId),
      runId: null,
      itemId: null,
      projectId: ProjectId.make("app"),
      occurredAt,
      title: threadId,
      kind,
      text: "",
      ...(environmentId ? { environmentId } : {}),
    });
    const studio = EnvironmentId.make("studio");
    const threads = reviewedInsightThreads(
      {
        evidence: [
          evidence("run:1", "work", "run", "2026-11-01T08:00:00.000Z"),
          evidence("item:1", "work", "message", "2026-11-01T09:00:00.000Z"),
          evidence("run:2", "work", "run", "2026-11-02T08:00:00.000Z"),
          evidence("run:3", "fix", "run", "2026-11-01T10:00:00.000Z"),
          evidence("studio/run:3", "fix", "run", "2026-10-30T10:00:00.000Z", studio),
        ],
        wins: [{ text: "Tests first", evidenceIds: ["item:1"] }],
      },
      [{ evidenceIds: ["run:2", "run:3"] }, { evidenceIds: ["other"] }],
    );
    expect(
      threads.map((t) => [t.environmentId, t.threadId, t.runs, t.lastActivityAt, t.citedBy]),
    ).toEqual([
      [null, "work", 2, "2026-11-02T08:00:00.000Z", 2],
      [null, "fix", 1, "2026-11-01T10:00:00.000Z", 1],
      [studio, "fix", 1, "2026-10-30T10:00:00.000Z", 0],
    ]);
    const task = {
      rootThreadId: ThreadId.make("work"),
      projectId: ProjectId.make("app"),
      title: "Ship the fix",
      threadIds: [ThreadId.make("work"), ThreadId.make("child")],
      runs: 3,
      followUps: 1,
      interrupts: 0,
      agentQuestions: 0,
      failedTools: 0,
      harmlessFailures: 0,
      frictionKeys: [],
      firstActivityAt: "2026-11-01T08:00:00.000Z",
      lastActivityAt: "2026-11-03T08:00:00.000Z",
      latestRunStatus: "completed",
      pullRequest: "merged" as const,
    };
    const grouped = reviewedInsightThreads(
      {
        evidence: [
          evidence("run:1", "work", "run", "2026-11-01T08:00:00.000Z"),
          evidence("run:4", "child", "run", "2026-11-03T08:00:00.000Z"),
        ],
        wins: [],
        tasks: [task],
      },
      [{ evidenceIds: ["run:4"] }],
    );
    expect(grouped.map((t) => [t.threadId, t.title, t.runs, t.citedBy, t.task])).toEqual([
      ["work", "Ship the fix", 3, 1, task],
    ]);
  });
});

describe("recurring friction", () => {
  it("keeps failures that recur across or within tasks and have an error to act on", () => {
    const cluster = (key: string, overrides: object) => ({
      key,
      family: "sed",
      exitCode: 1,
      signature: "No such file",
      harmless: false,
      failures: 2,
      tasks: 2,
      maxPerTask: 1,
      evidenceIds: [],
      ...overrides,
    });
    const friction = recurringInsightFriction(
      {
        evidence: [],
        friction: [
          cluster("across", {}),
          cluster("within", { tasks: 1, maxPerTask: 2, evidenceIds: ["item:x"] }),
          cluster("once", { failures: 1, tasks: 1 }),
          cluster("harmless", { harmless: true }),
          cluster("silent", { signature: "(no error output)" }),
        ],
      },
      [{ id: "rec", title: "Quote separators", evidenceIds: ["item:x"] }],
    );
    expect(friction.map((entry) => [entry.key, entry.recommendation?.title ?? null])).toEqual([
      ["across", null],
      ["within", "Quote separators"],
    ]);
  });
});

describe("exact changes", () => {
  it("frames what an edit changes with the lines both texts share, and waits for the full record", () => {
    const edit = {
      file: "/repo/skills/deploy/SKILL.md",
      find: "## Deploy\nRun the tests.\nShip it.\n",
      replace: "## Deploy\nRun the tests.\nCheck the deployed version.\nShip it.\n",
    };
    const created = { file: "/repo/CHECKS.md", find: "", replace: "# Checks\n" };
    expect(insightChange({ edits: [] }, { edits: [edit, created] })).toEqual([
      {
        file: edit.file,
        created: false,
        rows: [
          { kind: "context", text: "## Deploy" },
          { kind: "context", text: "Run the tests." },
          { kind: "add", text: "Check the deployed version." },
          { kind: "context", text: "Ship it." },
        ],
      },
      { file: created.file, created: true, rows: [{ kind: "add", text: "# Checks" }] },
    ]);
    expect(
      insightChange({ edits: [] }, { edits: [{ ...edit, find: "a\nb\na", replace: "a" }] }),
    ).toMatchObject([
      {
        rows: [
          { kind: "context", text: "a" },
          { kind: "remove", text: "b" },
          { kind: "remove", text: "a" },
        ],
      },
    ]);
    // The list's copy has its edit text stripped; one from before exact changes has none at all.
    expect(insightChange({ edits: [] }, undefined)).toBe("loading");
    expect(insightChange({}, undefined)).toBeNull();
    expect(insightChange({ edits: [] }, { edits: [] })).toBeNull();
  });
});
