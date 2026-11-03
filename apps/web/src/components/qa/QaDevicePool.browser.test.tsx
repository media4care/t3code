import {
  EnvironmentId,
  ProjectId,
  type DevicePoolEntry,
  type DeviceServiceState,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import "~/index.css";
import { render } from "../../../test/render";
import { QaDevicePool } from "./QaDevicePool";

const state = vi.hoisted(() => ({
  pools: {} as Record<string, DevicePoolEntry[]>,
  devices: {} as Record<string, DeviceServiceState>,
}));

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      { environmentId: "laptop", label: "MacBook", connection: { phase: "connected" } },
      { environmentId: "mini", label: "mac-mini", connection: { phase: "connected" } },
      { environmentId: "old", label: "Old laptop", connection: { phase: "connected" } },
      { environmentId: "studio", label: "Studio", connection: { phase: "disconnected" } },
    ],
  }),
}));
vi.mock("../../state/device", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    deviceEnvironment: {
      pool: ({ environmentId }: { environmentId: string }) => ({ kind: "pool", environmentId }),
      state: ({ environmentId }: { environmentId: string }) => ({ kind: "state", environmentId }),
      list: { kind: "list" },
      forget: { kind: "forget", permissionAtom: () => Atom.make(true) },
    },
    deviceHostProbeAtom: () => Atom.make(null),
    NO_DEVICE_PROBE_ATOM: Atom.make(null),
    useDeviceState: (environmentId: string) => ({
      state: state.devices[environmentId],
      loaded: true,
      error: null,
      refresh: () => {},
    }),
  };
});
vi.mock("../../state/environmentAtomList", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    environmentIdsKey: (ids: ReadonlyArray<string>) => ids.join("\n"),
    environmentAtomList: (
      _label: string,
      atom: (environmentId: string) => { kind: string; environmentId: string },
    ) =>
      Atom.family((key: string) =>
        Atom.make(
          (key === "" ? [] : key.split("\n")).map((environmentId) =>
            atom(environmentId).kind === "pool"
              ? AsyncResult.success({ entries: state.pools[environmentId] ?? [] })
              : AsyncResult.success(state.devices[environmentId]),
          ),
        ),
      ),
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { environmentId: string }) => ({
    data: { entries: state.pools[query.environmentId] ?? [] },
    error: null,
    isPending: false,
    refresh: () => {},
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => async () => {} }));
vi.mock("../device/DeviceSetup", () => ({
  DeviceSetup: () => null,
  deviceHubReadiness: () => ({ busy: false }),
}));

const devices = (onboardingCompleted = true): DeviceServiceState => ({
  hosts: [],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
});
const device = (value: Pick<DevicePoolEntry, "key" | "name"> & Partial<DevicePoolEntry>) => ({
  hostId: "local",
  deviceId: value.key,
  platform: "android" as const,
  version: "Android 16",
  physical: false,
  formFactor: "tablet" as const,
  state: "stopped" as const,
  inUse: false,
  lastSeenAt: null,
  ...value,
});

it("shows the devices of every connected environment and the QA run holding each", async () => {
  state.devices = { laptop: devices(), mini: devices(), old: devices(false) };
  state.pools = {
    laptop: [
      device({
        key: "tablet7",
        name: "Tablet_7",
        state: "running",
        qaRun: { projectId: ProjectId.make("app"), suiteId: "b2c", suiteName: "Senior B2C" },
      }),
      device({ key: "tv", name: "Television_1080p", formFactor: "tv" }),
    ],
    mini: [
      device({
        key: "ipad",
        name: "iPad Pro 11-inch (M4)",
        platform: "ios",
        version: "iOS 26.0",
      }),
    ],
  };
  await using screen = await render(
    <QaDevicePool environmentId={EnvironmentId.make("laptop")} environmentLabel="MacBook" />,
    { router: false },
  );

  await expect
    .element(
      screen.getByText("Simulators, emulators, and physical devices on MacBook and mac-mini"),
    )
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /All devices/ }))
    .toHaveTextContent("All devices3");
  const laptop = screen.getByRole("region", { name: "Devices on MacBook" });
  await expect.element(laptop.getByText("This project runs its suites here")).toBeVisible();
  await expect.element(laptop.getByText("In use by Senior B2C")).toBeVisible();
  const mini = screen.getByRole("region", { name: "Devices on mac-mini" });
  await expect.element(mini.getByText("iPad Pro 11-inch (M4)")).toBeVisible();
  // An environment with devices off gets a note, and a disconnected one is left out.
  await expect.element(screen.getByText(/^Devices are off on Old laptop\./)).toBeVisible();
  await expect.element(screen.getByText(/Studio/)).not.toBeInTheDocument();

  // The filters apply to every environment.
  await screen.getByRole("button", { name: /Available now/ }).click();
  await expect.element(laptop.getByText("Tablet_7")).toBeVisible();
  await expect.element(laptop.getByText("Television_1080p")).not.toBeInTheDocument();
  await expect.element(mini.getByText("No devices in this state.")).toBeVisible();
});
