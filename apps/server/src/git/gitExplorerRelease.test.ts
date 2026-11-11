import { describe, expect, it } from "@effect/vitest";
import { latestReleaseBranch, nextReleaseTag } from "./gitExplorerRelease.ts";

describe("latestReleaseBranch", () => {
  it("compares versions numerically and ignores other names", () => {
    expect(latestReleaseBranch(["v26.8", "v26.10", "v26.9", "v27", "vendor", "v3.100"])).toBe(
      "v26.10",
    );
    expect(latestReleaseBranch(["master"])).toBeNull();
  });
});

describe("nextReleaseTag", () => {
  const tags = [
    "26.10.0-beta",
    "26.10.0-beta1",
    "26.10.0",
    "26.10.9",
    "26.10.31",
    "26.10.32",
    "26.10.33-beta",
    "26.1.40",
    "26.100.7",
    "cms_v26.10.50",
    "26.10.34-betaX",
  ];
  it.each([
    ["production", tags, "26.10.33", "26.10.32"],
    ["beta", tags, "26.10.33-beta1", "26.10.32"],
    ["beta", tags.slice(0, 6), "26.10.33-beta", "26.10.32"],
    ["beta", ["26.10.0-beta"], "26.10.0-beta1", null],
    ["production", [], "26.10.0", null],
  ] as const)("%s after %j is %s", (channel, existing, tag, previous) => {
    expect(nextReleaseTag("v26.10", existing, channel)).toEqual({ tag, previous });
  });
});
