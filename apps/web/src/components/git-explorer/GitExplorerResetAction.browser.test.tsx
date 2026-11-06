import { EnvironmentId, ProjectId, type GitExplorerOverviewResult } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import "~/index.css";
import { render } from "../../../test/render";
import { GitExplorerResetAction } from "./GitExplorerResetAction";

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  allowed: true,
  failureMessage: null as string | null,
  overview: null as GitExplorerOverviewResult | null,
}));
vi.mock("./useGitExplorerAction", () => ({
  useGitExplorerAction: ({ overview }: { overview: GitExplorerOverviewResult }) => {
    fixture.overview = overview;
    return {
      execute: fixture.execute,
      pending: false,
      allowed: fixture.allowed,
      failureMessage: fixture.failureMessage,
    };
  },
}));

function setup() {
  fixture.execute.mockReset().mockResolvedValue(false);
  fixture.allowed = true;
  fixture.failureMessage = null;
  fixture.overview = null;
  const overview: GitExplorerOverviewResult = {
    snapshotId: "reset",
    repositoryPath: "/repo",
    selectedWorktreePath: "/repo/topic",
    headBranch: "topic",
    headHash: "a".repeat(40),
    refs: [],
    worktrees: [],
    stashes: [],
    lastFetchAt: null,
  };
  return {
    overview,
    environmentId: EnvironmentId.make("reset"),
    input: { projectId: ProjectId.make("reset"), worktreePath: "/repo/topic" },
    revision: "b".repeat(40),
    refresh: () => {},
    onBusyChange: () => {},
    onClose: vi.fn(),
  };
}

it("defaults to mixed, pins the reviewed branch, and requires explicit acknowledgment for hard reset", async () => {
  const props = setup();
  const dialog = (overview = props.overview) => (
    <GitExplorerResetAction {...props} overview={overview} />
  );
  await using screen = await render(dialog());
  expect(fixture.execute).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("radio", { name: /^Mixed/ })).toBeChecked();
  await screen.getByRole("button", { name: "Reset topic", exact: true }).click();
  expect(fixture.execute).toHaveBeenCalledWith({
    action: "reset",
    revision: props.revision,
    resetMode: "mixed",
  });
  fixture.execute.mockClear();
  await screen.rerender(
    dialog({ ...props.overview, headBranch: "another", headHash: "c".repeat(40) }),
  );
  expect(fixture.overview).toEqual(props.overview);
  await screen.getByRole("radio", { name: /^Hard/ }).click();
  const confirm = screen.getByRole("button", { name: "Reset topic", exact: true });
  await expect.element(confirm).toBeDisabled();
  await screen.getByRole("checkbox").click();
  await expect.element(confirm).toBeEnabled();
  await screen.getByRole("radio", { name: /^Soft/ }).click();
  await screen.getByRole("radio", { name: /^Hard/ }).click();
  await expect.element(confirm).toBeDisabled();
  await screen.getByRole("checkbox").click();
  fixture.execute.mockResolvedValueOnce(true);
  await confirm.click();
  await vi.waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  expect(fixture.execute).toHaveBeenCalledWith({
    action: "reset",
    revision: props.revision,
    resetMode: "hard",
  });
});

it("disables reset without write permission or a checked-out branch and preserves errors for review", async () => {
  const props = setup();
  fixture.allowed = false;
  fixture.failureMessage =
    "The worktree branch or HEAD changed. Refresh Git Explorer and try again.";
  const dialog = () => <GitExplorerResetAction {...props} />;
  await using screen = await render(dialog());
  await expect
    .element(screen.getByRole("button", { name: "Reset topic", exact: true }))
    .toBeDisabled();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fixture.failureMessage);
  await screen.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(fixture.execute).not.toHaveBeenCalled();
  fixture.allowed = true;
  await screen.rerender(
    <GitExplorerResetAction
      {...props}
      key="detached"
      overview={{ ...props.overview, headBranch: null }}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Reset current branch", exact: true }))
    .toBeDisabled();
});
