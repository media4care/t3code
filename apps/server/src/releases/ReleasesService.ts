import {
  RELEASE_ICON_MAX_BYTES,
  ReleaseStatusDocument,
  ReleasesConfiguration,
  ReleasesError,
  RELEASES_DEFAULT_REFRESH_MINUTES,
  releaseDocumentRejected,
  type ProjectId,
  type ReleasesProjectInput,
  type ReleasesRefreshInput,
  type ReleasesSnapshot,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import { fileHeaderMimeType } from "../workspace/fileHeaderMimeType.ts";

const MAX_OUTPUT = 4 * 1024 * 1024;
const ERROR_LIMIT = 2000;
const decodeConfig = Schema.decodeEffect(
  fromLenientJson(Schema.Struct({ releases: Schema.optionalKey(ReleasesConfiguration) })),
);
const decodeDocument = Schema.decodeEffect(Schema.fromJsonString(ReleaseStatusDocument));
const ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
// The smallest refreshMinutes, so a project refreshes within a minute of going stale.
const SWEEP_INTERVAL_MS = 60_000;
const BACKGROUND_RUNS = 2;
const sameProjects = Arr.makeEquivalence<ProjectId>((a, b) => a === b);

interface ProjectState {
  readonly running: boolean;
  /** A forced refresh arrived mid-run, possibly with new credentials, so run once more. */
  readonly rerun: boolean;
  readonly lastRun: ReleasesSnapshot["lastRun"];
  readonly document: ReleaseStatusDocument | null;
  readonly icons: Readonly<Record<string, string>>;
}
const EMPTY: ProjectState = {
  running: false,
  rerun: false,
  lastRun: null,
  document: null,
  icons: {},
};

const tail = (text: string) => text.trim().slice(-ERROR_LIMIT);

export class ReleasesService extends Context.Service<
  ReleasesService,
  {
    readonly subscribe: (
      input: ReleasesProjectInput,
    ) => Stream.Stream<ReleasesSnapshot, ReleasesError>;
    readonly refresh: (input: ReleasesRefreshInput) => Effect.Effect<void, ReleasesError>;
    /** The snapshot, after running the command first when the document is stale. */
    readonly read: (input: ReleasesProjectInput) => Effect.Effect<ReleasesSnapshot, ReleasesError>;
    readonly projects: Effect.Effect<ReadonlyArray<ProjectId>, ReleasesError>;
    /** Projects whose document has a rejected store review; watching keeps every document fresh. */
    readonly rejections: Stream.Stream<ReadonlyArray<ProjectId>, ReleasesError>;
  }
>()("t3/releases/ReleasesService") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const processes = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const identities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const scope = yield* Effect.scope;
  const updates = yield* PubSub.sliding<ProjectId>(64);
  // Release status is cheap to rebuild, and kept fresh in the background only while a client
  // watches rejections.
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

  // Clones and worktrees of one repository share its release environment.
  const environmentKey = Effect.fn("ReleasesService.environmentKey")(function* (
    projectId: ProjectId,
    root: string,
  ) {
    return (yield* identities.resolve(root))?.canonicalKey ?? `project:${projectId}`;
  });

  const commandEnvironment = Effect.fn("ReleasesService.commandEnvironment")(function* (
    key: string,
  ) {
    const variables = (yield* settings.getSettings).releaseEnvironments[key] ?? [];
    const references = variables.flatMap((variable) =>
      typeof variable.value === "string" ? [] : [variable.value],
    );
    const secretValues = references.length === 0 ? [] : yield* secrets.read(references);
    const env: Record<string, string> = {};
    const unreadable: Array<string> = [];
    let index = 0;
    for (const variable of variables) {
      const value = typeof variable.value === "string" ? variable.value : secretValues[index++];
      if (value === undefined) unreadable.push(variable.name);
      else env[variable.name] = value;
    }
    if (unreadable.length > 0)
      return yield* Effect.fail(`Could not read the secret for ${unreadable.join(", ")}.`);
    return env;
  });

  const snapshot = Effect.fn("ReleasesService.snapshot")(function* (projectId: ProjectId) {
    const root = yield* workspace(projectId);
    const config = yield* configuration(root).pipe(Effect.result);
    const state = stateOf(projectId);
    return {
      configured: config._tag === "Success" && config.success !== null,
      environmentKey: yield* environmentKey(projectId, root),
      configurationError: config._tag === "Failure" ? tail(config.failure.message) : null,
      refreshMinutes:
        (config._tag === "Success" ? config.success?.refreshMinutes : undefined) ??
        RELEASES_DEFAULT_REFRESH_MINUTES,
      running: state.running,
      lastRun: state.lastRun,
      document: state.document,
      icons: state.icons,
    } satisfies ReleasesSnapshot;
  });

  const run = Effect.fn("ReleasesService.run")(
    function* (projectId: ProjectId, root: string, config: ReleasesConfiguration) {
      const env = yield* commandEnvironment(yield* environmentKey(projectId, root));
      const result = yield* processes.run({
        command: platform === "win32" ? "cmd.exe" : environment.SHELL || "/bin/sh",
        args: platform === "win32" ? ["/d", "/s", "/c", config.command] : ["-lc", config.command],
        cwd: config.cwd ? path.join(root, config.cwd) : root,
        timeout: "10 minutes",
        maxOutputBytes: MAX_OUTPUT,
        env,
      });
      if (result.code !== 0)
        return yield* Effect.fail(
          `The release command exited with code ${result.code}.\n${tail(result.stderr || result.stdout)}`,
        );
      return yield* decodeDocument(result.stdout.trim());
    },
    Effect.mapError((error) => (typeof error === "string" ? error : tail(error.message))),
  );

  /** Group icons as data URLs, read once per document; a missing, large or non-image file is skipped. */
  const icons = Effect.fn("ReleasesService.icons")(function* (
    root: string,
    document: ReleaseStatusDocument,
  ) {
    const entries = yield* Effect.forEach(
      document.groups ?? [],
      (group) => {
        if (!group.icon) return Effect.succeed([]);
        const file = path.join(root, group.icon);
        return Effect.gen(function* () {
          const size = Number((yield* fs.stat(file)).size);
          if (size > RELEASE_ICON_MAX_BYTES)
            return yield* Effect.fail(`it is larger than ${RELEASE_ICON_MAX_BYTES / 1024} KB`);
          const bytes = yield* fs.readFile(file);
          const type = fileHeaderMimeType(bytes);
          if (!type || !ICON_TYPES.has(type))
            return yield* Effect.fail("it is not a PNG, JPEG or WebP image");
          return [[group.id, `data:${type};base64,${Buffer.from(bytes).toString("base64")}`]];
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Skipping the release icon ${group.icon}: ${typeof error === "string" ? error : error.message}`,
            ).pipe(Effect.as([])),
          ),
        );
      },
      { concurrency: 4 },
    );
    return Object.fromEntries(entries.flat());
  });

  /** Marks the project running and returns the run, or nothing to do while the document is fresh. */
  const start = Effect.fn("ReleasesService.start")(function* (input: ReleasesRefreshInput) {
    const root = yield* workspace(input.projectId);
    const config = yield* configuration(root).pipe(
      Effect.mapError((cause) => new ReleasesError({ reason: "not-configured", cause })),
    );
    if (!config) return yield* new ReleasesError({ reason: "not-configured" });
    const now = yield* Clock.currentTimeMillis;
    const state = stateOf(input.projectId);
    const minutes = config.refreshMinutes ?? RELEASES_DEFAULT_REFRESH_MINUTES;
    if (state.running) {
      if (input.force) states.set(input.projectId, { ...state, rerun: true });
      return Effect.void;
    }
    if (
      !input.force &&
      state.lastRun &&
      now - Date.parse(state.lastRun.finishedAt) < minutes * 60_000
    )
      return Effect.void;
    states.set(input.projectId, { ...state, running: true });
    yield* PubSub.publish(updates, input.projectId);
    return Effect.gen(function* () {
      while (true) {
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        const outcome = yield* run(input.projectId, root, config).pipe(Effect.result);
        const resolved = outcome._tag === "Success" ? yield* icons(root, outcome.success) : null;
        const finishedAt = DateTime.formatIso(yield* DateTime.now);
        const current = stateOf(input.projectId);
        states.set(input.projectId, {
          running: current.rerun,
          rerun: false,
          document: outcome._tag === "Success" ? outcome.success : current.document,
          icons: resolved ?? current.icons,
          lastRun: {
            startedAt,
            finishedAt,
            error: outcome._tag === "Failure" ? outcome.failure : null,
          },
        });
        yield* PubSub.publish(updates, input.projectId);
        if (!current.rerun) return;
      }
    });
  });

  const configuredProjects = Effect.gen(function* () {
    const rows = yield* projects
      .list()
      .pipe(Effect.mapError((cause) => new ReleasesError({ reason: "workspace", cause })));
    const configured = yield* Effect.forEach(
      rows,
      (row) =>
        fs.realPath(row.workspaceRoot).pipe(
          Effect.flatMap((root) =>
            configuration(root).pipe(
              Effect.map((config) => config !== null),
              // A broken section still counts, so its error stays visible on the page.
              Effect.orElseSucceed(() => true),
            ),
          ),
          Effect.orElseSucceed(() => false),
          Effect.map((configured) => (configured ? [row.projectId] : [])),
        ),
      { concurrency: 8 },
    );
    return configured.flat();
  }).pipe(Effect.withSpan("ReleasesService.projects"));

  const rejected = Effect.sync(() =>
    Array.from(states)
      .flatMap(([projectId, state]) =>
        state.document && releaseDocumentRejected(state.document) ? [projectId] : [],
      )
      .sort(),
  );

  const backgroundRuns = yield* Semaphore.make(BACKGROUND_RUNS);
  /** Starts every stale configured project and forgets projects no longer configured. */
  const sweep = Effect.fn("ReleasesService.sweep")(function* () {
    const configured = new Set(yield* configuredProjects);
    for (const projectId of Array.from(states.keys())) {
      if (configured.has(projectId)) continue;
      states.delete(projectId);
      yield* PubSub.publish(updates, projectId);
    }
    yield* Effect.forEach(
      configured,
      (projectId) =>
        start({ projectId }).pipe(
          // Not joined: a slow command must not hold back the other projects' next refresh.
          Effect.flatMap((pending) => Effect.forkIn(backgroundRuns.withPermits(1)(pending), scope)),
          Effect.catch((error) =>
            Effect.logDebug(`Background release refresh skipped ${projectId}: ${error.reason}`),
          ),
        ),
      { discard: true },
    );
  });

  // Ticks stay on a one-minute grid from the first watcher, skipping any a slow sweep overran.
  const sweepLoop = Effect.gen(function* () {
    let tick = yield* Clock.currentTimeMillis;
    while (true) {
      yield* sweep().pipe(
        Effect.catch((error) =>
          Effect.logDebug(`Background release sweep failed: ${error.reason}`),
        ),
      );
      const now = yield* Clock.currentTimeMillis;
      tick += SWEEP_INTERVAL_MS * Math.max(1, Math.ceil((now - tick) / SWEEP_INTERVAL_MS));
      yield* Effect.sleep(tick - now);
    }
  });
  let watchers = 0;
  let sweeper: Fiber.Fiber<never> | undefined;
  const watch = Effect.acquireRelease(
    Effect.suspend(() => {
      watchers += 1;
      if (watchers > 1) return Effect.void;
      return Effect.forkIn(sweepLoop, scope).pipe(
        Effect.map((fiber) => {
          sweeper = fiber;
        }),
      );
    }),
    () =>
      Effect.suspend(() => {
        watchers -= 1;
        const fiber = sweeper;
        if (watchers > 0 || !fiber) return Effect.void;
        sweeper = undefined;
        return Fiber.interrupt(fiber);
      }),
  );

  return ReleasesService.of({
    projects: configuredProjects,
    refresh: Effect.fn("ReleasesService.refresh")(function* (input) {
      yield* Effect.forkIn(yield* start(input), scope);
    }),
    read: Effect.fn("ReleasesService.read")(function* (input) {
      // Joined, not inlined: an interrupted caller must not strand the project as running.
      yield* Fiber.join(yield* Effect.forkIn(yield* start(input), scope));
      return yield* snapshot(input.projectId);
    }),
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
    rejections: Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* PubSub.subscribe(updates);
        // Read before the first sweep starts, so the first emission is the state a client joined.
        const initial = yield* rejected;
        yield* watch;
        return Stream.concat(
          Stream.make(initial),
          Stream.fromSubscription(queue).pipe(Stream.mapEffect(() => rejected)),
        ).pipe(Stream.changesWith(sameProjects));
      }),
    ),
  });
});

export const layer = Layer.effect(ReleasesService, make);
