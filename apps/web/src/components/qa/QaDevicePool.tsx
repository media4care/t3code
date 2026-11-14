import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  ActivityIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  LayersIcon,
  MonitorSmartphoneIcon,
  PlugZapIcon,
  PowerIcon,
  RefreshCwIcon,
  UnplugIcon,
  XIcon,
} from "lucide-react";
import type { DevicePoolEntry, DeviceServiceState, EnvironmentId } from "@t3tools/contracts";
import {
  DEVICE_FORM_FACTOR_LABELS,
  DEVICE_POOL_STATE_LABELS,
  devicePoolCounts,
  devicePoolGroups,
  devicePoolKind,
  type DevicePoolFilter,
} from "@t3tools/client-runtime/device/pool";
import {
  deviceEnvironment,
  deviceHostProbeAtom,
  NO_DEVICE_PROBE_ATOM,
  useDeviceState,
} from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { DeviceSetup, deviceHubReadiness } from "../device/DeviceSetup";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { WizardPopup } from "../ui/wizard";
import { DEVICE_FORM_FACTOR_ICONS } from "./deviceIcons";

const METRICS = [
  {
    key: "all",
    label: "All devices",
    icon: LayersIcon,
    color: "bg-primary/5 text-foreground",
  },
  {
    key: "ready",
    label: "Available now",
    icon: PlugZapIcon,
    color: "bg-success/8 text-success-foreground",
  },
  {
    key: "startable",
    label: "Ready to start",
    icon: PowerIcon,
    color: "bg-info/8 text-info-foreground",
  },
  {
    key: "offline",
    label: "Offline",
    icon: UnplugIcon,
    color: "bg-muted/60 text-muted-foreground",
  },
] as const;

const hostFailures = (state: DeviceServiceState) =>
  state.hosts.flatMap((host) => {
    const status = state.hostStatuses[host.id];
    return status?.status === "failed"
      ? [{ id: host.id, label: host.label, detail: status.detail ?? "Device support failed." }]
      : [];
  });

/** The QA environment's pool: its suites run on its own machine, so only its devices count. */
export function QaDevicePool({
  environmentId,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
}) {
  const { state, loaded } = useDeviceState(environmentId);
  const pool = useEnvironmentQuery(deviceEnvironment.pool({ environmentId, input: {} }));
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const [filter, setFilter] = useState<DevicePoolFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const needsSetup = loaded && (!state.onboardingCompleted || state.hostStatus === "disabled");
  useAtomMount(loaded && !needsSetup ? deviceHostProbeAtom(environmentId) : NO_DEVICE_PROBE_ATOM);

  const entries = needsSetup ? [] : (pool.data?.entries ?? []);
  const hostLabels = new Map(state.hosts.map((host) => [host.id, host.label]));
  const counts = devicePoolCounts(entries);
  const { busy } = deviceHubReadiness(state);
  const failures = needsSetup ? [] : hostFailures(state);

  const refresh = () => {
    setRefreshing(true);
    void list({ environmentId, input: {} }).finally(() => setRefreshing(false));
  };

  return (
    <section
      aria-label="Device pool"
      className="@container/device-pool min-w-0 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <MonitorSmartphoneIcon className="size-5 text-primary" />
            <h3 className="font-semibold">Device pool</h3>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Simulators, emulators, and physical devices on {environmentLabel}
          </p>
        </div>
        {needsSetup ? (
          <Button size="sm" onClick={() => setSetupOpen(true)}>
            Set up devices
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={refreshing || busy} onClick={refresh}>
            {refreshing || busy ? <Spinner size="xs" /> : <RefreshCwIcon />}
            Refresh devices
          </Button>
        )}
      </div>
      {needsSetup ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Turn on device support to see the simulators and emulators you can start and the Android
          devices connected over ADB.
        </p>
      ) : null}
      {failures.map((failure) => (
        <p
          key={failure.id}
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg bg-warning/8 px-3 py-2 text-xs text-warning-foreground"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-line break-words">
            <span className="font-medium">{failure.label}:</span> {failure.detail}
          </span>
        </p>
      ))}
      {entries.length > 0 ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 @2xl/device-pool:grid-cols-4 @2xl/device-pool:gap-3">
            {METRICS.map(({ key, label, icon: Icon, color }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(filter === key ? "all" : key)}
                className={cn(
                  "rounded-xl p-3 text-left -outline-offset-2 ring-inset hover:ring-1 hover:ring-current/30 focus-visible:outline-2 focus-visible:outline-ring",
                  color,
                  filter === key && "ring-1 ring-current/60 hover:ring-current/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{label}</span>
                  <Icon className="size-4 shrink-0 opacity-75" />
                </div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums">{counts[key]}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-6">
            {devicePoolGroups(entries, filter).length > 0 ? (
              <DeviceGroups
                environmentId={environmentId}
                entries={entries}
                filter={filter}
                hostLabels={hostLabels}
              />
            ) : (
              <NoDevicesInState onShowAll={() => setFilter("all")} />
            )}
          </div>
        </>
      ) : needsSetup ? null : busy || !pool.data ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Finding devices…
        </p>
      ) : failures.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-center">
          <p className="text-sm font-medium">No devices found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a simulator in Xcode or an emulator in Android Studio, or connect an Android
            device with USB debugging on, then refresh.
          </p>
        </div>
      ) : null}
      <Dialog open={setupOpen && needsSetup} onOpenChange={setSetupOpen}>
        <WizardPopup>
          <DeviceSetup
            environmentId={environmentId}
            state={state}
            onComplete={() => setSetupOpen(false)}
          />
        </WizardPopup>
      </Dialog>
    </section>
  );
}

function DeviceGroups({
  environmentId,
  entries,
  filter,
  hostLabels,
}: {
  environmentId: EnvironmentId;
  entries: ReadonlyArray<DevicePoolEntry>;
  filter: DevicePoolFilter;
  hostLabels: ReadonlyMap<string, string>;
}) {
  const forget = useAtomCommand(deviceEnvironment.forget);
  const canForget = useAtomValue(deviceEnvironment.forget.permissionAtom(environmentId));
  const showHosts = new Set(entries.map((entry) => entry.hostId)).size > 1;
  return devicePoolGroups(entries, filter).map((group) => (
    <details key={group.id} open className="group/devices">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <h4 className="text-sm font-semibold">{group.label}</h4>
        <span className="text-xs text-muted-foreground">{group.entries.length}</span>
        <ChevronDownIcon className="ml-auto size-4 -rotate-90 text-muted-foreground group-open/devices:rotate-0" />
      </summary>
      <div className="mt-2 grid gap-2 @xl/device-pool:grid-cols-2 @4xl/device-pool:grid-cols-3">
        {group.entries.map((entry) => (
          <DeviceCard
            key={entry.key}
            entry={entry}
            hostLabel={showHosts ? hostLabels.get(entry.hostId) : undefined}
            canForget={canForget}
            onForget={() => void forget({ environmentId, input: { key: entry.key } })}
          />
        ))}
      </div>
    </details>
  ));
}

function NoDevicesInState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <p className="text-sm text-muted-foreground">
      No devices in this state.{" "}
      <button
        type="button"
        className="text-foreground underline underline-offset-2"
        onClick={onShowAll}
      >
        Show all devices
      </button>
    </p>
  );
}

function DeviceCard({
  entry,
  hostLabel,
  canForget,
  onForget,
}: {
  entry: DevicePoolEntry;
  hostLabel: string | undefined;
  canForget: boolean;
  onForget: () => void;
}) {
  const Icon = DEVICE_FORM_FACTOR_ICONS[entry.formFactor];
  const offline = entry.state === "offline";
  return (
    <div
      aria-label={entry.name}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border p-3",
        offline ? "border-dashed border-border bg-muted/20" : "border-border bg-background",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          offline
            ? "bg-muted text-muted-foreground"
            : entry.platform === "ios"
              ? "bg-info/8 text-info-foreground"
              : "bg-success/8 text-success-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "break-words text-sm font-medium leading-snug",
            offline && "text-muted-foreground",
          )}
        >
          {entry.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            DEVICE_FORM_FACTOR_LABELS[entry.formFactor],
            entry.version,
            entry.physical ? null : devicePoolKind(entry),
            hostLabel,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DeviceStateBadge entry={entry} />
          {entry.qaRun ? (
            <Badge variant="info" className="max-w-full">
              <FlaskConicalIcon />
              <span className="truncate">In use by {entry.qaRun.suiteName}</span>
            </Badge>
          ) : null}
          {entry.inUse ? <Badge variant="outline">In use</Badge> : null}
          {offline && entry.lastSeenAt ? (
            <span className="text-xs text-muted-foreground">
              Last seen{" "}
              <time dateTime={entry.lastSeenAt}>
                {new Date(entry.lastSeenAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </span>
          ) : null}
        </div>
      </div>
      {offline && canForget ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Forget ${entry.name}`}
          onClick={onForget}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

function DeviceStateBadge({ entry }: { entry: DevicePoolEntry }) {
  const label = DEVICE_POOL_STATE_LABELS[entry.state];
  switch (entry.state) {
    case "running":
    case "connected":
      return (
        <Badge variant="success">
          <span aria-hidden className="size-1.5 rounded-full bg-current" /> {label}
        </Badge>
      );
    case "starting":
      return (
        <Badge variant="info">
          <ActivityIcon /> {label}
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="secondary">
          <PowerIcon /> {label}
        </Badge>
      );
    case "offline":
      return (
        <Badge variant="outline">
          <UnplugIcon /> {label}
        </Badge>
      );
  }
}

export { QaSimlockNote } from "./QaSimlockInventory";
