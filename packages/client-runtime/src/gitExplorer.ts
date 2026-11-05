import type {
  GitExplorerRef,
  GitExplorerBranchStatus,
  GitExplorerSubmodule,
} from "@t3tools/contracts";

export interface GitGraphLine {
  readonly from: number;
  readonly to: number;
  readonly color: number;
  readonly kind: "through" | "incoming" | "parent";
  readonly emphasized?: boolean;
}

export interface GitGraphRow {
  readonly hash: string;
  readonly color: number;
  readonly emphasized?: boolean;
  readonly column: number;
  readonly laneCount: number;
  readonly lines: ReadonlyArray<GitGraphLine>;
}

interface GitGraphLane {
  readonly hash: string;
  readonly color: number;
  readonly priority: number;
  readonly emphasized: boolean;
}

// Separate incoming lanes meet at their ancestor's node, preserving the oldest first-parent lane.
// Pass continuation when paging to retain lane ownership, colors, and emphasis.
export function layoutGitGraph(
  commits: ReadonlyArray<{ readonly hash: string; readonly parents: ReadonlyArray<string> }>,
  initialLanes: ReadonlyArray<string | GitGraphLane | null> = [],
  emphasizedTips: ReadonlySet<string> = new Set(),
  tipColors?: ReadonlyMap<string, number>,
) {
  const lanes = initialLanes.map((lane, column) =>
    typeof lane === "string"
      ? {
          hash: lane,
          color: tipColors?.get(lane) ?? column,
          priority: column,
          emphasized: emphasizedTips.has(lane),
        }
      : lane,
  );
  let nextPriority = lanes.reduce(
    (priority, lane) => Math.max(priority, (lane?.priority ?? -1) + 1),
    0,
  );
  const rows: GitGraphRow[] = [];
  const vacantLane = () => {
    const vacant = lanes.indexOf(null);
    return vacant === -1 ? lanes.length : vacant;
  };

  for (const commit of commits) {
    const incomingColumn = lanes.reduce((best, lane, column) => {
      if (lane?.hash !== commit.hash) return best;
      const current = lanes[best];
      return !current ||
        (lane.emphasized && !current.emphasized) ||
        (lane.emphasized === current.emphasized && lane.priority < current.priority)
        ? column
        : best;
    }, -1);
    const incoming = lanes[incomingColumn];
    const emphasized = emphasizedTips.has(commit.hash) || incoming?.emphasized === true;
    const column = incomingColumn === -1 ? vacantLane() : incomingColumn;
    const color = tipColors?.get(commit.hash) ?? incoming?.color ?? column;
    const priority = incoming?.priority ?? nextPriority++;
    const lines: GitGraphLine[] = [];
    const incomingWidth = lanes.length;

    for (let lane = 0; lane < lanes.length; lane++) {
      const pending = lanes[lane];
      if (!pending) continue;
      const joins = pending.hash === commit.hash;
      lines.push({
        from: lane,
        to: joins ? column : lane,
        color: pending.color,
        kind: joins ? "incoming" : "through",
        ...(pending.emphasized ? { emphasized: true } : {}),
      });
      if (joins) lanes[lane] = null;
    }

    lanes[column] = null;
    for (const parent of new Set(commit.parents)) {
      const firstParent = parent === commit.parents[0];
      const parentColumn = firstParent ? column : vacantLane();
      const parentColor = firstParent ? color : (tipColors?.get(parent) ?? parentColumn);
      const emphasizedParent = emphasized && firstParent;
      lanes[parentColumn] = {
        hash: parent,
        color: parentColor,
        priority: firstParent ? priority : nextPriority++,
        emphasized: emphasizedParent,
      };
      lines.push({
        from: column,
        to: parentColumn,
        color: parentColor,
        kind: "parent",
        ...(emphasizedParent ? { emphasized: true } : {}),
      });
    }

    rows.push({
      hash: commit.hash,
      color,
      ...(emphasized ? { emphasized: true } : {}),
      column,
      laneCount: Math.max(incomingWidth, lanes.length, column + 1),
      lines,
    });
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop();
  }

  return { rows, lanes: lanes.map((lane) => lane?.hash ?? null), continuation: lanes };
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

export function describeGitExplorerSubmodule(
  submodule: Pick<GitExplorerSubmodule, "state" | "headHash" | "recordedHash">,
): string {
  const short = (hash: string | null) => hash?.slice(0, 7) ?? "unknown";
  switch (submodule.state) {
    case "in-sync":
      return `Checked out at the recorded commit ${short(submodule.headHash)}`;
    case "out-of-sync":
      return `Checked out ${short(submodule.headHash)}; this worktree records ${short(submodule.recordedHash)}`;
    case "uninitialized":
      return "Not initialized. Run git submodule update --init to check it out.";
    case "conflicted":
      return "The recorded submodule commit has a merge conflict";
  }
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

export const gitExplorerResetModes = [
  { value: "soft", label: "Soft", description: "Keep staged changes and working files." },
  { value: "mixed", label: "Mixed", description: "Keep working files and unstage all changes." },
  {
    value: "hard",
    label: "Hard",
    description:
      "Discard staged and tracked working changes. Untracked files obstructing tracked paths may also be deleted.",
  },
] as const;
