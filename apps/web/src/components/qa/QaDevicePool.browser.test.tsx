import {
  EnvironmentId,
  ProjectId,
  type DevicePoolEntry,
  type DeviceSimlockInventory,
  type DeviceServiceState,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import "~/index.css";
import { render } from "../../../test/render";
import { QaDevicePool, QaSimlockNote } from "./QaDevicePool";

const state = vi.hoisted(() => ({
  inventories: {} as Record<string, DeviceSimlockInventory>,
  refreshes: [] as string[],
  pools: {} as Record<string, DevicePoolEntry[]>,
  devices: {} as Record<string, DeviceServiceState>,
}));

vi.mock("../../state/device", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    deviceEnvironment: {
      pool: ({ environmentId }: { environmentId: string }) => ({ kind: "pool", environmentId }),
      simlockInventory: ({ environmentId }: { environmentId: string }) => ({
        kind: "simlock",
        environmentId,
      }),
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
  useEnvironmentQuery: (query: { environmentId: string; kind: string }) => ({
    data:
      query.kind === "simlock"
        ? state.inventories[query.environmentId]
        : { entries: state.pools[query.environmentId] ?? [] },
    error: null,
    isPending: false,
    refresh: () => {
      state.refreshes.push(query.environmentId);
    },
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

it("keeps the catalogue collapsed and searches it without mixing QA environments", async () => {
  state.refreshes = [];
  state.inventories = {
    laptop: {
      scannedAt: "2026-11-14T10:00:00.000Z",
      devices: [],
      hiddenDeletedCount: 5,
      issues: [],
      models: [
        { platform: "ios", name: "iPad Pro", formFactor: "tablet", runtimes: ["26.2"] },
        { platform: "android", name: "Pixel", formFactor: "phone", runtimes: ["35"] },
      ],
    },
    remote: {
      scannedAt: "2026-11-14T10:00:00.000Z",
      devices: [],
      hiddenDeletedCount: 0,
      issues: ["Simlock devices: unavailable"],
      models: [],
    },
  };
  await using screen = await render(
    <QaSimlockNote environmentId={EnvironmentId.make("laptop")} environmentLabel="Laptop" />,
    // The inventory has no routes; the selected environment is supplied by the QA page.
    { router: false },
  );
  await expect.element(screen.getByLabelText("Search device models")).not.toBeVisible();
  await screen.getByText("Models available to create (2)").click();
  await screen.getByRole("textbox", { name: "Search device models" }).fill("ipad");
  await expect.element(screen.getByText("Android · phone (1)")).not.toBeInTheDocument();
  await screen.getByText("iOS · tablet (1)").click();
  await expect.element(screen.getByText("iPad Pro", { exact: false })).toBeVisible();
  await screen.getByRole("button", { name: "Refresh devices" }).click();
  expect(state.refreshes).toEqual(["laptop"]);
  await screen.rerender(
    <QaSimlockNote environmentId={EnvironmentId.make("remote")} environmentLabel="Remote" />,
  );
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Simlock devices: unavailable");
  await expect.element(screen.getByText("iPad Pro", { exact: false })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Refresh devices" }).click();
  expect(state.refreshes).toEqual(["laptop", "remote"]);
});
