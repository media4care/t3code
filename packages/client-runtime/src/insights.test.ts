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
  insightsLinkedEnvironments,
  setLinkedInsightsProject,
  insightImplementationStatus,
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
