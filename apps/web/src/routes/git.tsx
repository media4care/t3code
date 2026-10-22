import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { GitExplorerPage } from "../components/git-explorer/GitExplorerPage";

export interface GitExplorerSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly worktreePath?: string;
}

export const Route = createFileRoute("/git")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (raw: Record<string, unknown>): GitExplorerSearch => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.worktreePath === "string" && raw.worktreePath
      ? { worktreePath: raw.worktreePath }
      : {}),
  }),
  component: GitExplorerPage,
});
