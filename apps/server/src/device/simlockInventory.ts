import type { DeviceFormFactor, DeviceSession, DeviceSimlockInventory } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";

const Platform = Schema.Literals(["ios", "android"]);
const Devices = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      driverDeviceId: Schema.String,
      spec: Schema.Struct({
        platform: Platform,
        model: Schema.String,
        osVersion: Schema.optionalKey(Schema.String),
      }),
      state: Schema.String,
      physical: Schema.Boolean,
      class: Schema.optionalKey(Schema.String),
      absentReason: Schema.optionalKey(Schema.String),
    }),
  ),
);
const Catalog = Schema.fromJsonString(
  Schema.Struct({
    platforms: Schema.Array(
      Schema.Struct({
        platform: Platform,
        models: Schema.Array(Schema.String),
        modelRuntimes: Schema.Record(Schema.String, Schema.Array(Schema.String)),
        modelClasses: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      }),
    ),
  }),
);

const Leases = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      deviceId: Schema.String,
      requesterId: Schema.String,
      label: Schema.optionalKey(Schema.String),
    }),
  ),
);

/** QA runs lease with `--agent-id` starting with this, so the inventory can name them. */
export const QA_SIMLOCK_REQUESTER_PREFIX = "t3-qa-";

const decodeDevices = Schema.decodeUnknownEffect(Devices);
// Simlock's classes also include vision and auto, which T3 shows as other devices.
const formFactorOf = (deviceClass: string): DeviceFormFactor =>
  deviceClass === "phone" ||
  deviceClass === "tablet" ||
  deviceClass === "tv" ||
  deviceClass === "watch"
    ? deviceClass
    : "other";
const decodeLeases = Schema.decodeUnknownEffect(Leases);
const decodeCatalog = Schema.decodeUnknownEffect(Catalog);

/**
 * Only inventory commands; never boots, leases, enrolls, authorizes, or deletes devices.
 * `sessions` are this server's open devices, which name the thread holding a lease.
 */
export const readSimlockInventory = Effect.fn("DevicePool.readSimlockInventory")(function* (
  sessions: ReadonlyArray<Pick<DeviceSession, "threadId" | "deviceId">>,
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const issues: string[] = [];
  const read = Effect.fn("DevicePool.readInventorySource")(function* (
    label: string,
    command: string,
    args: string[],
  ) {
    return yield* runner
      .run({ command, args, timeout: "10 seconds", maxOutputBytes: 2 * 1024 * 1024 })
      .pipe(
        Effect.flatMap((output) => {
          if (
            output.code !== 0 ||
            output.timedOut ||
            output.stdoutTruncated ||
            output.stdoutInvalidUtf8
          ) {
            const reason = output.timedOut
              ? "timed out"
              : output.stdoutTruncated
                ? "output exceeded the limit"
                : output.stdoutInvalidUtf8
                  ? "invalid UTF-8 output"
                  : `exit ${output.code}`;
            issues.push(`${label}: scan failed (${reason}). Refresh to try again.`);
            return Effect.succeed(null);
          }
          return Effect.succeed(output.stdout);
        }),
        Effect.catch((error) => {
          issues.push(`${label}: ${error.message}`);
          return Effect.succeed(null);
        }),
      );
  });
  const [deviceText, leaseText, catalogText, adbText] = yield* Effect.all(
    [
      read("Simlock devices", "simlock", ["--local", "list"]),
      read("Simlock leases", "simlock", ["--local", "list", "--leases"]),
      read("Simlock models", "simlock", ["--local", "catalog", "--json"]),
      read("Android connections", "adb", ["devices", "-l"]),
    ],
    { concurrency: 4 },
  );
  const records =
    deviceText === null
      ? null
      : yield* decodeDevices(deviceText).pipe(
          Effect.catch(() => {
            issues.push("Simlock devices: response could not be read. Enrollment is unknown.");
            return Effect.succeed(null);
          }),
        );
  const leases =
    leaseText === null
      ? []
      : yield* decodeLeases(leaseText).pipe(
          Effect.catch(() => {
            issues.push("Simlock leases: response could not be read. Holders are unknown.");
            return Effect.succeed([]);
          }),
        );
  const leaseOf = (simlockDeviceId: string): DeviceSimlockInventory["devices"][number]["lease"] => {
    const lease = leases.find((candidate) => candidate.deviceId === simlockDeviceId);
    if (!lease) return undefined;
    // A gateway names a worker's lease `<worker id>.<lease id>`; this worker knows only its part.
    const session = sessions.find(
      (candidate) => candidate.deviceId === lease.id || candidate.deviceId.endsWith(`.${lease.id}`),
    );
    return {
      id: lease.id,
      label: lease.label ?? null,
      holder: session
        ? { type: "thread", threadId: session.threadId }
        : lease.requesterId.startsWith(QA_SIMLOCK_REQUESTER_PREFIX)
          ? { type: "qa-run" }
          : { type: "requester", requesterId: lease.requesterId },
    };
  };
  const catalog =
    catalogText === null
      ? null
      : yield* decodeCatalog(catalogText).pipe(
          Effect.catch(() => {
            issues.push("Simlock models: response could not be read.");
            return Effect.succeed(null);
          }),
        );
  const devices: Array<DeviceSimlockInventory["devices"][number]> = (records ?? [])
    .filter((device) => device.state !== "deleted")
    .map((device) => {
      const lease = leaseOf(device.id);
      // A physical device carries its class; an instance is classed by its model in the catalog.
      const deviceClass =
        device.class ??
        catalog?.platforms.find((entry) => entry.platform === device.spec.platform)?.modelClasses?.[
          device.spec.model
        ];
      return {
        ...(lease ? { lease } : {}),
        ...(deviceClass ? { formFactor: formFactorOf(deviceClass) } : {}),
        id: device.driverDeviceId,
        name: device.spec.model,
        platform: device.spec.platform,
        version: device.spec.osVersion ?? "",
        physical: device.physical,
        enrolled: true,
        simlockState: device.state,
        state: device.state,
        detail:
          device.absentReason === "not-present"
            ? "Simlock cannot detect this device. Check its connection."
            : device.absentReason === "untrusted"
              ? "Trust this computer on the device."
              : device.absentReason === "locked"
                ? "Unlock the device so Simlock can use it."
                : (device.absentReason ?? ""),
      };
    });
  if (adbText !== null) {
    if (!adbText.includes("List of devices attached"))
      issues.push("Android connections: response could not be read.");
    else
      for (const line of adbText.split(/\r?\n/)) {
        const match = /^(\S+)\s+(device|unauthorized|offline|no permissions)\b(.*)$/.exec(line);
        if (!match || match[1]!.startsWith("emulator-")) continue;
        const [, id, connection, metadata = ""] = match;
        if (!id || !connection) continue;
        const existing = devices.findIndex(
          (device) => device.physical && device.platform === "android" && device.id === id,
        );
        const previous = devices[existing];
        const state = connection === "device" ? (previous?.state ?? "connected") : connection;
        const detail =
          connection === "unauthorized"
            ? "Unlock the device and accept the USB debugging prompt."
            : connection === "offline"
              ? "ADB sees the device but cannot communicate with it."
              : connection === "no permissions"
                ? "The Android bridge lacks permission to access this device."
                : (previous?.detail ?? "");
        const entry = {
          id,
          name: previous?.name ?? /\bmodel:(\S+)/.exec(metadata)?.[1]?.replaceAll("_", " ") ?? id,
          platform: "android" as const,
          version: previous?.version ?? "",
          physical: true,
          enrolled: previous?.enrolled ?? (records === null ? null : false),
          simlockState: previous?.simlockState ?? null,
          state,
          detail,
          ...(previous?.lease ? { lease: previous.lease } : {}),
          ...(previous?.formFactor ? { formFactor: previous.formFactor } : {}),
        };
        if (existing < 0) devices.push(entry);
        else devices[existing] = entry;
      }
  }
  return {
    scannedAt: DateTime.formatIso(yield* DateTime.now),
    devices,
    models: (catalog?.platforms ?? []).flatMap((platform) =>
      platform.models.map((name) => ({
        platform: platform.platform,
        name,
        formFactor: platform.modelClasses?.[name] ?? "other",
        runtimes: platform.modelRuntimes[name] ?? [],
      })),
    ),
    hiddenDeletedCount: (records ?? []).filter((device) => device.state === "deleted").length,
    issues,
  } satisfies DeviceSimlockInventory;
});
