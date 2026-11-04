import {
  ReleaseStatusDocument,
  ReleasesConfiguration,
  ReleasesError,
  RELEASES_DEFAULT_REFRESH_MINUTES,
  type ProjectId,
  type ReleasesProjectInput,
  type ReleasesRefreshInput,
  type ReleasesSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";

const MAX_OUTPUT = 4 * 1024 * 1024;
const ERROR_LIMIT = 2000;
const decodeConfig = Schema.decodeEffect(
  fromLenientJson(Schema.Struct({ releases: Schema.optionalKey(ReleasesConfiguration) })),
);
const decodeDocument = Schema.decodeEffect(Schema.fromJsonString(ReleaseStatusDocument));

interface ProjectState {
  readonly running: boolean;
  readonly lastRun: ReleasesSnapshot["lastRun"];
  readonly document: ReleaseStatusDocument | null;
}
const EMPTY: ProjectState = { running: false, lastRun: null, document: null };

const tail = (text: string) => text.trim().slice(-ERROR_LIMIT);

export class ReleasesService extends Context.Service<
  ReleasesService,
  {
    readonly subscribe: (
      input: ReleasesProjectInput,
    ) => Stream.Stream<ReleasesSnapshot, ReleasesError>;
    readonly refresh: (input: ReleasesRefreshInput) => Effect.Effect<void, ReleasesError>;
  }
>()("t3/releases/ReleasesService") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const processes = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const scope = yield* Effect.scope;
  const updates = yield* PubSub.sliding<ProjectId>(64);
  // Release status is cheap to rebuild and only matters while someone looks at it.
  const states = new Map<ProjectId, ProjectState>();
  const stateOf = (projectId: ProjectId) => states.get(projectId) ?? EMPTY;

  const workspace = Effect.fn("ReleasesService.workspace")(function* (projectId: ProjectId) {
    const project = yield* projects
      .get(projectId)
      .pipe(Effect.mapError((cause) => new ReleasesError({ reason: "workspace", cause })));
    if (Option.isNone(project) || project.value.deletedAt !== null)
      return yield* new ReleasesError({ reason: "project-not-found" });
    return yield* fs
      .realPath(project.value.workspaceRoot)
      .pipe(Effect.mapError((cause) => new ReleasesError({ reason: "workspace", cause })));
  });

  const configuration = Effect.fn("ReleasesService.configuration")(function* (root: string) {
    const contents = yield* fs.readFileString(path.join(root, "t3.json")).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
      }),
    );
    return (yield* decodeConfig(contents)).releases ?? null;
  });

  const snapshot = Effect.fn("ReleasesService.snapshot")(function* (projectId: ProjectId) {
    const root = yield* workspace(projectId);
    const config = yield* configuration(root).pipe(Effect.result);
    const state = stateOf(projectId);
    return {
      configured: config._tag === "Success" && config.success !== null,
      configurationError: config._tag === "Failure" ? tail(config.failure.message) : null,
      refreshMinutes:
        (config._tag === "Success" ? config.success?.refreshMinutes : undefined) ??
        RELEASES_DEFAULT_REFRESH_MINUTES,
      running: state.running,
      lastRun: state.lastRun,
      document: state.document,
    } satisfies ReleasesSnapshot;
  });

  const run = Effect.fn("ReleasesService.run")(
    function* (root: string, config: ReleasesConfiguration) {
      const result = yield* processes.run({
        command: platform === "win32" ? "cmd.exe" : environment.SHELL || "/bin/sh",
        args: platform === "win32" ? ["/d", "/s", "/c", config.command] : ["-lc", config.command],
        cwd: config.cwd ? path.join(root, config.cwd) : root,
        timeout: "10 minutes",
        maxOutputBytes: MAX_OUTPUT,
      });
      if (result.code !== 0)
        return yield* Effect.fail(
          `The release command exited with code ${result.code}.\n${tail(result.stderr || result.stdout)}`,
        );
      return yield* decodeDocument(result.stdout.trim());
    },
    Effect.mapError((error) => (typeof error === "string" ? error : tail(error.message))),
  );

  const refresh = Effect.fn("ReleasesService.refresh")(function* (input: ReleasesRefreshInput) {
    const root = yield* workspace(input.projectId);
    const config = yield* configuration(root).pipe(
      Effect.mapError((cause) => new ReleasesError({ reason: "not-configured", cause })),
    );
    if (!config) return yield* new ReleasesError({ reason: "not-configured" });
    const now = yield* Clock.currentTimeMillis;
    const state = stateOf(input.projectId);
    const minutes = config.refreshMinutes ?? RELEASES_DEFAULT_REFRESH_MINUTES;
    if (
      state.running ||
      (!input.force &&
        state.lastRun &&
        now - Date.parse(state.lastRun.finishedAt) < minutes * 60_000)
    )
      return;
    states.set(input.projectId, { ...state, running: true });
    yield* PubSub.publish(updates, input.projectId);
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    yield* run(root, config).pipe(
      Effect.result,
      Effect.flatMap((outcome) =>
        Effect.gen(function* () {
          const finishedAt = DateTime.formatIso(yield* DateTime.now);
          states.set(input.projectId, {
            running: false,
            document:
              outcome._tag === "Success" ? outcome.success : stateOf(input.projectId).document,
            lastRun: {
              startedAt,
              finishedAt,
              error: outcome._tag === "Failure" ? outcome.failure : null,
            },
          });
          yield* PubSub.publish(updates, input.projectId);
        }),
      ),
      Effect.forkIn(scope),
    );
  });

  return ReleasesService.of({
    refresh,
    subscribe: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = yield* PubSub.subscribe(updates);
          return Stream.concat(
            Stream.fromEffect(snapshot(input.projectId)),
            Stream.fromSubscription(queue).pipe(
              Stream.filter((projectId) => projectId === input.projectId),
              Stream.mapEffect(() => snapshot(input.projectId)),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(ReleasesService, make);
