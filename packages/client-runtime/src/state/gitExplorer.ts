import {
  type EnvironmentId,
  type GitExplorerDetailsInput,
  type GitExplorerOverviewInput,
  type GitExplorerPatchInput,
  WS_METHODS,
} from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import { vcsCommandScheduler } from "./vcsCommandScheduler.ts";

type ExplorerTarget<Input = GitExplorerOverviewInput> = {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
};

export function createGitExplorerEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const revisions = Atom.family((_key: string) => Atom.make(0));
  const refreshTrigger = ({ environmentId, input }: ExplorerTarget) =>
    revisions(JSON.stringify([environmentId, input.projectId, input.worktreePath ?? null]));

  const overview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:overview",
    tag: WS_METHODS.gitExplorerOverview,
    idleTtlMs: 30_000,
    staleTimeMs: 10_000,
    // External Git commands do not all emit T3 events. Only mounted explorers
    // retain this local-disk refresh; it never fetches from a remote.
    refreshIntervalMs: 30_000,
    refreshTrigger,
  });
  const history = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:history",
    tag: WS_METHODS.gitExplorerHistory,
    idleTtlMs: 60_000,
    staleTimeMs: 60_000,
  });
  const commitDetails = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:commit-details",
    tag: WS_METHODS.gitExplorerDetails,
    idleTtlMs: 60_000,
    refreshTrigger,
  });
  const workingDetails = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:working-details",
    tag: WS_METHODS.gitExplorerDetails,
    idleTtlMs: 15_000,
    staleTimeMs: 5_000,
    refreshIntervalMs: 15_000,
    refreshTrigger,
  });
  const commitPatch = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:commit-patch",
    tag: WS_METHODS.gitExplorerPatch,
    idleTtlMs: 30_000,
    refreshTrigger,
  });
  const workingPatch = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-explorer:working-patch",
    tag: WS_METHODS.gitExplorerPatch,
    idleTtlMs: 15_000,
    staleTimeMs: 5_000,
    refreshIntervalMs: 15_000,
    refreshTrigger,
  });

  return {
    overview,
    history,
    branchStatuses: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-explorer:branch-statuses",
      tag: WS_METHODS.gitExplorerBranchStatuses,
      idleTtlMs: 60_000,
      staleTimeMs: 60_000,
      refreshTrigger,
    }),
    readBranchStatuses: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-explorer:read-branch-statuses",
      tag: WS_METHODS.gitExplorerBranchStatuses,
    }),
    runAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-explorer:run-action",
      tag: WS_METHODS.gitExplorerRunAction,
      scheduler: vcsCommandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.projectId]),
      },
    }),
    deleteBranch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-explorer:delete-branch",
      tag: WS_METHODS.gitExplorerDeleteBranch,
      scheduler: vcsCommandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.projectId]),
      },
    }),
    details: (target: ExplorerTarget<GitExplorerDetailsInput>) =>
      (target.input.revision === null ? workingDetails : commitDetails)(target),
    patch: (target: ExplorerTarget<GitExplorerPatchInput>) =>
      (target.input.revision === null ? workingPatch : commitPatch)(target),
    refresh: (registry: AtomRegistry.AtomRegistry, target: ExplorerTarget) => {
      registry.update(refreshTrigger(target), (revision) => revision + 1);
    },
  };
}
