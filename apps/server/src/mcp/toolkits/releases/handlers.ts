import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Releases from "../../../releases/ReleasesService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, resolveProjectId } from "../../threadAccess.ts";
import { ReleasesToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ReleasesToolkit, {
  t3_releases: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const releases = yield* Releases.ReleasesService;
      const projectId = yield* resolveProjectId(yield* loadCaller(), input.projectId);
      const { icons: _icons, ...snapshot } = yield* releases
        .read({ projectId })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return snapshot;
    }),
  ),
});
