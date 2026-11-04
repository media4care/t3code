import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, type ReleaseStatusDocument, type ReleasesSnapshot } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
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

const fixture = Effect.fn("Releases.test.fixture")(function* (script: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-releases-test-" });
  yield* fs.writeFileString(
    path.join(root, "t3.json"),
    encodeJson({ releases: { command: "node status.cjs" } }),
  );
  yield* fs.writeFileString(path.join(root, "status.cjs"), script);
  const projectLayer = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              projectId,
              workspaceRoot: root,
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
            })
          : Option.none(),
      ),
  });
  const context = yield* Layer.build(Layer.fresh(Releases.layer.pipe(Layer.provide(projectLayer))));
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
      yield* service.refresh({ projectId });
      const snapshot = yield* finishedAfter(service, null);
      assert.deepStrictEqual(snapshot.document, document);
      assert.strictEqual(snapshot.lastRun?.error, null);

      yield* service.refresh({ projectId });
      assert.strictEqual(yield* fs.readFileString(path.join(root, "runs.txt")), "x");

      yield* service.refresh({ projectId, force: true });
      yield* finishedAfter(service, snapshot);
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
});
