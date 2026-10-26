import type { GitExplorerRef, GitExplorerBranchStatus } from "@t3tools/contracts";

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

function targetName(reference: string) {
  return reference.replace(/^refs\/(heads|remotes)\//, "");
}

const UNKNOWN_REASONS = {
  "missing-base": "No comparison branch is available.",
  shallow: "Shallow history prevents a complete comparison.",
  "merge-commits": "Merge commits prevent a reliable patch-equivalence comparison.",
  limit: "This comparison exceeds the analysis limit.",
  unrelated: "The branches have no common history.",
  "read-failed": "Git could not complete the comparison.",
} as const;

export function describeGitExplorerMerge(status: GitExplorerBranchStatus | undefined) {
  if (!status) return "Merge status not loaded.";
  const target = status.targetRef ? targetName(status.targetRef) : "the comparison branch";
  const comparison =
    status.mergeStatus === "merged"
      ? `Merged into ${target}.`
      : status.mergeStatus === "equivalent"
        ? `Equivalent changes in ${target} (rebased or cherry-picked). The original commits are not ancestors of the comparison branch.`
        : status.mergeStatus === "unmerged"
          ? `Not merged into ${target}. No complete ancestry or patch-equivalence match was found; squashed or edited merges may not be recognized.`
          : `Merge status unknown${status.targetRef ? ` against ${target}` : ""}. ${status.reason ? UNKNOWN_REASONS[status.reason] : "The comparison could not be completed."}`;
  return `${comparison}${status.targetRef?.startsWith("refs/remotes/") ? " Uses the local remote-tracking ref; the remote server has not been checked." : ""}`;
}

export function gitExplorerUpstreamMergeSummary(
  reference: GitExplorerRef,
  status: GitExplorerBranchStatus | undefined,
) {
  if (!reference.upstream)
    return {
      label: "No upstream",
      description: "No tracking branch is configured for this local branch.",
      mergeStatus: null,
    };
  const upstream = targetName(reference.upstream);
  if (reference.upstreamMissing)
    return {
      label: "Missing upstream",
      description: `Upstream ${upstream} is missing from locally fetched refs. This does not establish whether it was merged.`,
      mergeStatus: null,
    };
  if (
    !status?.upstream ||
    status.name !== reference.name ||
    status.hash !== reference.hash ||
    status.upstream.name !== reference.upstream
  )
    return {
      label: "Upstream unknown",
      description: `Merge status for upstream ${upstream} has not been loaded.`,
      mergeStatus: null,
    };
  const labels = {
    merged: "Upstream merged",
    equivalent: "Upstream equivalent",
    unmerged: "Upstream unmerged",
    unknown: "Upstream unknown",
  };
  return {
    label: labels[status.upstream.mergeStatus],
    description: `Upstream ${upstream}: ${describeGitExplorerMerge({ ...status, ...status.upstream })}`,
    mergeStatus: status.upstream.mergeStatus,
  };
}

export function gitExplorerBranchDeletionBlock(
  reference: GitExplorerRef,
  status: GitExplorerBranchStatus | undefined,
  force = false,
) {
  if (reference.kind !== "local") return "Only local branches can be deleted here.";
  if (!status) return "Load the merge status before deleting this branch.";
  if (status.name !== reference.name || status.hash !== reference.hash)
    return "This branch has changed. Refresh Git Explorer before deleting it.";
  switch (status.deleteBlockedReason) {
    case "checked-out":
      return "This branch is checked out in a worktree.";
    case "protected":
      return "The repository's base branch cannot be deleted here.";
    case "unmerged":
      if (!force) return describeGitExplorerMerge(status);
      break;
    case "unknown":
      if (!force) return describeGitExplorerMerge(status);
      break;
  }
  if (force) return null;
  if (status.mergeStatus !== "merged" && status.mergeStatus !== "equivalent")
    return "Only merged or patch-equivalent branches can be deleted here.";
  if (!status.targetRef || !status.targetHash)
    return "A comparison branch is required before deletion.";
  return null;
}

export function prepareGitExplorerBranchDeletion(
  reference: GitExplorerRef,
  status: GitExplorerBranchStatus | undefined,
  force = false,
  environmentLabel?: string,
) {
  if (!status || gitExplorerBranchDeletionBlock(reference, status, force) !== null) return null;
  const equivalent = status.mergeStatus === "equivalent";
  const target = status.targetRef ? targetName(status.targetRef) : "the comparison branch";
  return {
    input: {
      branchName: reference.name,
      expectedHash: reference.hash,
      expectedTargetRef: status.targetRef,
      expectedTargetHash: status.targetHash,
      allowEquivalent: equivalent,
      ...(force ? { force: true } : {}),
    },
    confirmation: [
      `${force ? "Force delete" : "Delete"} branch "${reference.shortName}"?`,
      `Repository location: ${environmentLabel || "the selected environment"}.`,
      force
        ? `${describeGitExplorerMerge(status)} Force deletion can lose commits that are not saved on another branch. This cannot be undone from Git Explorer.`
        : equivalent
          ? `Its changes have equivalent patches in ${target}, but the original commits are not ancestors of that branch. Confirming deletes the local branch using patch equivalence.`
          : `Its commits are already merged into ${target}.`,
      "This removes the branch from the repository on that environment. Branches on Git remotes and worktree files are unchanged.",
      ...(reference.upstream && reference.upstream !== status.targetRef
        ? [gitExplorerUpstreamMergeSummary(reference, status).description]
        : []),
      ...(status.targetRef?.startsWith("refs/remotes/")
        ? [
            "This comparison uses the last known remote-tracking ref. The remote server has not been checked.",
          ]
        : []),
    ].join("\n\n"),
  };
}

export function prepareGitExplorerBranchesDeletion(
  references: readonly GitExplorerRef[],
  statuses: readonly GitExplorerBranchStatus[],
  force = false,
) {
  const byName = new Map(statuses.map((status) => [status.name, status]));
  const eligible: {
    reference: GitExplorerRef;
    deletion: NonNullable<ReturnType<typeof prepareGitExplorerBranchDeletion>>;
  }[] = [];
  const skipped: { reference: GitExplorerRef; reason: string }[] = [];
  for (const reference of new Map(references.map((ref) => [ref.name, ref])).values()) {
    const status = byName.get(reference.name);
    const deletion =
      prepareGitExplorerBranchDeletion(reference, status) ??
      (force ? prepareGitExplorerBranchDeletion(reference, status, true) : null);
    if (deletion) eligible.push({ reference, deletion });
    else skipped.push({ reference, reason: gitExplorerBranchDeletionBlock(reference, status)! });
  }
  return { eligible, skipped };
}
