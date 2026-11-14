import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const makeCanonicalTempDirectoryScoped = Effect.fn("test.makeCanonicalTempDirectoryScoped")(
  function* (options?: Parameters<FileSystem.FileSystem["makeTempDirectoryScoped"]>[0]) {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped(options);
    return yield* fs.realPath(directory);
  },
);
