import { describe, expect, it } from "vite-plus/test";
import { LOCAL_DEVICE_HOST_ID, type DevicePoolEntry, type QaSuite } from "@t3tools/contracts";

import {
  qaDeviceAssignments,
  qaDeviceRequirementLabel,
  qaDeviceUnavailableReason,
} from "./qaDevices.ts";

const device = (value: Pick<DevicePoolEntry, "key" | "name"> & Partial<DevicePoolEntry>) => ({
  hostId: LOCAL_DEVICE_HOST_ID,
  deviceId: value.key,
  platform: "android" as const,
  version: "Android",
  physical: false,
  formFactor: "tablet" as const,
  state: "stopped" as const,
  inUse: false,
  lastSeenAt: null,
  ...value,
});

const stoppedAvd = device({ key: "avd", name: "Pixel_Tablet" });
const runningAvd = device({ key: "running", name: "Tablet_7", state: "running" });
const samsung = device({
  key: "samsung",
  name: "samsung SM-T515",
  physical: true,
  state: "connected",
});
const suite = (devices: QaSuite["devices"]): QaSuite => ({
  id: "flows",
  name: "Flows",
  command: "maestro test flows",
  ...(devices ? { devices } : {}),
});
const names = (assignments: ReturnType<typeof qaDeviceAssignments>) =>
  assignments.map((assignment) => assignment.device?.name ?? null);

describe("qaDeviceAssignments", () => {
  it("prefers emulators, then running ones, and skips devices a local command cannot reach", () => {
    const remote = device({ key: "remote", name: "Remote", hostId: "mac-mini", state: "running" });
    const phone = device({
      key: "phone",
      name: "Medium_Phone",
      formFactor: "phone",
      state: "running",
    });
    const [tablet] = qaDeviceAssignments(suite([{ platform: "android", formFactor: "tablet" }]), [
      samsung,
      stoppedAvd,
      remote,
      phone,
      runningAvd,
    ]);
    expect(tablet?.device?.name).toBe("Tablet_7");
    expect(tablet?.candidates.map(({ name }) => name)).toEqual([
      "Tablet_7",
      "Pixel_Tablet",
      "samsung SM-T515",
    ]);
  });

  it("uses a chosen device while it is available and otherwise the default device", () => {
    const flows = suite([{ id: "tablet", platform: "android", defaultDevice: "Pixel_Tablet" }]);
    const chosen = [{ suiteId: "flows", requirement: "tablet", deviceKey: "samsung" }];
    expect(names(qaDeviceAssignments(flows, [runningAvd, stoppedAvd, samsung]))).toEqual([
      "Pixel_Tablet",
    ]);
    const [assignment] = qaDeviceAssignments(flows, [runningAvd, stoppedAvd, samsung], chosen);
    expect(assignment).toMatchObject({ chosenKey: "samsung", device: samsung });
    expect(assignment?.automatic?.name).toBe("Pixel_Tablet");
    const offline = { ...samsung, state: "offline" as const };
    expect(names(qaDeviceAssignments(flows, [runningAvd, stoppedAvd, offline], chosen))).toEqual([
      "Pixel_Tablet",
    ]);
  });

  it("gives each requirement its own device and blocks the one left without", () => {
    const pair = suite([
      { id: "host", platform: "android" },
      { id: "guest", platform: "android" },
      { id: "watcher", platform: "android", type: "physical" },
    ]);
    expect(names(qaDeviceAssignments(pair, [runningAvd, samsung]))).toEqual([
      "Tablet_7",
      "samsung SM-T515",
      null,
    ]);
  });
});

describe("qaDeviceUnavailableReason", () => {
  it("names the missing device, the known ones that are offline, and how to add one", () => {
    const [missing] = qaDeviceAssignments(
      suite([{ platform: "android", formFactor: "tablet", type: "physical" }]),
      [{ ...samsung, state: "offline" }, stoppedAvd],
    );
    expect(qaDeviceUnavailableReason(missing!)).toBe(
      "No physical Android tablet is available. samsung SM-T515 is offline. Connect one with USB debugging on.",
    );
    expect(qaDeviceRequirementLabel({ platform: "ios", type: "virtual" })).toBe("iOS simulator");
    expect(qaDeviceRequirementLabel({ platform: "ios", formFactor: "tablet" })).toBe("iOS tablet");
  });
});
