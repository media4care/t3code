import type { ReleaseBinary, ReleaseStatusDocument, ReleaseTarget } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { releaseAttention, releaseTargetGroups, releaseTargetRow } from "./releases.ts";

const store = (
  overrides: { [Key in keyof ReleaseBinary]?: ReleaseBinary[Key] | undefined } = {},
): ReleaseBinary => {
  const binary: Record<string, unknown> = {
    label: "Play production",
    audience: "public",
    version: "2.0.0",
    runtime: "new",
    rollout: { percent: 50, state: "active" },
    ...overrides,
  };
  for (const key of Object.keys(binary)) if (binary[key] === undefined) delete binary[key];
  return binary as ReleaseBinary;
};
const live = (runtime = "new") => ({
  channel: "prod",
  live: { version: "2.0.0", runtime, percent: 25 },
});
const target = (binaries: ReleaseBinary[], ota?: ReleaseTarget["ota"]): ReleaseTarget => ({
  id: "b2b-android",
  group: "B2B",
  name: "Android",
  binaries,
  ...(ota ? { ota } : {}),
});

describe("releaseTargetRow", () => {
  it.each<[string, ReleaseTarget, string]>([
    ["an OTA on a public binary's runtime", target([store()], live()), "Runtimes match"],
    [
      "an OTA on a runtime only testers have",
      target([store({ label: "TestFlight", audience: "testers" })], live()),
      "Reaches testers only",
    ],
    [
      "an OTA on a runtime no build has",
      target([store({ runtime: "old", version: "1.0.0" })], live()),
      "No build has this runtime",
    ],
    [
      "an OTA whose runtime reaches a public draft only",
      target([store({ rollout: { percent: 0, state: "draft" } })], live()),
      "Reaches testers only",
    ],
    [
      "binaries without a recorded runtime",
      target([store({ runtime: undefined })], live()),
      "Runtime unknown",
    ],
    [
      "a binary left on the internal track",
      target([store({ label: "Play internal", audience: "internal", rollout: undefined })]),
      "Binary not promoted",
    ],
    [
      "an approved store version not released yet",
      target([
        store({ label: "App Store · pending release", rollout: { percent: 0, state: "draft" } }),
      ]),
      "Store release pending",
    ],
    [
      "a halted store rollout",
      target([store({ rollout: { percent: 5, state: "halted" } })]),
      "Store rollout halted",
    ],
    [
      "a JS-only release that reaches an older binary",
      target([store({ version: "1.0.0" })], live()),
      "Runtimes match",
    ],
    [
      "a target this release did not touch",
      target([store({ version: "1.0.0" })]),
      "Not in this release",
    ],
    [
      "an update that is only on preview",
      target([store({ version: "1.0.0", runtime: "old" })], {
        channel: "prod",
        preview: { version: "2.0.0", runtime: "new", percent: 100 },
      }),
      "Preview only",
    ],
  ])("checks %s", (_name, releaseTarget, label) => {
    expect(releaseTargetRow(releaseTarget, "2.0.0").check.label).toBe(label);
  });

  it("shows the public binary an OTA of the release reaches when the release has none", () => {
    const old = store({ version: "1.0.0" });
    expect(releaseTargetRow(target([old], live()), "2.0.0").binary).toBe(old);
  });
});

describe("releaseTargetGroups", () => {
  it("leaves out targets no source reported anything for", () => {
    const document: ReleaseStatusDocument = {
      schemaVersion: 1,
      generatedAt: "2026-11-04T10:00:00.000Z",
      sources: [],
      releases: [{ version: "2.0.0", environment: "prod" }],
      gates: [],
      targets: [target([store()]), { ...target([]), id: "unread", group: "Games" }],
      services: [],
    };
    expect(
      releaseTargetGroups(document, "2.0.0").flatMap((group) =>
        group.rows.map((row) => row.target.id),
      ),
    ).toEqual(["b2b-android"]);
  });
});

describe("releaseAttention", () => {
  const document: ReleaseStatusDocument = {
    schemaVersion: 1,
    generatedAt: "2026-11-04T10:00:00.000Z",
    sources: [{ id: "play", name: "Google Play", status: "error", message: "403" }],
    releases: [
      { version: "2.0.0", environment: "prod" },
      { version: "1.9.0", environment: "prod" },
    ],
    gates: [
      {
        id: "current",
        name: "Managed",
        version: "2.0.0",
        steps: [
          { label: "5%", state: "done" },
          { label: "25%", state: "waiting" },
          { label: "50%", state: "pending" },
        ],
      },
      { id: "old", name: "Managed", version: "1.9.0", steps: [{ label: "5%", state: "waiting" }] },
    ],
    targets: [
      target([store({ label: "TestFlight", audience: "testers" })], live()),
      { ...target([store()], live()), id: "fine" },
    ],
    services: [
      {
        id: "backend",
        name: "Backend",
        deployments: [
          {
            environment: "prod",
            version: "1.9.0",
            state: "deployed",
            pending: { version: "2.0.0", state: "waiting" },
          },
        ],
      },
    ],
  };

  it("lists the current release's open work, most severe first", () => {
    expect(releaseAttention(document).map((item) => [item.tone, item.title])).toEqual([
      ["error", "Reaches testers only"],
      ["warning", "Approve 25%"],
      ["warning", "Approve Backend deploy"],
      ["info", "Could not read Google Play"],
    ]);
  });
});
