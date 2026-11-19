import { REPOSITORY_ICON_MAX_BYTES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { fileHeaderMimeType } from "./fileHeaderMimeType.ts";

const ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Reads small images from a repository as data URLs by key; a missing, large or non-image file is skipped. */
export const makeRepositoryIconReader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return Effect.fn("readRepositoryIcons")(function* (
    root: string,
    icons: ReadonlyArray<readonly [key: string, relativePath: string]>,
  ) {
    const entries = yield* Effect.forEach(
      icons,
      ([key, relativePath]) =>
        Effect.gen(function* () {
          const file = path.join(root, relativePath);
          const size = Number((yield* fs.stat(file)).size);
          if (size > REPOSITORY_ICON_MAX_BYTES)
            return yield* Effect.fail(`it is larger than ${REPOSITORY_ICON_MAX_BYTES / 1024} KB`);
          const bytes = yield* fs.readFile(file);
          const type = fileHeaderMimeType(bytes);
          if (!type || !ICON_TYPES.has(type))
            return yield* Effect.fail("it is not a PNG, JPEG or WebP image");
          return [[key, `data:${type};base64,${Buffer.from(bytes).toString("base64")}`] as const];
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Skipping the icon ${relativePath}: ${typeof error === "string" ? error : error.message}`,
            ).pipe(Effect.as([])),
          ),
        ),
      { concurrency: 4 },
    );
    return Object.fromEntries(entries.flat());
  });
});
