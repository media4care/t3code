import type { GitExplorerRef } from "@t3tools/contracts";

export interface GitGraphLine {
  readonly from: number;
  readonly to: number;
  readonly color: number;
  readonly kind: "through" | "incoming" | "parent";
  readonly emphasized?: boolean;
}

export interface GitGraphRow {
  readonly hash: string;
  readonly emphasized?: boolean;
  readonly column: number;
  readonly laneCount: number;
  readonly lines: ReadonlyArray<GitGraphLine>;
}

/**
 * Each lane carries a parent hash until its row arrives in topological order.
 * Vacated lanes are reused without moving surviving lanes: both row geometry
 * and colors stay stable when another history page is appended.
 */
export function layoutGitGraph(
  commits: ReadonlyArray<{ readonly hash: string; readonly parents: ReadonlyArray<string> }>,
  initialLanes: ReadonlyArray<string | null> = [],
  emphasizedTips: ReadonlySet<string> = new Set(),
) {
  const lanes = [...initialLanes];
  const emphasizedHashes = new Set(emphasizedTips);
  const rows: GitGraphRow[] = [];
  const vacantLane = () => {
    const vacant = lanes.indexOf(null);
    return vacant === -1 ? lanes.length : vacant;
  };

  for (const commit of commits) {
    const emphasized = emphasizedHashes.has(commit.hash);
    const incomingColumn = lanes.indexOf(commit.hash);
    const column = incomingColumn === -1 ? vacantLane() : incomingColumn;
    const lines: GitGraphLine[] = [];
    const incomingWidth = lanes.length;

    for (let lane = 0; lane < lanes.length; lane++) {
      if (lanes[lane] === null) continue;
      lines.push({
        from: lane,
        to: lane,
        color: lane,
        kind: lane === incomingColumn ? "incoming" : "through",
        ...(emphasizedHashes.has(lanes[lane]!) ? { emphasized: true } : {}),
      });
    }

    lanes[column] = null;
    for (const parent of new Set(commit.parents)) {
      let parentColumn = lanes.indexOf(parent);
      if (parentColumn === -1) {
        parentColumn = lanes[column] === null ? column : vacantLane();
        lanes[parentColumn] = parent;
      }
      const emphasizedParent = emphasized && parent === commit.parents[0];
      if (emphasizedParent) emphasizedHashes.add(parent);
      lines.push({
        from: column,
        to: parentColumn,
        color: parentColumn,
        kind: "parent",
        ...(emphasizedParent ? { emphasized: true } : {}),
      });
    }

    rows.push({
      hash: commit.hash,
      ...(emphasized ? { emphasized: true } : {}),
      column,
      laneCount: Math.max(incomingWidth, lanes.length, column + 1),
      lines,
    });
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop();
  }

  return { rows, lanes };
}

export function formatGitExplorerSync(
  ref: Pick<GitExplorerRef, "upstream" | "upstreamMissing" | "ahead" | "behind">,
): string {
  if (ref.upstream === null) return "No upstream";
  if (ref.upstreamMissing) return "Upstream missing";
  if (ref.ahead === null || ref.behind === null) return "Upstream status unavailable";
  if (ref.ahead > 0 && ref.behind > 0) {
    return `${ref.ahead} ahead, ${ref.behind} behind (diverged)`;
  }
  if (ref.ahead > 0) return `${ref.ahead} ahead`;
  if (ref.behind > 0) return `${ref.behind} behind`;
  return "Synchronized";
}

export function gitExplorerEmphasizedRefs(
  refs: readonly Pick<GitExplorerRef, "name" | "shortName" | "kind">[],
) {
  const branches = refs
    .filter((ref) => ref.kind !== "tag")
    .map((ref) => ({
      ref,
      branch:
        ref.kind === "remote" ? ref.shortName.slice(ref.shortName.indexOf("/") + 1) : ref.shortName,
    }));
  const primary = branches.some(({ branch }) => branch === "main") ? "main" : "master";
  const latest = branches
    .map(({ branch }) => branch)
    .filter((name) => /^v\d/.test(name))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))[0];
  return new Set(
    branches
      .filter(({ branch }) => branch === primary || branch === latest)
      .map(({ ref }) => ref.name),
  );
}
