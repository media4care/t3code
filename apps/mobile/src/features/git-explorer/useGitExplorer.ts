import { RegistryContext } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { EnvironmentId, ProjectId, type GitExplorerHistoryResult } from "@t3tools/contracts";
import { useCallback, useContext, useMemo, useState } from "react";
import { AppState } from "react-native";

import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useActiveGitQuery, useGitExplorerActive } from "./useActiveGitQuery";

export type GitExplorerParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly worktreePath?: string;
};

interface HistoryPage {
  readonly cursor: number;
  readonly result: GitExplorerHistoryResult;
}
const EMPTY_PAGES: readonly HistoryPage[] = [];

export function gitExplorerTarget(params: GitExplorerParams) {
  return {
    environmentId: EnvironmentId.make(params.environmentId),
    input: {
      projectId: ProjectId.make(params.projectId),
      ...(params.worktreePath ? { worktreePath: params.worktreePath } : {}),
    },
  };
}

export function useGitExplorer(params: GitExplorerParams) {
  const target = gitExplorerTarget(params);
  const active = useGitExplorerActive();
  const overviewAtom = gitExplorerEnvironment.overview(target);
  const overview = useActiveGitQuery(overviewAtom, active);
  const registry = useContext(RegistryContext);
  const snapshotId = overview.data?.snapshotId;
  const scope = JSON.stringify([target, snapshotId]);
  const [pagination, setPagination] = useState({ scope, cursor: 0, pages: EMPTY_PAGES });
  const cursor = pagination.scope === scope ? pagination.cursor : 0;
  const historyAtom = snapshotId
    ? gitExplorerEnvironment.history({
        ...target,
        input: { ...target.input, snapshotId, cursor, limit: 100 },
      })
    : null;
  const history = useActiveGitQuery(historyAtom, active);
  const pages = useMemo(() => {
    const loaded = pagination.scope === scope ? pagination.pages : EMPTY_PAGES;
    if (!history.data || loaded.find((page) => page.cursor === cursor)?.result === history.data)
      return loaded;
    return [...loaded.filter((page) => page.cursor < cursor), { cursor, result: history.data }];
  }, [scope, pagination, cursor, history.data]);
  if (pagination.scope !== scope || pagination.pages !== pages)
    setPagination({ scope, cursor, pages });
  const commits = useMemo(() => pages.flatMap((page) => page.result.commits), [pages]);
  const nextCursor = pages.at(-1)?.result.nextCursor ?? null;
  const canLoadMore = nextCursor !== null && nextCursor !== cursor && !history.isPending;
  const loadMore = () => {
    if (canLoadMore) setPagination({ scope, cursor: nextCursor, pages });
  };
  const { environmentId, projectId, worktreePath } = params;
  const refreshRepository = useCallback(() => {
    gitExplorerEnvironment.refresh(
      registry,
      gitExplorerTarget({ environmentId, projectId, worktreePath }),
    );
  }, [registry, environmentId, projectId, worktreePath]);
  const refresh = () => {
    refreshRepository();
    if (historyAtom) registry.refresh(historyAtom);
  };
  useFocusEffect(
    useCallback(() => {
      refreshRepository();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") refreshRepository();
      });
      return () => listener.remove();
    }, [refreshRepository]),
  );

  return { overview, history, commits, canLoadMore, loadMore, refresh, active };
}
