import { InsightsScreen } from "../insights/InsightsScreen";
import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { UsageRouteScreen } from "../usage/UsageRouteScreen";
import { GitRepositoriesScreen } from "../git-explorer/GitExplorerScreen";

export function WorkspaceExtraTab(props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests">;
}) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "gitExplorer" ? (
        <GitRepositoriesScreen workspace />
      ) : props.tab === "insights" ? (
        <InsightsScreen workspace />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
