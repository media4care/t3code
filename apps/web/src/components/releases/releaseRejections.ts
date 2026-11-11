import { releaseRejectionsAtom } from "@t3tools/client-runtime/releases";

import { environmentSummaries } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";

export const rejectedReleaseProjectsAtom = releaseRejectionsAtom(
  environmentSummaries.connectedEnvironmentIdsAtom,
  serverEnvironment.releaseRejections,
);
