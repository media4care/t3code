import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  RELEASE_ICON_MAX_BYTES,
  SecretProviderId,
  type ReleaseStatusDocument,
  type ReleasesSnapshot,
  type ServerSettings,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as Releases from "./ReleasesService.ts";

const projectId = ProjectId.make("releases-test");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const document: ReleaseStatusDocument = {
  schemaVersion: 1,
  generatedAt: "2026-11-04T10:00:00.000Z",
  sources: [{ id: "ci", name: "CI", status: "ok" }],
  releases: [{ version: "1.2.0", environment: "prod" }],
  gates: [],
  targets: [],
  services: [],
};

const fixture = Effect.fn("Releases.test.fixture")(function* (
  script: string,
  options: {
    readonly canonicalKey?: string;
    readonly releaseEnvironments?: ServerSettings["releaseEnvironments"];
    readonly secrets?: Readonly<Record<string, string>>;
    readonly otherProjects?: Readonly<Record<string, string>>;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-releases-test-" });
  yield* fs.writeFileString(
    path.join(root, "t3.json"),
    encodeJson({ releases: { command: "node status.cjs" } }),
  );
  yield* fs.writeFileString(path.join(root, "status.cjs"), script);
  const row = (id: ProjectId, workspaceRoot: string) => ({
    projectId: id,
    workspaceRoot,
    title: "Releases",
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    pinnedAt: null,
    archivedAt: null,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  });
  const rows = [
    row(projectId, root),
    ...Object.entries(options.otherProjects ?? {}).map(([id, workspaceRoot]) =>
      row(ProjectId.make(id), workspaceRoot),
    ),
  ];
  const projectLayer = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (id) => Effect.succeed(Option.fromNullishOr(rows.find((item) => item.projectId === id))),
    list: () => Effect.succeed(rows),
  });
  const identityLayer = Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
    resolve: () =>
      Effect.succeed(
        options.canonicalKey === undefined
          ? null
          : {
              canonicalKey: options.canonicalKey,
              locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@x:y.git" },
            },
      ),
  });
  const settingsLayer = Layer.mock(ServerSettingsService.ServerSettingsService)({
    getSettings: Effect.succeed({
      ...DEFAULT_SERVER_SETTINGS,
      releaseEnvironments: options.releaseEnvironments ?? {},
    }),
  });
  const secretsLayer = Layer.mock(SecretResolver.SecretResolver)({
    read: (references) =>
      Effect.succeed(references.map((reference) => options.secrets?.[reference.reference])),
  });
  const context = yield* Layer.build(
    Layer.fresh(
      Releases.layer.pipe(
        Layer.provide(Layer.mergeAll(projectLayer, identityLayer, settingsLayer, secretsLayer)),
      ),
    ),
  );
  return { service: Context.get(context, Releases.ReleasesService), root, fs, path };
});

/** The first snapshot whose finished run is not `previous`. */
const finishedAfter = (
  service: Releases.ReleasesService["Service"],
  previous: ReleasesSnapshot | null,
) =>
  service.subscribe({ projectId }).pipe(
    Stream.filter(
      (snapshot) =>
        !snapshot.running &&
        snapshot.lastRun !== null &&
        snapshot.lastRun.finishedAt !== previous?.lastRun?.finishedAt,
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow<ReleasesSnapshot>),
  );

const layer = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

describe("ReleasesService", () => {
  it.live("runs the configured command and keeps a fresh document until forced", () =>
    Effect.gen(function* () {
      const { service, root, fs, path } = yield* fixture(
        `const fs = require("node:fs");
        fs.appendFileSync("runs.txt", "x");
        console.log(JSON.stringify(${encodeJson(document)}));`,
      );
      // An agent's read waits for the run a stale document needs.
      const snapshot = yield* service.read({ projectId });
      assert.deepStrictEqual(snapshot.document, document);
      assert.strictEqual(snapshot.lastRun?.error, null);

      yield* service.refresh({ projectId });
      assert.deepStrictEqual((yield* service.read({ projectId })).lastRun, snapshot.lastRun);
      assert.strictEqual(yield* fs.readFileString(path.join(root, "runs.txt")), "x");

      yield* service.refresh({ projectId, force: true });
      yield* finishedAfter(service, snapshot);
      assert.strictEqual(yield* fs.readFileString(path.join(root, "runs.txt")), "xx");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("runs once more for forced refreshes that arrive mid-run", () =>
    Effect.gen(function* () {
      const processes = yield* ProcessRunner.ProcessRunner;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let first = true;
      const gated = ProcessRunner.ProcessRunner.of({
        run: (input) => {
          if (!first) return processes.run(input);
          first = false;
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(processes.run(input)),
          );
        },
      });
      const { service, root, fs, path } = yield* fixture(
        `require("node:fs").appendFileSync("runs.txt", "x");
        console.log(JSON.stringify(${encodeJson(document)}));`,
      ).pipe(Effect.provideService(ProcessRunner.ProcessRunner, gated));
      yield* service.refresh({ projectId, force: true });
      yield* Deferred.await(started);
      // Two credentials saved while the first run is going.
      yield* service.refresh({ projectId, force: true });
      yield* service.refresh({ projectId, force: true });
      yield* Deferred.succeed(release, undefined);
      yield* finishedAfter(service, null);
      assert.strictEqual(yield* fs.readFileString(path.join(root, "runs.txt")), "xx");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("keeps the last document and reports why a later run failed", () =>
    Effect.gen(function* () {
      const { service, root, fs, path } = yield* fixture(
        `const fs = require("node:fs");
        if (fs.existsSync("broken")) console.log(JSON.stringify({ schemaVersion: 2 }));
        else console.log(JSON.stringify(${encodeJson(document)}));`,
      );
      yield* service.refresh({ projectId });
      const first = yield* finishedAfter(service, null);
      yield* fs.writeFileString(path.join(root, "broken"), "");
      yield* service.refresh({ projectId, force: true });
      const snapshot = yield* finishedAfter(service, first);
      assert.deepStrictEqual(snapshot.document, document);
      assert.include(snapshot.lastRun?.error ?? "", "schemaVersion");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("sends group icons from the repository and skips files that are not small images", () =>
    Effect.gen(function* () {
      const withGroups: ReleaseStatusDocument = {
        ...document,
        groups: [
          { id: "app", name: "App", icon: "icons/app.png" },
          { id: "renamed", icon: "icons/secret.png" },
          { id: "large", icon: "icons/large.png" },
          { id: "missing", icon: "icons/missing.png" },
        ],
      };
      const { service, root, fs, path } = yield* fixture(
        `console.log(JSON.stringify(${encodeJson(withGroups)}));`,
      );
      const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      yield* fs.makeDirectory(path.join(root, "icons"));
      yield* fs.writeFile(path.join(root, "icons/app.png"), new Uint8Array(png));
      yield* fs.writeFileString(path.join(root, "icons/secret.png"), "TOKEN=abc");
      const large = new Uint8Array(RELEASE_ICON_MAX_BYTES + 1);
      large.set(png);
      yield* fs.writeFile(path.join(root, "icons/large.png"), large);

      const snapshot = yield* service.read({ projectId });
      assert.deepStrictEqual(snapshot.icons, { app: "data:image/png;base64,iVBORw0KGgo=" });
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("runs the command with the release environment of the project's repository", () =>
    Effect.gen(function* () {
      const canonicalKey = "github.com/acme/app";
      const { service } = yield* fixture(
        `if (process.env.RELEASE_TOKEN !== "plain" || process.env.STORE_KEY !== "from-vault") {
          console.error("missing " + process.env.RELEASE_TOKEN + " " + process.env.STORE_KEY);
          process.exit(1);
        }
        console.log(JSON.stringify(${encodeJson(document)}));`,
        {
          canonicalKey,
          releaseEnvironments: {
            [canonicalKey]: [
              { name: "RELEASE_TOKEN", value: "plain", sensitive: true },
              {
                name: "STORE_KEY",
                value: { provider: SecretProviderId.make("vault"), reference: "store" },
                sensitive: true,
              },
            ],
            [`project:${projectId}`]: [{ name: "RELEASE_TOKEN", value: "other", sensitive: false }],
          },
          secrets: { store: "from-vault" },
        },
      );
      const snapshot = yield* service.read({ projectId });
      assert.strictEqual(snapshot.environmentKey, canonicalKey);
      assert.strictEqual(snapshot.lastRun?.error, null);
      assert.deepStrictEqual(snapshot.document, document);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("fails the run when a release secret cannot be read", () =>
    Effect.gen(function* () {
      const { service } = yield* fixture(`console.log(JSON.stringify(${encodeJson(document)}));`, {
        releaseEnvironments: {
          [`project:${projectId}`]: [
            {
              name: "STORE_KEY",
              value: { provider: SecretProviderId.make("vault"), reference: "gone" },
              sensitive: true,
            },
          ],
        },
      });
      const snapshot = yield* service.read({ projectId });
      assert.strictEqual(snapshot.environmentKey, `project:${projectId}`);
      assert.include(snapshot.lastRun?.error ?? "", "STORE_KEY");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("reports a missing releases command", () =>
    Effect.gen(function* () {
      const { service, root, fs, path } = yield* fixture("");
      yield* fs.writeFileString(path.join(root, "t3.json"), "{}");
      const error = yield* service.refresh({ projectId }).pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-configured");
      const snapshot = yield* service.subscribe({ projectId }).pipe(Stream.runHead);
      assert.isFalse(Option.getOrThrow(snapshot).configured);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("lists the projects whose t3.json has a releases section, even a broken one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = (contents: string | null) =>
        Effect.gen(function* () {
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-releases-other-" });
          if (contents !== null) yield* fs.writeFileString(path.join(dir, "t3.json"), contents);
          return dir;
        });
      const { service } = yield* fixture("", {
        otherProjects: {
          none: yield* folder(encodeJson({ scripts: [] })),
          broken: yield* folder(encodeJson({ releases: { command: 5 } })),
          "no-file": yield* folder(null),
          gone: path.join(yield* folder(null), "missing"),
        },
      });
      assert.deepStrictEqual(yield* service.projects, [projectId, ProjectId.make("broken")]);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
});
