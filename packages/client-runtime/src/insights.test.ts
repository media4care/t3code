import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type InsightStatus } from "@t3tools/contracts";
import {
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
