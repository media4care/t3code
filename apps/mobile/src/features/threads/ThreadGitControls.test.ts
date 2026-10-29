import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  thread: null as { projectId: string; worktreePath: string | null } | null,
  navigate: vi.fn(),
}));

vi.mock("../../components/ui/Toolbar", () => ({ Toolbar: {} }));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => vi.fn() }));
vi.mock("../../components/ui/nativeHeaderMenu.ios", () => ({ createNativeHeaderMenu: vi.fn() }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/entities", () => ({ useQuietThreadShell: () => state.thread }));

import { useThreadGitMenuDefinition, type ThreadGitMenuProps } from "./ThreadGitControls";
import type { AppBarMenu } from "../../components/ui/AppBar.types";

function action(menu: AppBarMenu, id: string) {
  const item = menu.items.find((item) => item.id === id);
  if (!item || !("onPress" in item)) throw new Error(`Missing menu action: ${id}`);
  return item;
}

it.each([undefined, "/repo-worktree"])(
  "opens Git Explorer for a draft without a saved thread (worktree: %s)",
  (worktreePath) => {
    state.thread = null;
    state.navigate.mockClear();
    const props = {
      environmentId: "remote-environment",
      threadId: "unsaved-thread",
      hasThread: false,
      currentBranch: "master",
      gitStatus: null,
      gitOperationLabel: null,
      gitExplorerTarget: { projectId: "draft-project", worktreePath },
      onPull: vi.fn(),
      onRunAction: vi.fn(),
    } satisfies ThreadGitMenuProps;
    const menu = useThreadGitMenuDefinition(props)!;
    const explorer = action(menu, "git-explorer");
    expect(explorer.disabled).toBe(false);
    explorer.onPress?.();
    expect(state.navigate).toHaveBeenCalledWith("GitExplorer", {
      environmentId: "remote-environment",
      projectId: "draft-project",
      ...(worktreePath ? { worktreePath } : {}),
    });
    expect(action(menu, "git-review").disabled).toBe(true);
    expect(action(menu, "git-more").disabled).toBe(true);
  },
);

it("uses the saved thread's repository when no draft target is provided", () => {
  state.thread = { projectId: "saved-project", worktreePath: "/saved-worktree" };
  state.navigate.mockClear();
  const menu = useThreadGitMenuDefinition({
    environmentId: "saved-environment",
    threadId: "saved-thread",
    currentBranch: "feature",
    gitStatus: null,
    gitOperationLabel: null,
    onPull: vi.fn(),
    onRunAction: vi.fn(),
  })!;
  const explorer = action(menu, "git-explorer");
  expect(explorer.disabled).toBe(false);
  explorer.onPress?.();
  expect(state.navigate).toHaveBeenCalledWith("GitExplorer", {
    environmentId: "saved-environment",
    projectId: "saved-project",
    worktreePath: "/saved-worktree",
  });
});
