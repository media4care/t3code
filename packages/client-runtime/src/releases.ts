import type {
  ReleaseAudience,
  ReleaseBinary,
  ReleaseGate,
  ReleaseOtaUpdate,
  ReleaseStatusDocument,
  ReleaseTarget,
  ReleaseVersion,
} from "@t3tools/contracts";

export type ReleaseTone = "ok" | "info" | "warning" | "error" | "muted";

export interface ReleaseCheck {
  readonly tone: ReleaseTone;
  readonly label: string;
}

export interface ReleaseTargetRow {
  readonly target: ReleaseTarget;
  /** The release's binary, or the public one an OTA of this release reaches. */
  readonly binary: ReleaseBinary | null;
  readonly ota: {
    readonly state: "live" | "preview" | "other";
    readonly update: ReleaseOtaUpdate;
  } | null;
  readonly check: ReleaseCheck;
}

export interface ReleaseTargetGroup {
  readonly key: string;
  readonly group: string;
  readonly detail: string | undefined;
  readonly rows: ReadonlyArray<ReleaseTargetRow>;
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
const TONE_RANK: Record<ReleaseTone, number> = { error: 0, warning: 1, info: 2, muted: 3, ok: 4 };

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

const reaches = (binary: ReleaseBinary, runtime: string) =>
  binary.audience === "public" && binary.runtime === runtime && binary.rollout?.state !== "draft";

const target = (row: ReleaseTargetRow) =>
  [row.target.group, row.target.name].filter(Boolean).join(" ");

function checkRow(row: Omit<ReleaseTargetRow, "check">, version: string): ReleaseCheck {
  const checks: ReleaseCheck[] = [];
  const { binaries } = row.target;
  if (row.ota?.state === "live" && row.ota.update.version === version) {
    const runtime = row.ota.update.runtime;
    if (binaries.some((binary) => reaches(binary, runtime)))
      checks.push({ tone: "ok", label: "Runtimes match" });
    else if (binaries.some((binary) => binary.runtime === runtime))
      checks.push({ tone: "error", label: "Reaches testers only" });
    else if (binaries.some((binary) => binary.runtime))
      checks.push({ tone: "error", label: "No build has this runtime" });
    else checks.push({ tone: "muted", label: "Runtime unknown" });
  }
  const binary = row.binary;
  if (binary?.version === version && binary.audience !== "public")
    checks.push({ tone: "warning", label: "Binary not promoted" });
  if (binary?.version === version && binary.rollout?.state === "draft")
    checks.push({ tone: "info", label: "Store release pending" });
  if (binary?.rollout?.state === "paused" || binary?.rollout?.state === "halted")
    checks.push({ tone: "info", label: `Store rollout ${binary.rollout.state}` });
  if (checks.length === 0) {
    if (row.ota?.state === "preview") checks.push({ tone: "muted", label: "Preview only" });
    else if (binary?.version === version) checks.push({ tone: "ok", label: "Released" });
    else checks.push({ tone: "muted", label: "Not in this release" });
  }
  return checks.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0]!;
}

export function releaseTargetRow(releaseTarget: ReleaseTarget, version: string): ReleaseTargetRow {
  const { live, preview } = releaseTarget.ota ?? {};
  const ota =
    live?.version === version
      ? { state: "live" as const, update: live }
      : preview?.version === version
        ? { state: "preview" as const, update: preview }
        : live
          ? { state: "other" as const, update: live }
          : null;
  const own = releaseTarget.binaries
    .filter((binary) => binary.version === version)
    .sort((a, b) => AUDIENCE_RANK[a.audience] - AUDIENCE_RANK[b.audience])[0];
  const reached =
    ota && ota.state !== "other"
      ? releaseTarget.binaries.find((binary) => reaches(binary, ota.update.runtime))
      : undefined;
  const row = { target: releaseTarget, binary: own ?? reached ?? null, ota };
  return { ...row, check: checkRow(row, version) };
}

export function releaseTargetGroups(
  document: ReleaseStatusDocument,
  version: string,
): ReadonlyArray<ReleaseTargetGroup> {
  const groups = new Map<string, ReleaseTargetGroup & { rows: ReleaseTargetRow[] }>();
  for (const releaseTarget of document.targets) {
    if (releaseTarget.binaries.length === 0 && !releaseTarget.ota) continue;
    const key = `${releaseTarget.group}\u0000${releaseTarget.detail ?? ""}`;
    const group = groups.get(key) ?? {
      key,
      group: releaseTarget.group,
      detail: releaseTarget.detail,
      rows: [],
    };
    group.rows.push(releaseTargetRow(releaseTarget, version));
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Which sources fed the document, e.g. "Git, EAS Update · Google Play failed · CircleCI not set up". */
export function releaseSourcesLabel(document: ReleaseStatusDocument): string {
  const named = (status: ReleaseStatusDocument["sources"][number]["status"]) =>
    document.sources
      .filter((source) => source.status === status)
      .map((source) => source.name)
      .join(", ");
  const ok = named("ok");
  const failed = named("error");
  const unconfigured = named("unconfigured");
  return [ok, failed && `${failed} failed`, unconfigured && `${unconfigured} not set up`]
    .filter(Boolean)
    .join(" · ");
}

export function releaseGates(
  document: ReleaseStatusDocument,
  version: string,
): ReadonlyArray<ReleaseGate> {
  return document.gates.filter((gate) => gate.version === version);
}

/** Work that waits on a person, newest releases only, most severe first. */
export function releaseAttention(document: ReleaseStatusDocument): ReadonlyArray<ReleaseAttention> {
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
  if (prod)
    for (const releaseTarget of document.targets) {
      const row = releaseTargetRow(releaseTarget, prod);
      if (row.check.tone !== "error" && row.check.tone !== "warning" && row.check.tone !== "info")
        continue;
      const binary = row.binary;
      const update = row.ota?.update;
      const detail =
        row.check.tone === "error" && update
          ? `${target(row)}: live at ${update.percent}% on runtime ${update.runtime}`
          : binary
            ? `${target(row)} · ${binary.version}${binary.build ? ` (${binary.build})` : ""} on ${binary.label}`
            : target(row);
      items.push({
        id: `target:${releaseTarget.id}`,
        tone: row.check.tone,
        title:
          row.check.label === "Binary not promoted"
            ? "Build uploaded, not promoted"
            : row.check.label,
        detail,
        source: "Stores",
        since: binary?.updatedAt,
        url: binary?.url ?? update?.url,
      });
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
