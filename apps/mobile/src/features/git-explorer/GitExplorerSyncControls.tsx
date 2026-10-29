import type { GitExplorerOverviewResult } from "@t3tools/contracts";
import { View } from "react-native";

import { Button } from "../../components/ui/Button";
import type { GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerSync } from "./useGitExplorerSync";

export function GitExplorerSyncControls(props: {
  readonly params: GitExplorerParams;
  readonly overview: GitExplorerOverviewResult;
  readonly onRefresh: () => void;
}) {
  const sync = useGitExplorerSync(props.params, props.overview, props.onRefresh);
  return (
    <View className="flex-row gap-2 pb-2">
      <Button
        label="Fetch"
        icon="arrow.down.circle"
        tone="text"
        accessibilityLabel="Fetch all remotes"
        accessibilityHint={sync.unavailable ?? undefined}
        disabled={sync.unavailable !== null}
        loading={sync.pending === "fetch"}
        onPress={() => void sync.execute("fetch")}
      />
      <Button
        label="Pull"
        icon="arrow.down"
        tone="text"
        accessibilityLabel={`Pull ${props.overview.headBranch ?? "current branch"}`}
        accessibilityHint={sync.pullUnavailable ?? "Pull the current branch (fast-forward only)"}
        disabled={sync.pullUnavailable !== null}
        loading={sync.pending === "pull"}
        onPress={() => void sync.execute("pull")}
      />
    </View>
  );
}
