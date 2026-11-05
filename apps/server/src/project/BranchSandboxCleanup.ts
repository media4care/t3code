import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ProcessRunner from "../processRunner.ts";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export interface BranchSandbox {
  readonly root: string;
  readonly project: string;
}

export class SandboxCleanupError extends Schema.TaggedError<SandboxCleanupError>()(
  "SandboxCleanupError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Branch sandbox cleanup failed during ${this.operation}.`;
  }
}

export class BranchSandboxCleanup extends Context.Service<
  BranchSandboxCleanup,
  {
    readonly find: (
      roots: ReadonlyArray<string>,
      branch: string,
    ) => Effect.Effect<ReadonlyArray<BranchSandbox>, PlatformError.PlatformError>;
    readonly remove: (
      sandbox: BranchSandbox,
      canRemove: Effect.Effect<boolean>,
    ) => Effect.Effect<void, SandboxCleanupError>;
  }
>()("t3/project/BranchSandboxCleanup") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;

  const find = Effect.fn("BranchSandboxCleanup.find")(function* (
    roots: ReadonlyArray<string>,
    branch: string,
  ) {
    const targets: BranchSandbox[] = [];
    for (const root of new Set(roots)) {
      const directory = path.join(root, "sandboxes");
      if (!(yield* fs.exists(directory))) continue;
      for (const name of yield* fs.readDirectory(directory)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
        const file = path.join(directory, name, "sandbox.env");
        if (!(yield* fs.exists(file))) continue;
        // Read ownership as data: sandbox.env may also contain shell commands or secrets.
        const fields = new Map(
          (yield* fs.readFileString(file)).split(/\r?\n/).map((line) => {
            const separator = line.indexOf("=");
            return [line.slice(0, separator), line.slice(separator + 1)] as const;
          }),
        );
        const project = fields.get("COMPOSE_PROJECT_NAME");
        if (
          fields.get("SANDBOX_BRANCH") !== branch ||
          fields.get("SANDBOX_NAME") !== name ||
          fields.get("M4C_LOCAL_PRESERVE_DATA") === "1" ||
          project === undefined ||
          !/^m4c_[0-9]+_[a-z0-9][a-z0-9-]*$/.test(project)
        )
          continue;
        if (!targets.some((target) => target.root === root && target.project === project)) {
          targets.push({ root, project });
        }
      }
    }
    return targets;
  });

  const docker = Effect.fn("BranchSandboxCleanup.docker")(function* (args: ReadonlyArray<string>) {
    const result = yield* processes
      .run({ command: "docker", args, timeout: "30 seconds", maxOutputBytes: 64 * 1024 })
      .pipe(Effect.mapError((cause) => new SandboxCleanupError({ operation: args[0]!, cause })));
    if (result.code !== 0 || result.stdoutInvalidUtf8 || result.stdoutTruncated) {
      return yield* new SandboxCleanupError({ operation: args[0]!, cause: result });
    }
    return result.stdout;
  });

  const remove = Effect.fn("BranchSandboxCleanup.remove")(function* (
    sandbox: BranchSandbox,
    canRemove: Effect.Effect<boolean>,
  ) {
    if (!(yield* canRemove)) return;
    const output = yield* docker([
      "ps",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=com.docker.compose.project=${sandbox.project}`,
      "--filter",
      `label=com.docker.compose.project.working_dir=${sandbox.root}`,
    ]);
    const ids = output.trim().split(/\s+/).filter(Boolean);
    if (ids.length === 0) return;
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) {
      return yield* new SandboxCleanupError({ operation: "container-list", cause: output });
    }
    if (!(yield* canRemove)) return;
    yield* docker(["stop", "--timeout", "10", ...ids]);
    if (!(yield* canRemove)) return;
    yield* docker(["rm", ...ids]);
  });
  return BranchSandboxCleanup.of({ find, remove });
});

export const layer = Layer.effect(BranchSandboxCleanup, make);
