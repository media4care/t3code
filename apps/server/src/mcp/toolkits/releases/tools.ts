import { OrchestratorMcpFailure, ProjectId, ReleasesSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { Tool, Toolkit } from "effect/ai";
import * as Releases from "../../../releases/ReleasesService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

export const ReleasesToolkit = Toolkit.make(
  Tool.make("t3_releases", {
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      Releases.ReleasesService,
      McpInvocationContext.McpInvocationContext,
      ThreadManagement.ThreadManagementService,
    ],
    description:
      "Read a project's release status: pipeline approval gates, store and OTA rollouts, and deployed services. Read-only. projectId defaults to this thread's project.",
    parameters: Schema.Struct({ projectId: Schema.optional(ProjectId) }),
    // Icons are base64 images; agents gain nothing from them but tokens.
    success: ReleasesSnapshot.mapFields(Struct.omit(["icons"])),
  }).annotate(Tool.Title, "Release status"),
);
