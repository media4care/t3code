import type { DeviceFormFactor, DevicePoolEntry } from "@t3tools/contracts";

export type DevicePoolFilter = "all" | "ready" | "startable" | "offline";

export const devicePoolCategory = (entry: DevicePoolEntry): Exclude<DevicePoolFilter, "all"> =>
  entry.state === "offline"
    ? "offline"
    : entry.state === "stopped" || entry.state === "starting"
      ? "startable"
      : "ready";

export const DEVICE_POOL_CATEGORY_LABELS: Record<Exclude<DevicePoolFilter, "all">, string> = {
  ready: "Available now",
  startable: "Ready to start",
  offline: "Offline",
};

export function devicePoolCounts(entries: ReadonlyArray<DevicePoolEntry>) {
  const counts = { all: entries.length, ready: 0, startable: 0, offline: 0 };
  for (const entry of entries) counts[devicePoolCategory(entry)] += 1;
  return counts;
}

export const DEVICE_POOL_STATE_LABELS: Record<DevicePoolEntry["state"], string> = {
  running: "Running",
  connected: "Connected",
  starting: "Starting…",
  stopped: "Ready to start",
  offline: "Offline",
};

export const DEVICE_FORM_FACTOR_LABELS: Record<DeviceFormFactor, string> = {
  phone: "Phone",
  tablet: "Tablet",
  tv: "TV",
  watch: "Watch",
  other: "Device",
};

export const devicePoolKind = (entry: DevicePoolEntry) =>
  entry.physical ? "Physical device" : entry.platform === "ios" ? "Simulator" : "Emulator";

const STATE_ORDER: Record<DevicePoolEntry["state"], number> = {
  running: 0,
  connected: 0,
  starting: 1,
  stopped: 2,
  offline: 3,
};

/** Physical devices first, then simulators and emulators; usable devices lead each group. */
export function devicePoolGroups(
  entries: ReadonlyArray<DevicePoolEntry>,
  filter: DevicePoolFilter,
) {
  const visible = entries
    .filter((entry) => filter === "all" || devicePoolCategory(entry) === filter)
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.platform.localeCompare(b.platform) ||
        a.name.localeCompare(b.name) ||
        b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  return [
    {
      id: "physical",
      label: "Physical devices",
      entries: visible.filter((entry) => entry.physical),
    },
    {
      id: "virtual",
      label: "Simulators and emulators",
      entries: visible.filter((entry) => !entry.physical),
    },
  ].filter((group) => group.entries.length > 0);
}
