import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";
import { ThreadId } from "@t3tools/contracts";
import * as ProcessRunner from "../processRunner.ts";
import { readSimlockInventory } from "./simlockInventory.ts";

const record = (id: string, state: string, physical = true) => ({
  id: `dev-${id}`,
  driverDeviceId: id,
  state,
  physical,
  spec: { platform: "android", model: "Galaxy Tab", osVersion: "30" },
});
const scan = (
  devices: unknown,
  adb: string,
  catalog: unknown = { platforms: [] },
  simlockOutput: Partial<ProcessRunner.ProcessRunOutput> = {},
  leases: unknown = [],
  sessions: Parameters<typeof readSimlockInventory>[0] = [],
) => {
  const calls: string[][] = [];
  const layer = Layer.mock(ProcessRunner.ProcessRunner)({
    run: ({ command, args }) => {
      calls.push([command, ...args]);
      return Effect.succeed({
        stdout:
          command === "adb"
            ? adb
            : JSON.stringify(
                args.includes("catalog") ? catalog : args.includes("--leases") ? leases : devices,
              ),
        stderr: "",
        code: ChildProcessSpawner.ExitCode(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
        ...(command === "simlock" ? simlockOutput : {}),
      });
    },
  });
  return readSimlockInventory(sessions).pipe(
    Effect.provide(layer),
    Effect.map((result) => ({ result, calls })),
  );
};

it.effect(
  "shows unauthorized and unenrolled tablets without calling them available; merges enrolled serials",
  () =>
    Effect.gen(function* () {
      const { result, calls } = yield* scan(
        [
          record("enrolled", "ready"),
          record("missing", "absent"),
          record("old", "deleted", false),
          record("busy", "leased", false),
        ],
        "List of devices attached\nenrolled unauthorized usb:1\nnew device product:tab model:SM_T515\noffline offline\nemulator-5554 device model:virtual\n",
      );
      expect(result.devices.map((d) => [d.id, d.state, d.enrolled])).toEqual([
        ["enrolled", "unauthorized", true],
        ["missing", "absent", true],
        ["busy", "leased", true],
        ["new", "connected", false],
        ["offline", "offline", false],
      ]);
      expect(result.hiddenDeletedCount).toBe(1);
      expect(result.devices[0]?.detail).toContain("debugging");
      expect(result.devices[0]?.simlockState).toBe("ready");
      expect(calls).toEqual(
        expect.arrayContaining([
          ["simlock", "--local", "list"],
          ["simlock", "--local", "list", "--leases"],
          ["simlock", "--local", "catalog", "--json"],
          ["adb", "devices", "-l"],
        ]),
      );
    }),
);
it.effect("keeps model definitions out of the device list, and shows missing runtimes", () =>
  Effect.gen(function* () {
    const { result } = yield* scan([], "List of devices attached\n", {
      platforms: [
        {
          platform: "ios",
          models: ["iPad", "iPhone"],
          modelRuntimes: { iPad: ["26.2"], iPhone: [] },
          modelClasses: { iPad: "tablet", iPhone: "phone" },
        },
      ],
    });
    expect(result.devices).toEqual([]);
    expect(result.models).toEqual([
      { platform: "ios", name: "iPad", formFactor: "tablet", runtimes: ["26.2"] },
      { platform: "ios", name: "iPhone", formFactor: "phone", runtimes: [] },
    ]);
  }),
);
it.effect("preserves ADB evidence when the Simlock response is malformed", () =>
  Effect.gen(function* () {
    const { result } = yield* scan({ wrong: true }, "List of devices attached\nusb unauthorized\n");
    expect(result.devices).toEqual([
      expect.objectContaining({ id: "usb", enrolled: null, state: "unauthorized" }),
    ]);
    expect(result.issues).toEqual([expect.stringContaining("Simlock devices")]);
  }),
);

it.effect("reports failed or truncated sources without losing physical connection evidence", () =>
  Effect.gen(function* () {
    for (const failure of [
      { code: ChildProcessSpawner.ExitCode(1) },
      { timedOut: true },
      { stdoutTruncated: true },
    ]) {
      const { result } = yield* scan(
        [],
        "List of devices attached\nusb offline\n",
        { platforms: [] },
        failure,
      );
      expect(result.devices).toEqual([
        expect.objectContaining({ id: "usb", state: "offline", enrolled: null }),
      ]);
      expect(result.issues).toHaveLength(3);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Simlock devices"),
          expect.stringContaining("Simlock leases"),
          expect.stringContaining("Simlock models"),
        ]),
      );
    }
  }),
);

it.effect("names who holds each leased device: a thread here, a QA run, or the requester", () =>
  Effect.gen(function* () {
    const { result } = yield* scan(
      [
        record("thread-tv", "leased", false),
        record("qa-tablet", "leased", false),
        record("cli-phone", "leased"),
        record("free", "ready"),
      ],
      "List of devices attached\n",
      { platforms: [] },
      {},
      [
        { id: "lse_tv", deviceId: "dev-thread-tv", requesterId: "gw:a:token", label: "checkout" },
        { id: "lse_qa", deviceId: "dev-qa-tablet", requesterId: "t3-qa-run1-android-0" },
        { id: "lse_cli", deviceId: "dev-cli-phone", requesterId: "claude-code:abc" },
      ],
      [{ threadId: ThreadId.make("thread-1"), deviceId: "worker-1.lse_tv" }],
    );
    expect(result.devices.map((device) => [device.id, device.lease])).toEqual([
      [
        "thread-tv",
        {
          id: "lse_tv",
          label: "checkout",
          holder: { type: "thread", threadId: "thread-1" },
        },
      ],
      ["qa-tablet", { id: "lse_qa", label: null, holder: { type: "qa-run" } }],
      [
        "cli-phone",
        {
          id: "lse_cli",
          label: null,
          holder: { type: "requester", requesterId: "claude-code:abc" },
        },
      ],
      ["free", undefined],
    ]);
    expect(result.issues).toEqual([]);
  }),
);
