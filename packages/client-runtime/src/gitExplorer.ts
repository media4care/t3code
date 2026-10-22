import type { GitExplorerRef } from "@t3tools/contracts";

export interface GitGraphLine {
  readonly from: number;
  readonly to: number;
  readonly color: number;
  readonly kind: "through" | "incoming" | "parent";
}

export interface GitGraphRow {
  readonly hash: string;
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
) {
  const lanes = [...initialLanes];
  const rows: GitGraphRow[] = [];
  const vacantLane = () => {
    const vacant = lanes.indexOf(null);
    return vacant === -1 ? lanes.length : vacant;
  };

  for (const commit of commits) {
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
      });
    }

    lanes[column] = null;
    for (const parent of new Set(commit.parents)) {
      let parentColumn = lanes.indexOf(parent);
      if (parentColumn === -1) {
        parentColumn = lanes[column] === null ? column : vacantLane();
        lanes[parentColumn] = parent;
      }
      lines.push({ from: column, to: parentColumn, color: parentColumn, kind: "parent" });
    }

    rows.push({
      hash: commit.hash,
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
