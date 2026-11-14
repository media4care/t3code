import {
  DevicePoolEntry,
  DevicePoolError,
  type DeviceFormFactor,
  type DeviceForgetInput,
  type DevicePool as DevicePoolSnapshot,
  type DevicePoolQaRun,
  type DeviceSimlockInventory,
  type DeviceServiceState,
  type DeviceSummary,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerConfig from "../config.ts";
import type * as DeviceHost from "./DeviceHost.ts";
import * as DeviceService from "./DeviceService.ts";
import { readSimlockInventory } from "./simlockInventory.ts";

const POOL_FILE_NAME = "device-pool.json";
const MAX_REMEMBERED_DEVICES = 100;

const { key, hostId, deviceId, platform, name, version, formFactor } = DevicePoolEntry.fields;
const RememberedDevice = Schema.Struct({
  key,
  hostId,
  deviceId,
  platform,
  name,
  version,
  formFactor,
  lastSeenAt: Schema.String,
});
type RememberedDevice = typeof RememberedDevice.Type;

const PoolFile = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), devices: Schema.Array(RememberedDevice) }),
);
const decodePoolFile = Schema.decodeEffect(PoolFile);
const encodePoolFile = Schema.encodeEffect(PoolFile);

const BOOT_WAIT = Duration.minutes(5);

export class DevicePrepareError extends Schema.TaggedError<DevicePrepareError>()(
  "DevicePrepareError",
  { device: Schema.String, detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Could not start ${this.device}. ${this.detail}`;
  }
}

export class DevicePool extends Context.Service<
  DevicePool,
  {
    /** The current pool, then each change. */
    readonly stream: Stream.Stream<DevicePoolSnapshot>;
    /** Lists devices again and returns the pool as of that listing. */
    readonly refresh: Effect.Effect<DevicePoolSnapshot>;
    readonly simlockInventory: Effect.Effect<DeviceSimlockInventory>;
    /**
     * Starts a pool device when it is not running and waits until it can take commands. Returns
     * the device as listed then: an Android emulator is listed by its serial once it runs.
     */
    readonly prepare: (
      entry: DevicePoolEntry,
      context?: DeviceHost.DeviceOpenContext,
    ) => Effect.Effect<DeviceSummary, DevicePrepareError>;
    /**
     * Holds devices for a QA run until the scope closes. False, holding none, when another run
     * holds one of them; check them and claim in one step, since another run can take one between.
     */
    readonly claim: (
      entries: ReadonlyArray<DevicePoolEntry>,
      run: DevicePoolQaRun,
    ) => Effect.Effect<boolean, never, Scope.Scope>;
    readonly forget: (input: DeviceForgetInput) => Effect.Effect<void, DevicePoolError>;
  }
>()("t3/device/DevicePool") {}

// Wireless debugging lists `adb-<serial>-<suffix>._adb-tls-connect._tcp`; USB lists the bare serial.
const physicalSerial = (id: string) =>
  /^adb-(.+)-[^-.]+\._adb-tls-connect\._tcp\.?$/.exec(id)?.[1] ?? id;

// A stopped AVD is listed by name and a booted one by emulator serial; only the name is stable.
const poolKey = (device: DeviceSummary) =>
  [
    device.hostId,
    device.platform,
    device.physical
      ? physicalSerial(device.id)
      : device.platform === "android"
        ? `avd:${device.name}`
        : device.id,
  ].join("\u0000");

const formFactorFromName = (deviceName: string): DeviceFormFactor => {
  const lower = deviceName.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/);
  if (lower.includes("television") || words.includes("tv")) return "tv";
  if (words.some((word) => word === "watch" || word.startsWith("wear"))) return "watch";
  if (lower.includes("ipad") || words.some((word) => word === "tablet" || word === "tab"))
    return "tablet";
  if (words.some((word) => word === "desktop" || word === "automotive" || word === "vision"))
    return "other";
  return "phone";
};

// Physical devices only: emulators report just `emulator`, whatever their AVD's shape.
const formFactorFromCharacteristics = (output: string): DeviceFormFactor | null => {
  const traits = output
    .trim()
    .split(",")
    .map((trait) => trait.trim())
    .filter(Boolean);
  if (traits.length === 0) return null;
  if (traits.includes("tv")) return "tv";
  if (traits.includes("watch")) return "watch";
  if (traits.includes("automotive")) return "other";
  if (traits.includes("tablet")) return "tablet";
  return "phone";
};

const qaRunOf = (claims: ReadonlyMap<string, DevicePoolQaRun>, entryKey: string) => {
  const qaRun = claims.get(entryKey);
  return qaRun ? { qaRun } : {};
};

const snapshot = (
  state: DeviceServiceState,
  remembered: ReadonlyMap<string, RememberedDevice>,
  preparing: ReadonlySet<string>,
  claims: ReadonlyMap<string, DevicePoolQaRun>,
): DevicePoolSnapshot => {
  const entries: Array<DevicePoolEntry> = [];
  const listed = new Set<string>();
  for (const device of state.devices) {
    const entryKey = poolKey(device);
    if (listed.has(entryKey)) continue;
    listed.add(entryKey);
    const known = device.physical ? remembered.get(entryKey) : undefined;
    entries.push({
      key: entryKey,
      hostId: device.hostId,
      deviceId: device.id,
      platform: device.platform,
      name: device.name,
      version: device.version,
      physical: device.physical,
      formFactor: known?.formFactor ?? formFactorFromName(device.name),
      state: device.physical
        ? "connected"
        : preparing.has(entryKey) ||
            state.bootingDevices?.some(
              (booting) => booting.hostId === device.hostId && booting.id === device.id,
            )
          ? "starting"
          : device.booted
            ? "running"
            : "stopped",
      inUse: state.sessions.some(
        (session) => session.hostId === device.hostId && session.deviceId === device.id,
      ),
      ...qaRunOf(claims, entryKey),
      lastSeenAt: known?.lastSeenAt ?? null,
    });
  }
  const hosts = new Set(state.hosts.map((host) => host.id));
  for (const device of remembered.values()) {
    if (listed.has(device.key) || !hosts.has(device.hostId)) continue;
    entries.push({
      ...device,
      physical: true,
      state: "offline",
      inUse: false,
      ...qaRunOf(claims, device.key),
    });
  }
  return { entries };
};

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const deviceService = yield* DeviceService.DeviceService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(config.stateDir, POOL_FILE_NAME);

  const stored = yield* fileSystem.readFileString(filePath).pipe(
    Effect.flatMap(decodePoolFile),
    Effect.map((file) => file.devices),
    Effect.catch((cause) =>
      cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
        ? Effect.succeed([])
        : Effect.logWarning("Ignoring unreadable remembered devices", { cause }).pipe(
            Effect.as([]),
          ),
    ),
  );
  const remembered = new Map(stored.map((device) => [device.key, device]));
  /** Physical Android devices asked for their form factor while connected; asked again on reconnect. */
  const asked = new Set<string>();
  /** Devices QA is starting, which the device service does not report as booting. */
  const preparing = new Set<string>();
  /** Devices QA runs hold, by pool key, which stays the same while an emulator starts. */
  const claims = new Map<string, DevicePoolQaRun>();
  const lock = yield* Semaphore.make(1);
  // One start at a time: an AVD cannot run twice, and starts compete for the same machine.
  const prepareLock = yield* Semaphore.make(1);
  let latest = yield* deviceService.state;
  let listedDevices: DeviceServiceState["devices"] | null = null;
  const pool = yield* SubscriptionRef.make(snapshot(latest, remembered, preparing, claims));

  const persist = (devices: ReadonlyArray<RememberedDevice>) =>
    encodePoolFile({ version: 1, devices }).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new DevicePoolError({ cause })),
    );
  const persistOrWarn = Effect.suspend(() => persist([...remembered.values()])).pipe(
    Effect.catch((cause) => Effect.logWarning("Could not save remembered devices", { cause })),
  );

  const publish = Effect.gen(function* () {
    const next = snapshot(latest, remembered, preparing, claims);
    if (!Equal.equals(next, yield* SubscriptionRef.get(pool)))
      yield* SubscriptionRef.set(pool, next);
  });

  const detectFormFactors = Effect.fn("DevicePool.detectFormFactors")(function* () {
    let changed = false;
    for (const device of latest.devices) {
      const deviceKey = poolKey(device);
      if (!device.physical || device.platform !== "android" || asked.has(deviceKey)) continue;
      asked.add(deviceKey);
      const ready = yield* deviceService.currentReadiness(device.hostId);
      if (!ready) continue;
      const result = yield* ready.run(
        "adb",
        ["-s", device.id, "shell", "getprop", "ro.build.characteristics"],
        { timeoutMs: 5_000 },
      );
      const reported = result.code === 0 ? formFactorFromCharacteristics(result.stdout) : null;
      const known = remembered.get(deviceKey);
      if (!reported || !known || known.formFactor === reported) continue;
      remembered.set(deviceKey, { ...known, formFactor: reported });
      changed = true;
    }
    if (changed) yield* persistOrWarn;
  });

  const observe = Effect.fn("DevicePool.observe")(function* (state: DeviceServiceState) {
    latest = state;
    // DeviceService replaces `devices` only when a host lists them, so only a new
    // array shows that the devices in it are still there.
    if (state.devices !== listedDevices) {
      listedDevices = state.devices;
      const now = DateTime.formatIso(yield* DateTime.now);
      const listed = new Set(state.devices.map(poolKey));
      for (const device of state.devices) {
        if (!device.physical) continue;
        const deviceKey = poolKey(device);
        remembered.set(deviceKey, {
          key: deviceKey,
          hostId: device.hostId,
          deviceId: device.id,
          platform: device.platform,
          name: device.name,
          version: device.version,
          formFactor: remembered.get(deviceKey)?.formFactor ?? formFactorFromName(device.name),
          lastSeenAt: now,
        });
      }
      for (const askedKey of asked) if (!listed.has(askedKey)) asked.delete(askedKey);
      const oldest = [...remembered.values()]
        .toSorted((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .slice(MAX_REMEMBERED_DEVICES);
      for (const device of oldest) remembered.delete(device.key);
      if (state.devices.some((device) => device.physical) || oldest.length > 0)
        yield* persistOrWarn;
    }
    yield* publish;
    yield* detectFormFactors();
    yield* publish;
  }, lock.withPermit);

  const forget: DevicePool["Service"]["forget"] = Effect.fn("DevicePool.forget")(function* (input) {
    if (!remembered.has(input.key)) return;
    yield* persist([...remembered.values()].filter((device) => device.key !== input.key));
    remembered.delete(input.key);
    yield* publish;
  }, lock.withPermit);

  // Observing here, not only from the state stream, so the result includes this listing.
  const refresh = deviceService.list.pipe(
    Effect.catch(() => deviceService.state),
    Effect.flatMap(observe),
    Effect.andThen(SubscriptionRef.get(pool)),
  );

  const prepare: DevicePool["Service"]["prepare"] = Effect.fn("DevicePool.prepare")(function* (
    entry,
    context,
  ) {
    const fail = (detail: string, cause?: unknown) =>
      new DevicePrepareError({ device: entry.name, detail, cause });
    const listed = (state: DeviceServiceState) =>
      state.devices.find(
        (device) => device.hostId === entry.hostId && poolKey(device) === entry.key,
      );
    // A Device panel can be starting it already; a second start would launch the AVD twice.
    yield* DeviceService.stateStream(deviceService).pipe(
      Stream.filter(
        (state) =>
          !state.bootingDevices?.some(
            (booting) => booting.hostId === entry.hostId && poolKey(booting) === entry.key,
          ),
      ),
      Stream.runHead,
      Effect.timeoutOrElse({
        duration: BOOT_WAIT,
        orElse: () => Effect.fail(fail("A Device panel is still starting it.")),
      }),
    );
    const ready = yield* deviceService
      .readiness(entry.hostId)
      .pipe(Effect.mapError((cause) => fail(cause.message, cause)));
    let device = listed(yield* deviceService.list.pipe(Effect.catch(() => deviceService.state)));
    if (!device) return yield* fail("It is no longer listed. Refresh the device pool.");
    if (!device.booted) {
      const hostDevice = device;
      preparing.add(entry.key);
      yield* lock.withPermit(publish);
      const bootedId = yield* ready.devices.boot(hostDevice, context).pipe(
        Effect.mapError((cause) => fail(cause.message, cause)),
        Effect.ensuring(
          Effect.suspend(() => {
            preparing.delete(entry.key);
            return lock.withPermit(publish);
          }),
        ),
      );
      const state = yield* deviceService.list.pipe(Effect.catch(() => deviceService.state));
      device =
        state.devices.find(
          (candidate) => candidate.hostId === entry.hostId && candidate.id === bootedId,
        ) ?? listed(state);
      if (!device?.booted) return yield* fail("It stopped while starting.");
    }
    if (!device.physical) {
      // Booted is not ready: Android still starts its services, and a simulator its SpringBoard.
      const result = yield* device.platform === "android"
        ? ready.run(
            "adb",
            [
              "-s",
              device.id,
              "wait-for-device",
              "shell",
              'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done',
            ],
            { timeoutMs: Duration.toMillis(BOOT_WAIT) },
          )
        : ready.run("xcrun", ["simctl", "bootstatus", device.id], {
            timeoutMs: Duration.toMillis(BOOT_WAIT),
          });
      if (result.code !== 0)
        return yield* fail(
          `It did not finish starting within 5 minutes.${result.stderr.trim() ? `\n${result.stderr.trim()}` : ""}`,
        );
    }
    return device;
  }, prepareLock.withPermit);

  const claim: DevicePool["Service"]["claim"] = (entries, run) =>
    Effect.acquireRelease(
      lock.withPermit(
        Effect.suspend(() => {
          if (entries.some((entry) => claims.has(entry.key))) return Effect.succeed(false);
          for (const entry of entries) claims.set(entry.key, run);
          return publish.pipe(Effect.as(true));
        }),
      ),
      (claimed) =>
        claimed
          ? lock.withPermit(
              Effect.suspend(() => {
                for (const entry of entries) claims.delete(entry.key);
                return publish;
              }),
            )
          : Effect.void,
    );

  yield* DeviceService.stateStream(deviceService).pipe(
    Stream.runForEach(observe),
    Effect.forkScoped,
  );

  return DevicePool.of({
    stream: SubscriptionRef.changes(pool),
    refresh,
    simlockInventory: readSimlockInventory.pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
    ),
    prepare,
    claim,
    forget,
  });
});

export const layer = Layer.effect(DevicePool, make);
