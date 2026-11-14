import { assert, describe, expect, it } from "@effect/vitest";
import {
  LOCAL_DEVICE_HOST_ID,
  ProjectId,
  ThreadId,
  type DevicePoolEntry,
  type DeviceServiceState,
  type DeviceSummary,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerConfig from "../config.ts";
import * as DevicePool from "./DevicePool.ts";
import * as DeviceService from "./DeviceService.ts";

const tablet: DeviceSummary = {
  hostId: LOCAL_DEVICE_HOST_ID,
  id: "R52N51B9Y0L",
  platform: "android",
  name: "samsung SM-T515",
  version: "Android 11.0",
  booted: true,
  physical: true,
};
const stoppedAvd: DeviceSummary = {
  hostId: LOCAL_DEVICE_HOST_ID,
  id: "Tablet_7",
  platform: "android",
  name: "Tablet_7",
  version: "Android",
  booted: false,
  physical: false,
};

const deviceState = (
  devices: ReadonlyArray<DeviceSummary>,
  sessions: DeviceServiceState["sessions"] = [],
): DeviceServiceState => ({
  hosts: [
    {
      id: LOCAL_DEVICE_HOST_ID,
      kind: "local",
      label: "This machine",
      platforms: [{ platform: "android", available: true }],
      hubInstalled: true,
      agentDeviceInstalled: false,
    },
  ],
  hostStatus: "ready",
  hostStatuses: { [LOCAL_DEVICE_HOST_ID]: { status: "ready" } },
  devices,
  sessions,
  onboardingCompleted: true,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
});

const fixture = Effect.fn("fixture")(function* () {
  const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
  const states = yield* PubSub.unbounded<DeviceServiceState>();
  let current = deviceState([]);
  const commands: Array<ReadonlyArray<string>> = [];
  const reports = ["tablet", "tv"];
  const emit = (state: DeviceServiceState) =>
    Effect.suspend(() => {
      current = state;
      return PubSub.publish(states, state);
    });
  /** Completes the emulator start a pool asked for. */
  const booted = yield* Deferred.make<void>();
  const ready: DeviceService.DeviceReadiness = {
    hostId: LOCAL_DEVICE_HOST_ID,
    nodePath: process.execPath,
    hub: { origin: "http://device.test" },
    devices: {
      list: Effect.die("Device pools do not list devices"),
      boot: () =>
        Deferred.await(booted).pipe(
          Effect.andThen(emit(deviceState([{ ...stoppedAvd, id: "emulator-5554", booted: true }]))),
          Effect.as("emulator-5554"),
        ),
      attach: () => Effect.die("Device pools do not attach devices"),
      shutdown: () => Effect.die("Device pools do not shut down devices"),
      screenshot: () => Effect.die("Device pools do not take screenshots"),
    },
    helpers: { serveSimAxSettings: null, serveSimCli: null },
    run: (command, args) =>
      Effect.sync(() => {
        commands.push([command, ...args]);
        return {
          code: 0,
          stdout:
            command === "adb" && args.includes("getprop") ? `${reports.shift() ?? "tv"}\n` : "",
          stderr: "",
        };
      }),
  };
  const deviceService = Layer.mock(DeviceService.DeviceService)({
    state: Effect.sync(() => current),
    subscribe: PubSub.subscribe(states),
    list: Effect.suspend(() => emit(current)).pipe(Effect.andThen(Effect.sync(() => current))),
    readiness: () => Effect.succeed(ready),
    currentReadiness: () => Effect.succeed(ready),
  });
  /** Starts a pool on the same state directory, as a server restart does. */
  const start = Layer.build(
    DevicePool.layer.pipe(
      Layer.provide(deviceService),
      Layer.provide(Layer.mock(ProcessRunner.ProcessRunner)({})),
      Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    ),
  ).pipe(Effect.map((context) => Context.get(context, DevicePool.DevicePool)));
  return { start, emit, commands, booted };
});

const waitFor = (
  pool: DevicePool.DevicePool["Service"],
  done: (entries: ReadonlyArray<DevicePoolEntry>) => boolean,
) =>
  pool.stream.pipe(
    Stream.map((snapshot) => snapshot.entries),
    Stream.filter(done),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  );

describe("DevicePool", () => {
  it.effect("remembers a physical device as offline across restarts until it is forgotten", () =>
    Effect.gen(function* () {
      const { start, emit } = yield* fixture();
      const pool = yield* start;
      const listed = [tablet];
      yield* emit(deviceState(listed));
      yield* waitFor(pool, (entries) => entries[0]?.state === "connected");

      // A session change republishes the same listing; it is not evidence the device is still there.
      yield* TestClock.adjust("1 hour");
      yield* emit(
        deviceState(listed, [
          {
            threadId: ThreadId.make("thread"),
            hostId: LOCAL_DEVICE_HOST_ID,
            deviceId: tablet.id,
            platform: "android",
            openedAt: "1970-01-01T01:00:00.000Z",
          },
        ]),
      );
      yield* waitFor(pool, (entries) => entries[0]?.inUse === true);
      yield* emit(deviceState([]));
      const [offline] = yield* waitFor(pool, (entries) => entries[0]?.state === "offline");
      expect(offline).toMatchObject({
        name: "samsung SM-T515",
        physical: true,
        formFactor: "tablet",
        inUse: false,
        lastSeenAt: "1970-01-01T00:00:00.000Z",
      });

      const restarted = yield* start;
      yield* waitFor(restarted, (entries) => entries[0]?.state === "offline");
      yield* restarted.forget({ key: offline!.key });
      yield* waitFor(restarted, (entries) => entries.length === 0);
      const afterForget = yield* start;
      expect(yield* waitFor(afterForget, () => true)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps an emulator as one device when it boots under a serial", () =>
    Effect.gen(function* () {
      const { start, emit, commands } = yield* fixture();
      const pool = yield* start;
      yield* emit(deviceState([stoppedAvd]));
      const [stopped] = yield* waitFor(pool, (entries) => entries[0]?.state === "stopped");
      yield* emit(deviceState([{ ...stoppedAvd, id: "emulator-5554", booted: true }]));
      const [running] = yield* waitFor(pool, (entries) => entries[0]?.state === "running");
      expect(running).toMatchObject({
        key: stopped!.key,
        deviceId: "emulator-5554",
        formFactor: "tablet",
        lastSeenAt: null,
      });
      // Emulators report only `emulator`, so their form factor comes from the AVD name.
      expect(commands).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("holds a device for one QA run at a time, through its start, until the run ends", () =>
    Effect.gen(function* () {
      const { start, emit } = yield* fixture();
      const pool = yield* start;
      yield* emit(deviceState([stoppedAvd]));
      const [stopped] = yield* waitFor(pool, (entries) => entries[0]?.state === "stopped");
      const family = { projectId: ProjectId.make("app"), suiteId: "family", suiteName: "Family" };
      const run = yield* Scope.make();
      assert.isTrue(yield* pool.claim([stopped!], family).pipe(Scope.provide(run)));
      assert.isFalse(
        yield* pool.claim([stopped!], { ...family, suiteId: "b2c" }).pipe(Effect.scoped),
      );
      yield* emit(deviceState([{ ...stoppedAvd, id: "emulator-5554", booted: true }]));
      const [running] = yield* waitFor(pool, (entries) => entries[0]?.state === "running");
      expect(running?.qaRun).toEqual(family);
      yield* Scope.close(run, Exit.void);
      yield* waitFor(pool, (entries) => entries[0]?.qaRun === undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("asks a physical Android device for its form factor once per connection", () =>
    Effect.gen(function* () {
      const { start, emit, commands } = yield* fixture();
      const pool = yield* start;
      yield* emit(deviceState([tablet]));
      yield* waitFor(pool, (entries) => entries[0]?.formFactor === "tablet");
      yield* emit(deviceState([tablet]));
      yield* emit(deviceState([]));
      const [offline] = yield* waitFor(pool, (entries) => entries[0]?.state === "offline");
      expect(offline?.formFactor).toBe("tablet");
      // Asked again after reconnecting, so its second answer replaces the first.
      yield* emit(deviceState([tablet]));
      yield* waitFor(pool, (entries) => entries[0]?.formFactor === "tv");
      expect(commands).toEqual([
        ["adb", "-s", tablet.id, "shell", "getprop", "ro.build.characteristics"],
        ["adb", "-s", tablet.id, "shell", "getprop", "ro.build.characteristics"],
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts a stopped emulator for a run and returns it as listed once it is ready", () =>
    Effect.gen(function* () {
      const { start, emit, commands, booted } = yield* fixture();
      const pool = yield* start;
      yield* emit(deviceState([stoppedAvd]));
      const [stopped] = yield* waitFor(pool, (entries) => entries[0]?.state === "stopped");
      const preparing = yield* pool.prepare(stopped!).pipe(Effect.forkScoped);
      // The device service reports only Device panel starts, so the pool shows this one itself.
      yield* waitFor(pool, (entries) => entries[0]?.state === "starting");
      yield* Deferred.succeed(booted, undefined);
      expect(yield* Fiber.join(preparing)).toMatchObject({ id: "emulator-5554", booted: true });
      expect(commands).toEqual([
        [
          "adb",
          "-s",
          "emulator-5554",
          "wait-for-device",
          "shell",
          'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done',
        ],
      ]);
      const [running] = yield* waitFor(pool, (entries) => entries[0]?.state === "running");
      expect(running?.key).toBe(stopped!.key);

      yield* emit(deviceState([]));
      const gone = yield* pool.prepare(stopped!).pipe(Effect.flip);
      expect(gone.message).toBe(
        "Could not start Tablet_7. It is no longer listed. Refresh the device pool.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
