import {
  EnvironmentId,
  ProjectId,
  type GitExplorerOverviewResult,
  type GitExplorerRunActionInput,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { GitExplorerTagAction } from "./GitExplorerTagAction";

const fixture = vi.hoisted(() => ({
  execute: vi.fn<(input: Partial<GitExplorerRunActionInput>) => Promise<boolean>>(),
  allowed: true,
}));
vi.mock("./useGitExplorerAction", () => ({
  useGitExplorerAction: () => ({
    execute: fixture.execute,
    pending: false,
    allowed: fixture.allowed,
    failureMessage: null,
  }),
}));

function setup() {
  fixture.execute.mockReset();
  fixture.allowed = true;
  const overview: GitExplorerOverviewResult = {
    snapshotId: "tags",
    repositoryPath: "/repo",
    selectedWorktreePath: "/repo",
    headBranch: "main",
    headHash: "a".repeat(40),
    refs: [],
    worktrees: [],
    stashes: [],
    lastFetchAt: null,
    remotes: ["origin", "publish"],
  };
  return {
    overview,
    environmentId: EnvironmentId.make("tags"),
    input: { projectId: ProjectId.make("tags") },
    refresh: () => {},
    onBusyChange: () => {},
  };
}

it("keeps a created tag after a rejected push and retries without creating it again", async () => {
  const props = setup();
  await page.viewport(1200, 800);
  fixture.execute
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const onClose = vi.fn();
  await using screen = await render(
    <GitExplorerTagAction {...props} action="create" revision={"b".repeat(40)} onClose={onClose} />,
  );
  await screen.getByRole("textbox", { name: "Tag name", exact: true }).fill("v1.2");
  await screen.getByRole("checkbox", { name: "Push tag to remote" }).click();
  await screen.getByRole("button", { name: "Add and push tag", exact: true }).click();
  await expect.element(screen.getByRole("status")).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Push tag", exact: true }).click();
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(fixture.execute.mock.calls.map(([input]) => input.action)).toEqual([
    "create-tag",
    "push-tag",
    "push-tag",
  ]);
  expect(fixture.execute.mock.calls[2]?.[0]).toMatchObject({
    tagName: "v1.2",
    revision: "b".repeat(40),
    remote: "origin",
  });
});

it("offers local creation without a remote and disables mutations without permission", async () => {
  const props = setup();
  fixture.allowed = false;
  const local = { ...props.overview, remotes: [] };
  const dialog = () => (
    <GitExplorerTagAction
      {...props}
      overview={local}
      action="create"
      revision={props.overview.headHash!}
      onClose={() => {}}
    />
  );
  await using screen = await render(dialog());
  await screen.getByRole("textbox", { name: "Tag name", exact: true }).fill("local-release");
  await expect.element(screen.getByRole("button", { name: "Add tag", exact: true })).toBeDisabled();
  await expect.element(screen.getByRole("checkbox", { name: "Push tag to remote" })).toBeDisabled();
  fixture.allowed = true;
  fixture.execute.mockResolvedValue(true);
  await screen.rerender(dialog());
  await expect.element(screen.getByRole("button", { name: "Add tag", exact: true })).toBeEnabled();
  await screen.getByRole("button", { name: "Add tag", exact: true }).click();
  await vi.waitFor(() => expect(fixture.execute).toHaveBeenCalledTimes(1));
  expect(fixture.execute.mock.calls[0]?.[0].action).toBe("create-tag");
});
