import {
  EnvironmentId,
  ProjectId,
  type ReleaseBinary,
  type ReleaseStatusDocument,
  type ReleaseTarget,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  releaseApps,
  releaseAttention,
  releasePlatformSummaries,
  releasePresence,
  releaseProjectChoices,
  type ReleaseProjectsState,
  type ReleaseReach,
} from "./releases.ts";

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

const statusDocument = (targets: ReleaseTarget[]): ReleaseStatusDocument => ({
  schemaVersion: 1,
  generatedAt: "2026-11-04T10:00:00.000Z",
  sources: [],
  releases: [{ version: "2.0.0", environment: "prod" }],
  gates: [],
  targets,
  services: [],
});

describe("releaseApps", () => {
  it.each<[string, ReleaseTarget, ReleaseReach]>([
    ["an OTA on a public binary's runtime", target([store()], live()), "users"],
    [
      "an OTA on a runtime only testers have",
      target([store({ label: "TestFlight", audience: "testers" })], live()),
      "testers",
    ],
    [
      "an OTA whose runtime reaches a public draft only",
      target([store({ rollout: { percent: 0, state: "draft" } })], live()),
      "testers",
    ],
    [
      "an OTA on a runtime no build has",
      target([store({ runtime: "old", version: "1.0.0" })], live()),
      "no-one",
    ],
    [
      "an older OTA under a newer store build",
      target([store({ runtime: "next", version: "2.1.0" })], live()),
      "superseded",
    ],
    [
      "an OTA a newer store build replaced, though testers still have its runtime",
      target(
        [
          store({ label: "Play internal", audience: "internal", version: "1.9.0" }),
          store({ version: "2.1.0", runtime: "next" }),
        ],
        live(),
      ),
      "superseded",
    ],
    [
      "an older OTA under a v-prefixed store version",
      target([store({ runtime: "next", version: "v2.1.0" })], live()),
      "superseded",
    ],
    [
      "binaries without a recorded runtime",
      target([store({ runtime: undefined })], live()),
      "unknown",
    ],
    ["no store source", target([], live()), "unknown"],
  ])("judges the reach of %s", (_name, releaseTarget, reach) => {
    expect(releaseApps(statusDocument([releaseTarget]))[0]?.rows[0]?.ota[0]?.reach).toBe(reach);
  });

  it("merges audiences that share binaries and keeps other builds apart", () => {
    const binaries = [
      store({ label: "Play internal", audience: "internal", version: "2.1.0" }),
      store({
        label: "Play production",
        version: "2.1.0",
        rollout: { percent: 0, state: "draft" },
      }),
      store(),
    ];
    const [app] = releaseApps(
      statusDocument([
        {
          ...target(binaries, live()),
          id: "standard",
          detail: "Standard · managed",
          variant: "managed",
        },
        {
          ...target(binaries, { channel: "caregiver", live: { ...live().live, percent: 100 } }),
          id: "caregiver",
          detail: "Caregiver profiles · managed",
          variant: "managed",
        },
        {
          ...target([store({ label: "S3 · in-app" })]),
          id: "inapp",
          detail: "Standard · in-app",
        },
        { ...target([]), id: "unread" },
        { ...target([], live()), id: "unread-standard", detail: "Standard · unread" },
        { ...target([], live()), id: "unread-caregiver", detail: "Caregiver profiles · unread" },
      ]),
    );
    expect(
      app?.rows.map((row) => ({
        detail: row.detail,
        store: row.store?.version,
        testers: row.testers?.label,
        lanes: row.ota.map((lane) => [lane.label, lane.live?.percent]),
      })),
    ).toEqual([
      {
        detail: undefined,
        store: "2.0.0",
        testers: "Play internal",
        lanes: [
          ["Standard", 25],
          ["Caregiver profiles", 100],
        ],
      },
      { detail: "Standard · in-app", store: "2.0.0", testers: undefined, lanes: [] },
      {
        detail: "unread",
        store: undefined,
        testers: undefined,
        lanes: [
          ["Standard", 25],
          ["Caregiver profiles", 25],
        ],
      },
    ]);
  });

  it("nests rows by app, build and variant, iOS first, under the app's store name", () => {
    const build = (id: string, name: string, platform: "ios" | "android", variant?: string) => ({
      ...target([store({ version: id })]),
      id,
      name,
      platform,
      ...(variant ? { variant } : {}),
    });
    const apps = releaseApps(
      {
        ...statusDocument([
          build("only-android", "swOnly", "android", "managed"),
          build("hw-inapp", "swAndHw", "android", "in-app"),
          build("only-ios", "swOnly", "ios", "managed"),
          build("hw-managed", "swAndHw", "android", "managed"),
          { ...build("family", "Store only", "android"), group: "Family" },
        ]),
        groups: [{ id: "B2B", name: "Betreuung Pro", icon: "icons/b2b.png" }],
      },
      { B2B: "data:image/png;base64,AA==" },
    );
    expect(
      apps.map((app) => [
        app.name,
        app.icon,
        app.builds.map((build) => [
          build.name,
          build.variants.map((variant) => [
            variant.name,
            variant.rows.map((row) => row.store?.version),
          ]),
        ]),
      ]),
    ).toEqual([
      [
        "Betreuung Pro",
        "data:image/png;base64,AA==",
        [
          ["swOnly", [["managed", ["only-ios", "only-android"]]]],
          [
            "swAndHw",
            [
              ["in-app", ["hw-inapp"]],
              ["managed", ["hw-managed"]],
            ],
          ],
        ],
      ],
      ["Family", undefined, [["Store only", [[undefined, ["family"]]]]]],
    ]);
  });
});

describe("releasePresence", () => {
  it("counts the rows that carry a version and through which channel", () => {
    const apps = releaseApps(
      statusDocument([
        target([store({ version: "1.0.0", runtime: "old" })], live("old")),
        { ...target([store({ version: "2.0.0" })]), id: "store" },
        { ...target([store({ version: "2.0.0", audience: "testers" })]), id: "testers" },
        { ...target([store({ version: "1.0.0" })]), id: "behind", name: "iOS" },
      ]),
    );
    expect(releasePresence(apps, "2.0.0")).toEqual({
      rows: 3,
      total: 4,
      store: 1,
      testers: 1,
      ota: 1,
    });
  });
});

describe("releasePlatformSummaries", () => {
  it("lists each platform's versions, the most common first", () => {
    const android = (id: string, version: string): ReleaseTarget => ({
      ...target([store({ version })]),
      id,
      name: id,
      platform: "android",
    });
    const summaries = releasePlatformSummaries(
      releaseApps(
        statusDocument([android("a", "1.0.0"), android("b", "2.0.0"), android("c", "2.0.0")]),
      ),
    );
    expect(
      summaries.map((summary) => [summary.platform, summary.store.map((binary) => binary.version)]),
    ).toEqual([["android", ["2.0.0", "1.0.0"]]]);
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
      {
        ...target([store({ label: "TestFlight", audience: "testers" })], {
          channel: "caregiver",
          live: live().live,
        }),
        id: "caregiver",
      },
      { ...target([store()], live()), id: "fine" },
      {
        ...target([store({ version: "0.9.0", runtime: "old" })], {
          channel: "prod",
          live: { version: "1.0.0", runtime: "older", percent: 100 },
        }),
        id: "stale",
        name: "Stale",
      },
      {
        ...target([store({ rollout: { percent: 5, state: "halted" } })]),
        id: "halted",
        name: "iOS",
      },
      {
        ...target([
          store({ label: "App Store · pending release", rollout: { percent: 0, state: "draft" } }),
        ]),
        id: "pending",
        name: "Web",
      },
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

  it("lists the current release's open work once per build, most severe first", () => {
    expect(releaseAttention(document).map((item) => [item.tone, item.title])).toEqual([
      ["error", "OTA update reaches testers only"],
      ["error", "OTA update reaches testers only"],
      ["warning", "Approve 25%"],
      ["warning", "Build uploaded, not promoted"],
      ["warning", "Approve Backend deploy"],
      ["info", "Store rollout halted"],
      ["info", "Store release pending"],
      ["info", "Could not read Google Play"],
    ]);
  });
});

describe("releaseProjectChoices", () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const t3code = { environmentId: local, id: ProjectId.make("t3code") };
  const app = { environmentId: local, id: ProjectId.make("app") };
  const old = { environmentId: remote, id: ProjectId.make("old") };
  const choose = (states: Array<[EnvironmentId, ReleaseProjectsState]>) =>
    releaseProjectChoices([t3code, app, old], new Map(states));

  it("offers configured projects, then those an older server can't judge, and hides the rest", () => {
    expect(choose([[local, [app.id]]])).toEqual({ projects: [app], loading: false });
    expect(
      choose([
        [local, [app.id]],
        [remote, "unknown"],
      ]),
    ).toEqual({
      projects: [app, old],
      loading: false,
    });
    expect(
      choose([
        [local, [app.id]],
        [remote, "loading"],
      ]),
    ).toEqual({
      projects: [app],
      loading: true,
    });
  });

  it("waits while nothing is known, then offers every project when none has a command", () => {
    expect(choose([[local, "loading"]])).toEqual({ projects: [], loading: true });
    expect(
      choose([
        [local, []],
        [remote, []],
      ]),
    ).toEqual({
      projects: [t3code, app, old],
      loading: false,
    });
  });
});
