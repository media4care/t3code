import type {
  EnvironmentId,
  ProjectId,
  ReleaseAudience,
  ReleaseBinary,
  ReleaseGate,
  ReleaseOtaUpdate,
  ReleaseStatusDocument,
  ReleaseTarget,
  ReleaseVersion,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

export type ReleaseTone = "ok" | "info" | "warning" | "error" | "muted";

/**
 * Who a live OTA update reaches, judged by the runtimes binaries report.
 * `superseded` means the public store build is newer than the update.
 */
export type ReleaseReach = "users" | "testers" | "no-one" | "superseded" | "unknown";

export const RELEASE_REACH: Record<
  ReleaseReach,
  { readonly label: string; readonly tone: ReleaseTone }
> = {
  users: { label: "Reaches users", tone: "ok" },
  testers: { label: "Testers only", tone: "error" },
  "no-one": { label: "Reaches no one", tone: "error" },
  superseded: { label: "Store build is newer", tone: "muted" },
  unknown: { label: "Reach unknown", tone: "muted" },
};

export interface ReleaseOtaLane {
  /** The target the lane comes from; merged targets may share a channel. */
  readonly key: string;
  readonly channel: string;
  /** The audience that tells merged targets apart, such as "Caregiver profiles". */
  readonly label: string | undefined;
  readonly live: ReleaseOtaUpdate | undefined;
  readonly reach: ReleaseReach | undefined;
  /** A preview update newer than the live one. */
  readonly preview: ReleaseOtaUpdate | undefined;
}

/** One build on one platform; targets sharing their binaries merge into one row. */
export interface ReleaseAppRow {
  readonly key: string;
  /** The build, such as "swOnly". */
  readonly name: string;
  readonly variant: string | undefined;
  readonly detail: string | undefined;
  readonly platform: ReleaseTarget["platform"];
  readonly binaries: ReadonlyArray<ReleaseBinary>;
  /** What the public installs from the store. */
  readonly store: ReleaseBinary | null;
  readonly testers: ReleaseBinary | null;
  /** A public submission the store is reviewing or has reviewed, which the live store build does not show. */
  readonly review: ReleaseBinary | null;
  readonly ota: ReadonlyArray<ReleaseOtaLane>;
  readonly hasOtaChannel: boolean;
  readonly tone: ReleaseTone;
}

export interface ReleaseBuild {
  readonly key: string;
  readonly name: string;
  /** One entry per variant; a build without variants has one unnamed entry. */
  readonly variants: ReadonlyArray<{
    readonly key: string;
    readonly name: string | undefined;
    readonly rows: ReadonlyArray<ReleaseAppRow>;
  }>;
}

export interface ReleaseApp {
  /** The group id. */
  readonly key: string;
  /** The store name from `groups`, else the group id. */
  readonly name: string;
  /** A data URL. */
  readonly icon: string | undefined;
  readonly builds: ReadonlyArray<ReleaseBuild>;
  /** Every row, in tree order. */
  readonly rows: ReadonlyArray<ReleaseAppRow>;
}

export interface ReleasePlatformSummary {
  readonly platform: NonNullable<ReleaseTarget["platform"]>;
  /** Distinct versions, the most common first, with the first binary seen for each. */
  readonly store: ReadonlyArray<ReleaseBinary>;
  readonly ota: ReadonlyArray<ReleaseOtaUpdate>;
  readonly testers: ReadonlyArray<ReleaseBinary>;
}

export interface ReleasePresence {
  readonly rows: number;
  readonly total: number;
  readonly store: number;
  readonly testers: number;
  readonly ota: number;
}

export interface ReleaseAttention {
  readonly id: string;
  readonly tone: "info" | "warning" | "error";
  readonly title: string;
  readonly detail: string;
  readonly source: string;
  readonly since?: string | undefined;
  readonly url?: string | undefined;
}

const AUDIENCE_RANK: Record<ReleaseAudience, number> = { public: 0, testers: 1, internal: 2 };
const REVIEW_RANK: Record<ReleaseReviewState, number> = {
  rejected: 0,
  "in-review": 1,
  waiting: 2,
  approved: 3,
};
const reviewRank = (binary: ReleaseBinary) =>
  binary.review ? REVIEW_RANK[binary.review.state] : Object.keys(REVIEW_RANK).length;
const TONE_RANK: Record<ReleaseTone, number> = { error: 0, warning: 1, info: 2, muted: 3, ok: 4 };
const PLATFORMS = ["ios", "android", "web"] as const;
const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web" } as const;
const platformRank = (platform: ReleaseTarget["platform"]) =>
  platform ? PLATFORMS.indexOf(platform) : PLATFORMS.length;

/** An environment's projects with a release command; `unknown` when it can't say, such as an older server. */
export type ReleaseProjectsState = ReadonlyArray<ProjectId> | "loading" | "unknown";

/** Each connected environment's `releases.projects` answer; disconnected ones are absent. */
export function releaseProjectStatesAtom(
  connectedEnvironmentIds: Atom.Atom<ReadonlyArray<EnvironmentId>>,
  releaseProjects: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {};
  }) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ProjectId>, unknown>>,
) {
  return Atom.make(
    (get) =>
      new Map(
        get(connectedEnvironmentIds).map((environmentId) => {
          const result = get(releaseProjects({ environmentId, input: {} }));
          const state: ReleaseProjectsState = AsyncResult.isSuccess(result)
            ? result.value
            : AsyncResult.isFailure(result)
              ? "unknown"
              : "loading";
          return [environmentId, state] as const;
        }),
      ),
  );
}

/**
 * The projects the Releases picker offers: those with a release command, then those of connected
 * environments that can't say. With none known, every project, so the setup hint stays reachable.
 */
export function releaseProjectChoices<
  P extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(projects: ReadonlyArray<P>, states: ReadonlyMap<EnvironmentId, ReleaseProjectsState>) {
  const configured = projects.filter((project) => {
    const known = states.get(project.environmentId);
    return typeof known === "object" && known.includes(project.id);
  });
  const loading = projects.some((project) => states.get(project.environmentId) === "loading");
  if (configured.length === 0) return { projects: loading ? [] : projects, loading } as const;
  return {
    projects: [
      ...configured,
      ...projects.filter((project) => states.get(project.environmentId) === "unknown"),
    ],
    loading,
  } as const;
}

/** The newest version of each environment, in the order the document lists them. */
export function currentReleases(document: ReleaseStatusDocument): ReadonlyArray<ReleaseVersion> {
  const seen = new Set<string>();
  return document.releases.filter((release) => {
    if (seen.has(release.environment)) return false;
    seen.add(release.environment);
    return true;
  });
}

export function defaultReleaseVersion(document: ReleaseStatusDocument): string | null {
  return (
    document.releases.find((release) => release.environment === "prod")?.version ??
    document.releases[0]?.version ??
    null
  );
}

// A submission the store has not approved is not installable, whatever its rollout says.
const installable = (binary: ReleaseBinary) =>
  binary.audience === "public" &&
  binary.rollout?.state !== "draft" &&
  (!binary.review || binary.review.state === "approved");

/** Compares the leading numeric parts of two versions; null when either has none. */
function compareVersions(a: string, b: string): number | null {
  const parts = (version: string) =>
    /^v?(\d+(?:\.\d+)*)/.exec(version)?.[1]?.split(".").map(Number);
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function reachOf(
  binaries: ReadonlyArray<ReleaseBinary>,
  store: ReleaseBinary | null,
  update: ReleaseOtaUpdate,
): ReleaseReach {
  if (binaries.some((binary) => installable(binary) && binary.runtime === update.runtime))
    return "users";
  if (store && (compareVersions(store.version, update.version) ?? 0) > 0) return "superseded";
  if (binaries.some((binary) => binary.runtime === update.runtime)) return "testers";
  if (binaries.some((binary) => binary.runtime)) return "no-one";
  return "unknown";
}

// Older clients ignore `variant`, so commands may repeat it in `detail`; it shows once here.
const segments = (target: ReleaseTarget) =>
  target.detail?.split(" · ").filter((segment) => segment !== target.variant) ?? [];

function appRow(targets: ReadonlyArray<ReleaseTarget>): ReleaseAppRow {
  const first = targets[0]!;
  const binaries = first.binaries;
  const shared = segments(first).filter((segment) =>
    targets.every((target) => segments(target).includes(segment)),
  );
  const store = binaries.find(installable) ?? null;
  const ota = targets.flatMap((target): ReleaseOtaLane[] => {
    const { channel, live, preview } = target.ota ?? {};
    if (!channel || (!live && !preview)) return [];
    const label =
      targets.length > 1
        ? segments(target)
            .filter((segment) => !shared.includes(segment))
            .join(" · ") || undefined
        : undefined;
    return [
      {
        key: target.id,
        channel,
        label,
        live,
        reach: live ? reachOf(binaries, store, live) : undefined,
        preview: preview && preview.version !== live?.version ? preview : undefined,
      },
    ];
  });
  const tones: ReleaseTone[] = ota.map((lane) =>
    lane.reach ? RELEASE_REACH[lane.reach].tone : "muted",
  );
  if (store?.rollout?.state === "paused" || store?.rollout?.state === "halted")
    tones.push("warning");
  if (binaries.some((binary) => binary.review?.state === "rejected")) tones.push("error");
  return {
    key: targets.map((target) => target.id).join("+"),
    name: first.name,
    variant: first.variant,
    detail: shared.join(" · ") || undefined,
    platform: first.platform,
    binaries,
    store,
    testers: binaries.find((binary) => binary.audience !== "public") ?? null,
    review:
      binaries
        .filter((binary) => binary.review && binary.audience === "public" && binary !== store)
        .sort((a, b) => reviewRank(a) - reviewRank(b))[0] ?? null,
    ota,
    hasOtaChannel: targets.some((target) => target.ota),
    tone: tones.sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0] ?? "ok",
  };
}

/**
 * Apps by group, then build, then variant, with a row per platform, iOS first. Targets sharing
 * their binaries share a row, as do targets of one platform whose store was not read.
 */
export function releaseApps(
  document: ReleaseStatusDocument,
  icons: Readonly<Record<string, string>> = {},
): ReadonlyArray<ReleaseApp> {
  const names = new Map(document.groups?.map((group) => [group.id, group.name]));
  // group → build → variant ("" for none) → row key → targets
  const apps = new Map<string, Map<string, Map<string, Map<string, ReleaseTarget[]>>>>();
  for (const target of document.targets) {
    if (target.binaries.length === 0 && !target.ota) continue;
    const builds = apps.get(target.group) ?? new Map();
    const variants = builds.get(target.name) ?? new Map();
    const rows = variants.get(target.variant ?? "") ?? new Map<string, ReleaseTarget[]>();
    const key = JSON.stringify([target.platform, target.binaries]);
    rows.set(key, [...(rows.get(key) ?? []), target]);
    variants.set(target.variant ?? "", rows);
    builds.set(target.name, variants);
    apps.set(target.group, builds);
  }
  return [...apps].map(([group, builds]) => {
    const tree = [...builds].map(([build, variants]) => ({
      key: `${group}/${build}`,
      name: build,
      variants: [...variants].map(([variant, rows]) => ({
        key: `${group}/${build}/${variant}`,
        name: variant || undefined,
        rows: [...rows.values()]
          .map(appRow)
          .sort((a, b) => platformRank(a.platform) - platformRank(b.platform)),
      })),
    }));
    return {
      key: group,
      name: names.get(group) ?? group,
      icon: icons[group],
      builds: tree,
      rows: tree.flatMap((build) => build.variants.flatMap((variant) => variant.rows)),
    };
  });
}

function byFrequency<Item>(items: ReadonlyArray<Item>, version: (item: Item) => string) {
  const counts = new Map<string, { item: Item; count: number }>();
  for (const item of items) {
    const entry = counts.get(version(item));
    if (entry) entry.count++;
    else counts.set(version(item), { item, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).map((entry) => entry.item);
}

/** What each platform's users and testers have right now. */
export function releasePlatformSummaries(
  apps: ReadonlyArray<ReleaseApp>,
): ReadonlyArray<ReleasePlatformSummary> {
  const rows = apps.flatMap((app) => app.rows);
  return PLATFORMS.flatMap((platform) => {
    const own = rows.filter((row) => row.platform === platform);
    if (own.length === 0) return [];
    return [
      {
        platform,
        store: byFrequency(
          own.flatMap((row) => (row.store ? [row.store] : [])),
          (binary) => binary.version,
        ),
        ota: byFrequency(
          own.flatMap((row) => row.ota.flatMap((lane) => (lane.live ? [lane.live] : []))),
          (update) => update.version,
        ),
        testers: byFrequency(
          own.flatMap((row) => (row.testers ? [row.testers] : [])),
          (binary) => binary.version,
        ),
      },
    ];
  });
}

/** How many app rows carry a version, and through which channel. */
export function releasePresence(apps: ReadonlyArray<ReleaseApp>, version: string): ReleasePresence {
  const presence = { rows: 0, total: 0, store: 0, testers: 0, ota: 0 };
  for (const row of apps.flatMap((app) => app.rows)) {
    const store = row.binaries.some((binary) => installable(binary) && binary.version === version);
    const testers = row.binaries.some(
      (binary) => binary.audience !== "public" && binary.version === version,
    );
    const ota = row.ota.some((lane) => lane.live?.version === version);
    presence.total++;
    if (store) presence.store++;
    if (testers) presence.testers++;
    if (ota) presence.ota++;
    if (store || testers || ota) presence.rows++;
  }
  return presence;
}

/** "2.0.0 is not in any app yet." or "2.0.0 is in 3 of 13 builds: OTA 2, store 1." */
export function releasePresenceLabel(version: string, presence: ReleasePresence): string {
  if (presence.rows === 0) return `${version} is not in any app yet.`;
  const channels = (
    [
      ["OTA", presence.ota],
      ["store", presence.store],
      ["testers", presence.testers],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([channel, count]) => `${channel} ${count}`)
    .join(", ");
  return `${version} is in ${presence.rows} of ${presence.total} builds: ${channels}.`;
}

export function releaseGates(
  document: ReleaseStatusDocument,
  version: string,
): ReadonlyArray<ReleaseGate> {
  return document.gates.filter((gate) => gate.version === version);
}

/** Work that waits on a person, newest releases and rejected reviews only, most severe first. */
export function releaseAttention(
  document: ReleaseStatusDocument,
  apps: ReadonlyArray<ReleaseApp> = releaseApps(document),
): ReadonlyArray<ReleaseAttention> {
  const items: ReleaseAttention[] = [];
  const current = new Set(currentReleases(document).map((release) => release.version));
  for (const gate of document.gates) {
    if (!current.has(gate.version)) continue;
    const waiting = gate.steps.find((step) => step.state === "waiting");
    if (waiting)
      items.push({
        id: `gate:${gate.id}`,
        tone: "warning",
        title: `Approve ${waiting.label}`,
        detail: `${gate.name} · ${gate.version}`,
        source: "Pipeline",
        since: waiting.since,
        url: waiting.url ?? gate.url,
      });
    for (const step of gate.steps.filter((candidate) => candidate.state === "failed"))
      items.push({
        id: `gate:${gate.id}:${step.label}`,
        tone: "error",
        title: `${step.label} failed`,
        detail: `${gate.name} · ${gate.version}`,
        source: "Pipeline",
        since: step.since,
        url: step.url ?? gate.url,
      });
  }
  const prod = document.releases.find((release) => release.environment === "prod")?.version;
  for (const app of apps)
    for (const row of app.rows) {
      const name = [app.name, row.name, row.variant, row.platform && PLATFORM_LABEL[row.platform]]
        .filter(Boolean)
        .join(" · ");
      for (const lane of row.ota)
        if (
          lane.live &&
          lane.live.version === prod &&
          (lane.reach === "testers" || lane.reach === "no-one")
        )
          items.push({
            id: `ota:${lane.key}`,
            tone: "error",
            title: `OTA update ${lane.reach === "testers" ? "reaches testers only" : "reaches no one"}`,
            detail: `${name}${lane.label ? ` (${lane.label})` : ""}: ${lane.live.version} live at ${lane.live.percent}% on runtime ${lane.live.runtime}`,
            source: "OTA",
            since: lane.live.publishedAt,
            url: lane.live.url,
          });
      const where = (binary: ReleaseBinary) =>
        `${name} · ${binary.version}${binary.build ? ` (${binary.build})` : ""} on ${binary.label}`;
      const storeItem = (binary: ReleaseBinary, tone: ReleaseAttention["tone"], title: string) =>
        items.push({
          id: `store:${row.key}:${title}`,
          tone,
          title,
          detail: where(binary),
          source: "Stores",
          since: binary.updatedAt,
          url: binary.url,
        });
      for (const binary of row.binaries) {
        const review = binary.review;
        if (review?.state === "rejected")
          items.push({
            id: `review:${row.key}:${binary.label}:${binary.version}`,
            tone: "error",
            title: `${binary.audience === "public" ? "Store" : "Tester"} review rejected`,
            detail: `${where(binary)}${review.message ? `: ${review.message}` : ""}`,
            source: "Stores",
            since: review.since ?? binary.updatedAt,
            url: review.url ?? binary.url,
          });
      }
      const own = row.binaries
        .filter((binary) => binary.version === prod)
        .sort((a, b) => AUDIENCE_RANK[a.audience] - AUDIENCE_RANK[b.audience])[0];
      if (own && own.audience !== "public")
        storeItem(own, "warning", "Build uploaded, not promoted");
      // While the store reviews the build, the store holds it, not the user.
      if (own?.rollout?.state === "draft" && (!own.review || own.review.state === "approved"))
        storeItem(own, "info", "Store release pending");
      const rollout = row.store?.rollout?.state;
      if (row.store && (rollout === "paused" || rollout === "halted"))
        storeItem(row.store, "info", `Store rollout ${rollout}`);
    }
  for (const service of document.services)
    for (const deployment of service.deployments) {
      const pending = deployment.pending;
      if (pending?.state === "waiting" || pending?.state === "failed")
        items.push({
          id: `service:${service.id}:${deployment.environment}`,
          tone: pending.state === "failed" ? "error" : "warning",
          title:
            pending.state === "failed"
              ? `${service.name} deploy failed`
              : `Approve ${service.name} deploy`,
          detail: `${pending.version} to ${deployment.environment}`,
          source: "Pipeline",
          url: pending.url,
        });
    }
  for (const source of document.sources)
    if (source.status === "error")
      items.push({
        id: `source:${source.id}`,
        tone: "info",
        title: `Could not read ${source.name}`,
        detail: source.message ?? "The release command reported an error for this source.",
        source: source.name,
      });
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** A short age such as "<1m", "45m", "6h" or "3d". */
export function releaseAge(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (Number.isNaN(minutes)) return null;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

export const RELEASES_CONFIGURATION_EXAMPLE = `{
  "releases": {
    "command": "yarn --silent release:status --json"
  }
}`;

export interface ReleaseCredential {
  /** The environment variable the release command reads. */
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly sensitive: boolean;
  readonly placeholder?: string;
}

/** What the release status command reads, as the Releases settings offer it. */
export const RELEASE_CREDENTIALS: ReadonlyArray<ReleaseCredential> = [
  {
    name: "CIRCLECI_TOKEN",
    label: "CircleCI token",
    description: "Personal API token. Shows pipelines and the approvals waiting on you.",
    sensitive: true,
  },
  {
    name: "EXPO_TOKEN",
    label: "Expo token",
    description:
      "Access token for OTA updates. Not needed when the project’s machine is signed in to EAS.",
    sensitive: true,
  },
  {
    name: "APP_STORE_CONNECT_KEY_ID",
    label: "App Store Connect key ID",
    description: "ID of the API key under Users and Access → Integrations.",
    sensitive: false,
    placeholder: "ABC123DEFG",
  },
  {
    name: "APP_STORE_CONNECT_ISSUER_ID",
    label: "App Store Connect issuer ID",
    description: "Shown above the API keys list.",
    sensitive: false,
    placeholder: "00000000-0000-0000-0000-000000000000",
  },
  {
    name: "APP_STORE_CONNECT_KEY_FILE",
    label: "App Store Connect key file",
    description: "Full path to the downloaded .p8 key on the project’s machine.",
    sensitive: false,
    placeholder: "/path/to/AuthKey_ABC123DEFG.p8",
  },
  {
    name: "GOOGLE_PLAY_SERVICE_ACCOUNT_FILE",
    label: "Google Play service account",
    description: "Full path to the service account’s JSON key on the project’s machine.",
    sensitive: false,
    placeholder: "/path/to/play-service-account.json",
  },
];
