import { createGitExplorerEnvironmentAtoms } from "@t3tools/client-runtime/state/git-explorer";

import { connectionAtomRuntime } from "../connection/runtime";

export const gitExplorerEnvironment = createGitExplorerEnvironmentAtoms(connectionAtomRuntime);
