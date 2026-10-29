import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type GitExplorerOverviewResult } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  allowed: true,
  connected: true,
  runAction: vi.fn(),
  refreshStatus: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.allowed }));
vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
vi.mock("../../state/git-explorer", () => ({
  gitExplorerEnvironment: {
    runAction: Object.assign(state.runAction, { permissionAtom: vi.fn() }),
  },
}));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { refreshStatus: state.refreshStatus } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceEnvironments: () => [
    {
      environmentId: "remote-environment",
      connectionState: state.connected ? "connected" : "disconnected",
    },
  ],
}));
vi.mock("react-native", () => ({ AppState: {} }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("./useActiveGitQuery", () => ({}));

import { useGitExplorerSync } from "./useGitExplorerSync";

function setup() {
  state.allowed = true;
  state.connected = true;
  state.runAction.mockReset().mockResolvedValue(AsyncResult.success({ message: "Done" }));
  state.refreshStatus.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.alert.mockClear();
  const overview: GitExplorerOverviewResult = {
    repositoryPath: "/repo",
    selectedWorktreePath: "/repo-worktree",
    headHash: "a".repeat(40),
    headBranch: "master",
    worktrees: [],
    refs: [
      {
        name: "refs/heads/master",
        shortName: "master",
        kind: "local",
        hash: "a".repeat(40),
        upstream: "refs/remotes/origin/master",
        upstreamMissing: false,
        ahead: 0,
        behind: 1,
      },
    ],
    stashes: [],
    lastFetchAt: null,
    snapshotId: "snapshot",
  };
  const params = {
    environmentId: EnvironmentId.make("remote-environment"),
    projectId: ProjectId.make("draft-project"),
    worktreePath: overview.selectedWorktreePath,
  };
  const refresh = vi.fn();
  return { overview, params, refresh };
}

it.each(["fetch", "pull"] as const)(
  "serializes %s and refreshes the selected worktree even after a failed operation",
  async (action) => {
    const { overview, params, refresh } = setup();
    const result = Promise.withResolvers<ReturnType<typeof AsyncResult.failure>>();
    state.runAction.mockReturnValue(result.promise);
    const sync = useGitExplorerSync(params, overview, refresh);
    const running = sync.execute(action);
    await sync.execute(action);
    expect(state.runAction).toHaveBeenCalledTimes(1);
    expect(state.runAction).toHaveBeenCalledWith({
      environmentId: params.environmentId,
      input: {
        projectId: params.projectId,
        worktreePath: params.worktreePath,
        action,
        expectedHead: overview.headHash,
        expectedBranch: "master",
      },
    });
    result.resolve(AsyncResult.failure(Cause.fail(new Error("Remote failed"))));
    await running;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(state.refreshStatus).toHaveBeenCalledWith({
      environmentId: params.environmentId,
      input: { cwd: params.worktreePath },
    });
    expect(state.alert).toHaveBeenCalledWith(
      action === "fetch" ? "Could not fetch" : "Could not pull",
      "Remote failed",
    );
  },
);

it.each(["denied", "disconnected", "detached", "no-upstream", "missing-upstream"])(
  "blocks pull when %s while allowing fetch without an upstream",
  async (condition) => {
    const { overview, params, refresh } = setup();
    if (condition === "denied") state.allowed = false;
    if (condition === "disconnected") state.connected = false;
    const current = {
      ...overview,
      headBranch: condition === "detached" ? null : overview.headBranch,
      refs: overview.refs.map((ref) => ({
        ...ref,
        upstream: condition === "no-upstream" ? null : ref.upstream,
        upstreamMissing: condition === "missing-upstream",
      })),
    };
    const sync = useGitExplorerSync(params, current, refresh);
    expect(sync.pullUnavailable).not.toBeNull();
    await sync.execute("pull");
    expect(state.runAction).not.toHaveBeenCalled();
    await sync.execute("fetch");
    expect(state.runAction).toHaveBeenCalledTimes(
      condition === "denied" || condition === "disconnected" ? 0 : 1,
    );
  },
);
