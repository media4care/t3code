import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveGitExplorerSearch,
  resolveNewThreadModelSelectionOverride,
} from "./chatThreadActions";

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

describe("chatThreadActions", () => {
  it("opens the selected chat's repository and worktree in its own environment", () => {
    const activeThread = {
      environmentId: EnvironmentId.make("remote"),
      projectId: ProjectId.make("selected-project"),
      worktreePath: "/worktrees/selected-chat",
    };
    expect(resolveGitExplorerSearch({ activeThread, activeDraftThread: null })).toEqual(
      activeThread,
    );
  });

  it("follows draft chats and drops the previous worktree when switching to a local chat", () => {
    const project = {
      environmentId: EnvironmentId.make("local"),
      projectId: ProjectId.make("another-project"),
    };
    const activeDraftThread = { ...project, worktreePath: "/worktrees/draft" };
    expect(resolveGitExplorerSearch({ activeThread: null, activeDraftThread })).toEqual(
      activeDraftThread,
    );
    expect(
      resolveGitExplorerSearch({
        activeThread: { ...project, worktreePath: null },
        activeDraftThread,
      }),
    ).toEqual(project);
    expect(resolveGitExplorerSearch({ activeThread: null, activeDraftThread: null })).toEqual({});
  });

  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });
});
