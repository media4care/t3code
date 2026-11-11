import { useAtomValue } from "@effect/atom-react";
import { releaseRejectionsAtom } from "@t3tools/client-runtime/releases";

import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";

export const rejectedReleaseProjectsAtom = releaseRejectionsAtom(
  connectedEnvironmentIdsAtom,
  serverEnvironment.releaseRejections,
);

/** iOS badges carry text; react-native-screens drops an empty value. */
export const RELEASES_REJECTED_BADGE = "!";

export function useReleasesRejected() {
  return useAtomValue(rejectedReleaseProjectsAtom).length > 0;
}

/** The shown tab that leads to Releases: its own, or Settings, which lists the overflow tabs. */
export function releasesBadgeTab(
  shown: readonly string[],
  enabled: readonly string[],
): "releases" | "settings" | null {
  if (shown.includes("releases")) return "releases";
  return enabled.includes("releases") ? "settings" : null;
}

const BADGED_TABS = { releases: ["releases"], settings: ["settings"] } as const;
const NO_BADGED_TABS: readonly string[] = [];

/** A stable list for native views that take the badged tabs as a prop. */
export function badgedTabs(tab: "releases" | "settings" | null): readonly string[] {
  return tab ? BADGED_TABS[tab] : NO_BADGED_TABS;
}

export function rejectedTabLabel(label: string) {
  return `${label}, review rejected`;
}
