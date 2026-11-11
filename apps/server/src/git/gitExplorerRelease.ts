import {
  gitExplorerReleaseBranchVersion,
  type GitExplorerReleaseChannel,
} from "@t3tools/contracts";

/** The newest `vX.Y` branch among `names`. */
export function latestReleaseBranch(names: Iterable<string>) {
  let latest: { name: string; version: readonly [number, number] } | null = null;
  for (const name of names) {
    const version = gitExplorerReleaseBranchVersion(name);
    if (
      version &&
      (!latest ||
        version[0] > latest.version[0] ||
        (version[0] === latest.version[0] && version[1] > latest.version[1]))
    )
      latest = { name, version };
  }
  return latest?.name ?? null;
}

/**
 * The next tag on release branch `vX.Y`: production is the patch after the latest `X.Y.N`,
 * and beta takes that same patch with the next free `-beta`, `-beta1`, … suffix.
 */
export function nextReleaseTag(
  branch: string,
  tags: Iterable<string>,
  channel: GitExplorerReleaseChannel,
) {
  const version = gitExplorerReleaseBranchVersion(branch);
  if (!version) return null;
  const prefix = `${version[0]}.${version[1]}.`;
  let latest = -1;
  const betas = new Map<number, number>();
  for (const tag of tags) {
    const match = tag.startsWith(prefix)
      ? /^(\d+)(?:-beta(\d*))?$/.exec(tag.slice(prefix.length))
      : null;
    if (!match) continue;
    const patch = Number(match[1]);
    if (match[2] === undefined) latest = Math.max(latest, patch);
    else betas.set(patch, Math.max(betas.get(patch) ?? -1, Number(match[2] || 0)));
  }
  const patch = latest + 1;
  const beta = betas.get(patch);
  return {
    tag:
      channel === "production"
        ? `${prefix}${patch}`
        : `${prefix}${patch}-beta${beta === undefined ? "" : beta + 1}`,
    previous: latest < 0 ? null : `${prefix}${latest}`,
  };
}
