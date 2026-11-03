import {
  LOCAL_DEVICE_HOST_ID,
  qaDeviceRequirementKey,
  type DevicePoolEntry,
  type QaDeviceRequirement,
  type QaDeviceSelection,
  type QaSuite,
} from "@t3tools/contracts";

export interface QaDeviceAssignment {
  readonly key: string;
  readonly requirement: QaDeviceRequirement;
  /** Every pool device that fits, usable ones first in the order QA prefers them. */
  readonly candidates: ReadonlyArray<DevicePoolEntry>;
  /** The device a run uses; none blocks the suite, unless a run waits for `busy`. */
  readonly device: DevicePoolEntry | null;
  /** The device QA picks when nobody chose one. */
  readonly automatic: DevicePoolEntry | null;
  /** Held by another suite's run, and this suite waits for it: chosen, or the only one that fits. */
  readonly busy: DevicePoolEntry | null;
  /** The device someone chose, which can be offline or gone; the run then uses `automatic`. */
  readonly chosenKey: string | null;
}

const PLATFORM_LABELS = { ios: "iOS", android: "Android" } as const;
const FORM_FACTOR_LABELS = {
  phone: "phone",
  tablet: "tablet",
  tv: "TV",
  watch: "watch",
  other: "device",
} as const;

export function qaDeviceRequirementLabel(requirement: QaDeviceRequirement) {
  const platform = PLATFORM_LABELS[requirement.platform];
  const shape = requirement.formFactor ? FORM_FACTOR_LABELS[requirement.formFactor] : null;
  switch (requirement.type) {
    case "physical":
      return `Physical ${platform} ${shape ?? "device"}`;
    case "virtual":
      return [platform, shape, requirement.platform === "ios" ? "simulator" : "emulator"]
        .filter(Boolean)
        .join(" ");
    default:
      return `${platform} ${shape ?? "device"}`;
  }
}

/** QA commands run on the environment's machine, so only its own devices can serve them. */
function qaDeviceFits(requirement: QaDeviceRequirement, entry: DevicePoolEntry) {
  return (
    entry.hostId === LOCAL_DEVICE_HOST_ID &&
    entry.platform === requirement.platform &&
    (requirement.formFactor === undefined || entry.formFactor === requirement.formFactor) &&
    (requirement.type === "virtual"
      ? !entry.physical
      : requirement.type === "physical"
        ? entry.physical
        : true)
  );
}

const STATE_ORDER = { running: 0, connected: 0, starting: 1, stopped: 2, offline: 3 } as const;

// Virtual devices come first because they start from a known state; physical ones stay a choice.
const preference = (a: DevicePoolEntry, b: DevicePoolEntry) =>
  Number(a.state === "offline") - Number(b.state === "offline") ||
  Number(a.physical) - Number(b.physical) ||
  STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
  Number(a.inUse) - Number(b.inUse) ||
  b.version.localeCompare(a.version, undefined, { numeric: true }) ||
  a.name.localeCompare(b.name);

/** `projectId` names the suite's own run, whose devices stay its own while it runs. */
export function qaDeviceAssignments(
  suite: QaSuite,
  entries: ReadonlyArray<DevicePoolEntry>,
  selections: ReadonlyArray<QaDeviceSelection> = [],
  projectId?: string,
): ReadonlyArray<QaDeviceAssignment> {
  const heldByOther = ({ qaRun }: DevicePoolEntry) =>
    !!qaRun && (qaRun.projectId !== projectId || qaRun.suiteId !== suite.id);
  // A suite that needs two devices gets two different ones.
  const taken = new Set<string>();
  return (suite.devices ?? []).map((requirement, index) => {
    const key = qaDeviceRequirementKey(requirement, index);
    const candidates = entries.filter((entry) => qaDeviceFits(requirement, entry)).sort(preference);
    const usable = candidates.filter((entry) => entry.state !== "offline" && !taken.has(entry.key));
    const free = usable.filter((entry) => !heldByOther(entry));
    const automatic =
      free.find((entry) => entry.name === requirement.defaultDevice) ?? free[0] ?? null;
    const chosenKey =
      selections.find(
        (selection) => selection.suiteId === suite.id && selection.requirement === key,
      )?.deviceKey ?? null;
    // Someone chose this device, so a run waits for it; an offline or missing one falls back.
    const chosen = usable.find((entry) => entry.key === chosenKey);
    const device = chosen ? (heldByOther(chosen) ? null : chosen) : automatic;
    const busy = device
      ? null
      : (chosen ??
        usable.find((entry) => entry.name === requirement.defaultDevice) ??
        usable[0] ??
        null);
    const used = device ?? busy;
    if (used) taken.add(used.key);
    return { key, requirement, candidates, device, automatic, busy, chosenKey };
  });
}

export function qaDeviceUnavailableReason({ requirement, candidates }: QaDeviceAssignment) {
  const offline = candidates.filter((entry) => entry.state === "offline").map(({ name }) => name);
  const hint =
    requirement.platform === "ios"
      ? requirement.type === "physical"
        ? "Connect one to this machine."
        : "Create a simulator in Xcode."
      : requirement.type === "physical"
        ? "Connect one with USB debugging on."
        : requirement.type === "virtual"
          ? "Create an emulator in Android Studio."
          : "Connect one with USB debugging on, or create an emulator in Android Studio.";
  return [
    `No ${qaDeviceRequirementLabel(requirement).replace(/^Physical/, "physical")} is available.`,
    offline.length ? `${offline.join(", ")} ${offline.length === 1 ? "is" : "are"} offline.` : "",
    hint,
  ]
    .filter(Boolean)
    .join(" ");
}
