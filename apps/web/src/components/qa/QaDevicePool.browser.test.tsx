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

vi.mock("../../state/device", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    deviceEnvironment: {
      pool: ({ environmentId }: { environmentId: string }) => ({ kind: "pool", environmentId }),
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

const devices = (): DeviceServiceState => ({
  hosts: [],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: true,
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

it("shows the environment's devices, the QA run holding each, and filters them", async () => {
  state.devices = { laptop: devices() };
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
  };
  await using screen = await render(
    <QaDevicePool environmentId={EnvironmentId.make("laptop")} environmentLabel="MacBook" />,
    { router: false },
  );

  await expect
    .element(screen.getByText("Simulators, emulators, and physical devices on MacBook"))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /All devices/ }))
    .toHaveTextContent("All devices2");
  await expect.element(screen.getByText("In use by Senior B2C")).toBeVisible();

  await screen.getByRole("button", { name: /Available now/ }).click();
  await expect.element(screen.getByText("Tablet_7")).toBeVisible();
  await expect.element(screen.getByText("Television_1080p")).not.toBeInTheDocument();
});
