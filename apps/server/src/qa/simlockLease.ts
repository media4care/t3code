import type { QaDeviceRequirement, QaRunDevice } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const SIMLOCK_NOT_INSTALLED =
  "Simlock is not installed on this machine. Install it and start its worker, or set QA devices to This machine in Settings → Devices.";

const Grant = Schema.Struct({
  device: Schema.Struct({
    driverDeviceId: Schema.String,
    address: Schema.String,
    physical: Schema.Boolean,
    spec: Schema.Struct({
      platform: Schema.Literals(["ios", "android"]),
      model: Schema.String,
      osVersion: Schema.optionalKey(Schema.String),
    }),
  }),
  environment: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  lease: Schema.Struct({ id: Schema.String }),
});
const decodeGrant = Schema.decodeUnknownEffect(Schema.fromJsonString(Grant));
const decodeFailure = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ message: Schema.String }) })),
);

export class SimlockLeaseError extends Schema.TaggedError<SimlockLeaseError>()(
  "SimlockLeaseError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

function leaseArguments(requirement: QaDeviceRequirement, agentId: string, timeout: string) {
  const shape = requirement.defaultDevice
    ? ["--device", requirement.defaultDevice]
    : requirement.formFactor && requirement.formFactor !== "other"
      ? ["--class", requirement.formFactor]
      : [];
  return [
    // This machine's worker, so the device it grants is one the suite's command can reach.
    "--local",
    "lease",
    "--platform",
    requirement.platform,
    ...shape,
    ...(requirement.type === "physical" ? ["--physical"] : []),
    "--agent-id",
    agentId,
    "--timeout",
    timeout,
  ];
}

/**
 * Holds a device leased from this machine's Simlock worker until the scope closes. The held
 * `simlock lease` renews the lease, and releases it when stopped or when this server exits.
 */
export const leaseFromSimlock = Effect.fn("QaService.leaseFromSimlock")(function* (
  requirement: QaDeviceRequirement,
  options: {
    readonly key: string;
    readonly agentId: string;
    readonly timeout: string;
    /** Where to find `simlock`: this server's own PATH. */
    readonly path: string | undefined;
    readonly onProgress: (line: string) => Effect.Effect<void>;
  },
): Effect.fn.Return<
  { readonly device: QaRunDevice; readonly environment: Record<string, string> },
  SimlockLeaseError | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner
    .spawn(
      ChildProcess.make("simlock", leaseArguments(requirement, options.agentId, options.timeout), {
        stdin: "ignore",
        env: options.path ? { PATH: options.path } : {},
        extendEnv: true,
        forceKillAfter: "10 seconds",
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause.reason._tag === "NotFound"
          ? new SimlockLeaseError({ detail: SIMLOCK_NOT_INSTALLED, cause })
          : new SimlockLeaseError({ detail: "Could not start simlock.", cause }),
      ),
    );
  let failure: string | null = null;
  // Progress and the failure reason arrive on stderr, one JSON line each.
  const stderr = yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) =>
      Option.match(decodeFailure(line), {
        onSome: ({ error }) => Effect.sync(() => void (failure = error.message)),
        onNone: () => options.onProgress(line),
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  // The grant is the one stdout line; the process keeps running to hold the lease.
  const grant = yield* child.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead);
  if (Option.isNone(grant)) {
    const exitCode = yield* child.exitCode.pipe(Effect.option);
    // stderr ends with the process, so its failure line has been read once it is drained.
    yield* Fiber.join(stderr);
    return yield* new SimlockLeaseError({
      detail: `Simlock did not lease a device${Option.isSome(exitCode) ? ` (exit ${exitCode.value})` : ""}. ${failure ?? "Check that its worker runs on this machine with simlock status."}`,
    });
  }
  const {
    device,
    environment: deviceEnvironment,
    lease,
  } = yield* decodeGrant(grant.value).pipe(
    Effect.mapError(
      (cause) =>
        new SimlockLeaseError({ detail: "Simlock printed a lease T3 Code cannot read.", cause }),
    ),
  );
  return {
    device: {
      requirement: options.key,
      // adb reaches an emulator by its serial; simulator tools by its UDID.
      deviceId: device.spec.platform === "android" ? device.address : device.driverDeviceId,
      name: `${device.spec.model} (Simlock ${lease.id})`,
      platform: device.spec.platform,
      physical: device.physical,
      version: device.spec.osVersion ?? "",
    },
    environment: deviceEnvironment ?? {},
  };
});
