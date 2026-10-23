import {
  EnvironmentId,
  ProjectId,
  type GitExplorerCommit,
  type GitExplorerFile,
  type GitExplorerOverviewResult,
} from "@t3tools/contracts";
import { useState } from "react";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { GitExplorerHistory } from "./GitExplorerHistory";
import { GitExplorerReview } from "./GitExplorerReview";

const fixture = vi.hoisted(() => ({
  commits: [] as GitExplorerCommit[],
  files: [] as GitExplorerFile[],
  history: { commits: [] as GitExplorerCommit[], nextCursor: null },
}));

vi.mock("~/state/git-explorer", () => ({
  gitExplorerEnvironment: {
    history: () => ({ kind: "history" }),
    details: ({ input }: { input: { revision: string } }) => ({
      kind: "details",
      revision: input.revision,
    }),
    patch: () => ({ kind: "patch" }),
  },
}));
vi.mock("./useGitExplorerQuery", () => ({
  useGitExplorerQuery: (query: { kind: string; revision?: string }) => ({
    data:
      query.kind === "history"
        ? fixture.history
        : query.kind === "details"
          ? {
              commit: fixture.commits.find((commit) => commit.hash === query.revision),
              files: fixture.files,
              comparisonParent: null,
              stash: null,
              truncated: false,
            }
          : { patch: "", binary: false, truncated: false },
    error: null,
    isPending: false,
    refresh: () => {},
  }),
}));
vi.mock("~/hooks/useTheme", () => ({
  useRenderedAppearance: () => "light",
  useTheme: () => ({ theme: "light" }),
}));
vi.mock("../diffs/StyledDiffCodeView", () => ({ StyledDiffCodeView: () => null }));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: { setClientSettings: async () => {} },
  }),
}));

const environmentId = EnvironmentId.make("git-navigation");
const input = { projectId: ProjectId.make("git-navigation") };

function setup() {
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffLayout: "stacked" });
  fixture.commits = Array.from({ length: 200 }, (_, index) => ({
    hash: String(index).padStart(40, "0"),
    parents: [],
    subject: `Commit ${index}`,
    authorName: "Author",
    authorEmail: "author@example.com",
    authoredAt: "2026-10-22T00:00:00Z",
    committedAt: "2026-10-22T00:00:00Z",
    upstreamStatus: "unknown",
  }));
  fixture.files = Array.from({ length: 200 }, (_, index) => ({
    path: `file-${index}.ts`,
    oldPath: null,
    stage: "committed",
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
  }));
  fixture.history = { commits: fixture.commits, nextCursor: null };
  const overview: GitExplorerOverviewResult = {
    snapshotId: "navigation",
    repositoryPath: "/repo",
    selectedWorktreePath: "/repo",
    headBranch: "main",
    headHash: fixture.commits[0]!.hash,
    refs: [],
    worktrees: [],
    stashes: [],
    lastFetchAt: null,
  };
  return { overview };
}

function Explorer({ overview }: { overview: GitExplorerOverviewResult }) {
  const [revision, setRevision] = useState<string | null | undefined>();
  return (
    <div className="flex h-160 flex-col">
      <div className="flex h-60 shrink-0 flex-col">
        <GitExplorerHistory
          environmentId={environmentId}
          input={input}
          overview={overview}
          selectedRevision={revision}
          onSelect={setRevision}
          refresh={() => {}}
          refreshRevision={0}
        />
      </div>
      {revision !== undefined ? (
        <GitExplorerReview
          key={revision ?? "working"}
          environmentId={environmentId}
          input={input}
          revision={revision}
          compact={false}
          onBack={() => {}}
        />
      ) : null}
    </div>
  );
}

it("reviews commits with arrow keys and retains keyboard focus across virtualized rows", async () => {
  const { overview } = setup();
  await using screen = await render(<Explorer overview={overview} />);
  await screen.getByText("Commit 0", { exact: true }).click();
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(screen.getByRole("heading", { name: "Commit 1", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{End}");
  await expect
    .element(screen.getByRole("heading", { name: "Commit 199", exact: true }))
    .toBeVisible();
  await expect.element(screen.getByRole("option", { name: /^Commit 199,/ })).toBeVisible();
  await userEvent.keyboard("{ArrowUp}");
  await expect
    .element(screen.getByRole("heading", { name: "Commit 198", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Home}");
  await expect
    .element(screen.getByRole("heading", { name: "Commit 0", exact: true }))
    .toBeVisible();
});

it("changes the reviewed file with arrow keys and can reach files beyond the mounted window", async () => {
  setup();
  await using screen = await render(
    <div className="flex h-80 flex-col">
      <GitExplorerReview
        environmentId={environmentId}
        input={input}
        revision={fixture.commits[0]!.hash}
        compact={false}
        onBack={() => {}}
      />
    </div>,
  );
  await screen.getByText("file-0.ts", { exact: true }).first().click();
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(screen.getByRole("region", { name: "Diff for file-1.ts", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{End}");
  await expect
    .element(screen.getByRole("region", { name: "Diff for file-199.ts", exact: true }))
    .toBeVisible();
  await expect.element(screen.getByRole("option", { name: /file-199.ts/ })).toBeVisible();
  await userEvent.keyboard("{ArrowUp}{ArrowUp}");
  await expect
    .element(screen.getByRole("region", { name: "Diff for file-197.ts", exact: true }))
    .toBeVisible();
});

it("keeps the chosen diff layout when reviewing another file or commit", async () => {
  const { overview } = setup();
  await page.viewport(1280, 800);
  await using screen = await render(<Explorer overview={overview} />);
  await screen.getByText("Commit 0", { exact: true }).click();
  await screen.getByRole("button", { name: "Side-by-side diff", exact: true }).click();
  await screen.getByRole("option", { name: /file-1.ts/ }).click();
  await expect
    .element(screen.getByRole("button", { name: "Side-by-side diff", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.getByText("Commit 1", { exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Side-by-side diff", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});
