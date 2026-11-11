import { QaScreen } from "../../qa/QaScreen";
import { ReleasesScreen } from "../../releases/ReleasesScreen";
import { InsightsScreen } from "../../insights/InsightsScreen";
import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { GitRepositoriesScreen } from "../../git-explorer/GitExplorerScreen";

export function WorkspaceExtraTab(props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests">;
}) {
  return (
    <>
      {/* Header items outlive the screen that set them, such as Settings' scope filter. */}
      <NativeStackScreenOptions
        optionsVersion={props.tab}
        options={{ headerSearchBarOptions: undefined, unstable_headerRightItems: () => [] }}
      />
      {props.tab === "gitExplorer" ? (
        <GitRepositoriesScreen workspace />
      ) : props.tab === "qa" ? (
        <QaScreen />
      ) : props.tab === "releases" ? (
        <ReleasesScreen />
      ) : props.tab === "insights" ? (
        <InsightsScreen workspace />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
