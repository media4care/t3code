import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";
import * as ProcessRunner from "../processRunner.ts";
import * as BranchSandboxCleanup from "./BranchSandboxCleanup.ts";

it.effect(
  "removes only the saved branch's Compose containers, preserving volumes and other stacks",
  () =>
    Effect.gen(function* () {
      const files = new Map([
        [
          "/repo/sandboxes/feature/sandbox.env",
          "SANDBOX_NAME=feature\nSANDBOX_BRANCH=feature\nCOMPOSE_PROJECT_NAME=m4c_123_feature\n",
        ],
        [
          "/repo/sandboxes/main/sandbox.env",
          "SANDBOX_NAME=main\nSANDBOX_BRANCH=main\nCOMPOSE_PROJECT_NAME=m4c_456_main\n",
        ],
        [
          "/repo/sandboxes/protected/sandbox.env",
          "SANDBOX_NAME=protected\nSANDBOX_BRANCH=feature\nCOMPOSE_PROJECT_NAME=m4c_789_protected\nM4C_LOCAL_PRESERVE_DATA=1\n",
        ],
      ]);
      files.set(
        "/repo/sandboxes/invalid/sandbox.env",
        "SANDBOX_NAME=invalid\nSANDBOX_BRANCH=feature\nCOMPOSE_PROJECT_NAME=$(touch /tmp/never-run)\n",
      );
      const containers = new Set(["abcdef123456"]);
      const calls: ReadonlyArray<string>[] = [];
      let exitCode = 0;
      let outputOverride: string | undefined;
      const dependencies = Layer.mergeAll(
        Path.layer,
        FileSystem.layerNoop({
          exists: (path) => Effect.succeed(path === "/repo/sandboxes" || files.has(path)),
          readDirectory: () =>
            Effect.succeed(["feature", "main", "protected", "invalid", "current.env"]),
          readFileString: (path) => Effect.succeed(files.get(path)!),
        }),
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run: ({ args }) =>
            Effect.sync(() => {
              calls.push(args);
              if (args[0] === "rm") for (const id of args.slice(1)) containers.delete(id);
              return {
                stdout: outputOverride ?? (args[0] === "ps" ? [...containers].join("\n") : ""),
                stderr: "",
                code: ChildProcessSpawner.ExitCode(exitCode),
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            }),
        }),
      );
      yield* Effect.gen(function* () {
        const cleanup = yield* BranchSandboxCleanup.BranchSandboxCleanup;
        const targets = yield* cleanup.find(["/repo", "/repo"], "feature");
        expect(targets).toEqual([{ root: "/repo", project: "m4c_123_feature" }]);
        yield* cleanup.remove(targets[0]!, Effect.succeed(true));
        expect(containers.size).toBe(0);
        expect(calls).toEqual([
          [
            "ps",
            "--all",
            "--quiet",
            "--no-trunc",
            "--filter",
            "label=com.docker.compose.project=m4c_123_feature",
            "--filter",
            "label=com.docker.compose.project.working_dir=/repo",
          ],
          ["stop", "--timeout", "10", "abcdef123456"],
          ["rm", "abcdef123456"],
        ]);
        calls.length = 0;
        yield* cleanup.remove(targets[0]!, Effect.succeed(true));
        expect(calls.map((args) => args[0])).toEqual(["ps"]);
        calls.length = 0;
        yield* cleanup.remove(targets[0]!, Effect.succeed(false));
        expect(calls).toEqual([]);
        containers.add("abcdef123456");
        let guards = 0;
        yield* cleanup.remove(
          targets[0]!,
          Effect.sync(() => ++guards < 3),
        );
        expect(calls.map((args) => args[0])).toEqual(["ps", "stop"]);
        expect(containers.size).toBe(1);
        calls.length = 0;
        exitCode = 1;
        const failure = yield* cleanup.remove(targets[0]!, Effect.succeed(true)).pipe(Effect.flip);
        expect(failure.operation).toBe("ps");
        expect(calls.map((args) => args[0])).toEqual(["ps"]);
        calls.length = 0;
        exitCode = 0;
        outputOverride = "--all";
        const invalid = yield* cleanup.remove(targets[0]!, Effect.succeed(true)).pipe(Effect.flip);
        expect(invalid.operation).toBe("container-list");
        expect(calls.map((args) => args[0])).toEqual(["ps"]);
      }).pipe(Effect.provide(BranchSandboxCleanup.layer.pipe(Layer.provide(dependencies))));
    }),
);
