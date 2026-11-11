import { QaDeviceSelection, QaError, type QaSetDeviceInput } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

// Choices belong to this environment's devices, so they stay out of the repository.
const SELECTIONS_FILE_NAME = "qa-devices.json";

// Version 1 kept choices per project; they are dropped now that QA belongs to repositories.
const SelectionsFile = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(2),
    selections: Schema.Array(Schema.Struct({ scope: Schema.String, ...QaDeviceSelection.fields })),
  }),
);
const decodeSelections = Schema.decodeEffect(SelectionsFile);
const encodeSelections = Schema.encodeEffect(SelectionsFile);
type StoredSelection = (typeof SelectionsFile.Type)["selections"][number];

/** The devices people chose for suites, per QA scope (a repository, or a project without one). */
export const makeDeviceSelections = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(config.stateDir, SELECTIONS_FILE_NAME);
  const lock = yield* Semaphore.make(1);
  let selections: ReadonlyArray<StoredSelection> = yield* fs.readFileString(filePath).pipe(
    Effect.flatMap(decodeSelections),
    Effect.map((file) => file.selections),
    Effect.catch((cause) =>
      cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
        ? Effect.succeed([])
        : Effect.logWarning("Ignoring unreadable QA device choices", { cause }).pipe(Effect.as([])),
    ),
  );

  const forScope = (scope: string): ReadonlyArray<QaDeviceSelection> =>
    selections.flatMap(({ scope: owner, ...selection }) => (owner === scope ? [selection] : []));

  const set = Effect.fn("QaService.setDeviceSelection")(
    function* (scope: string, { suiteId, requirement, deviceKey }: QaSetDeviceInput) {
      const next = [
        ...selections.filter(
          (selection) =>
            selection.scope !== scope ||
            selection.suiteId !== suiteId ||
            selection.requirement !== requirement,
        ),
        ...(deviceKey ? [{ scope, suiteId, requirement, deviceKey }] : []),
      ];
      const contents = yield* encodeSelections({ version: 2, selections: next });
      yield* writeFileStringAtomically({ filePath, contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      selections = next;
    },
    lock.withPermit,
    Effect.mapError((cause) => new QaError({ reason: "storage", cause })),
  );

  return { forScope, set };
});
