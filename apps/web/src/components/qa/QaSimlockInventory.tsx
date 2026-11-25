import { useState } from "react";
import { MonitorSmartphoneIcon, RefreshCwIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { DeviceSimlockInventory, EnvironmentId } from "@t3tools/contracts";
import { qaWhen } from "@t3tools/client-runtime/qa";
import { androidReleaseForApiLevel } from "@t3tools/shared/qaDevices";
import { deviceEnvironment } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ThreadContextChip } from "../ThreadContextChip";
import { DEVICE_FORM_FACTOR_ICONS } from "./deviceIcons";

const stateLabels: Record<string, string> = {
  ready: msg("Available", { $context: "device state" }),
  leased: msg("Leased", { $context: "device state" }),
  provisioning: msg("Starting", { $context: "device state" }),
  reclaiming: msg("Returning", { $context: "device state, going back to the pool" }),
  quarantined: msg("Quarantined", { $context: "device state" }),
  absent: msg("Absent", { $context: "device state" }),
  shutdown: msg("Stopped", { $context: "device state" }),
  connected: msg("Connected", { $context: "device state" }),
  unauthorized: msg("Unauthorized", { $context: "device state" }),
  offline: msg("Offline", { $context: "device state" }),
  "no permissions": msg("No permission", { $context: "device state" }),
};
type InventoryDevice = DeviceSimlockInventory["devices"][number];

const platformLabel = (platform: string) => (platform === "ios" ? "iOS" : "Android");
const formFactorLabels = {
  phone: msg("Phone"),
  tablet: msg("Tablet"),
  tv: msg("TV"),
  watch: msg("Watch"),
  other: msg("Other device"),
};

/** Simlock reports an Android version as its API level; people know the release. */
function osVersionLabel(device: InventoryDevice) {
  if (device.platform === "ios") return device.version ? `iOS ${device.version}` : "iOS";
  if (!device.version) return "Android";
  const release = androidReleaseForApiLevel(device.version);
  // oxlint-disable-next-line t3code/no-untranslated-copy -- platform names and "API" stay English
  return release ? `Android ${release} · API ${device.version}` : `Android API ${device.version}`;
}

function LeaseHolder({
  lease,
  environmentId,
}: {
  lease: NonNullable<InventoryDevice["lease"]>;
  environmentId: EnvironmentId;
}) {
  const { holder } = lease;
  return (
    <div className="mt-1 break-words text-sm text-muted-foreground">
      {holder.type === "thread" ? (
        <T>
          Used by{" "}
          <Var>
            <ThreadContextChip
              record={{ environmentId, threadId: holder.threadId, title: holder.threadId }}
            />
          </Var>
        </T>
      ) : holder.type === "qa-run" ? (
        <T>Used by a QA run</T>
      ) : (
        <T>
          Used by <Var>{holder.requesterId}</Var>
        </T>
      )}
      {lease.label && <span> · {lease.label}</span>}
    </div>
  );
}

function FormFactorIcon({
  formFactor,
}: {
  formFactor: NonNullable<InventoryDevice["formFactor"]>;
}) {
  const m = useMessages();
  const Icon = DEVICE_FORM_FACTOR_ICONS[formFactor];
  const label = m(formFactorLabels[formFactor]);
  return <Icon role="img" aria-label={label} className="size-4 shrink-0 text-muted-foreground" />;
}

function DeviceRows({
  devices,
  environmentId,
}: {
  devices: DeviceSimlockInventory["devices"];
  environmentId: EnvironmentId;
}) {
  const m = useMessages();
  return (
    <ul className="divide-y divide-border">
      {devices.map((device) => (
        <li key={`${device.platform}:${device.id}`} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            {device.formFactor && <FormFactorIcon formFactor={device.formFactor} />}
            <span className="font-medium">{device.name}</span>
            <Badge
              variant={device.state === "ready" && device.enrolled === true ? "success" : "outline"}
            >
              {(stateLabels[device.state] && m(stateLabels[device.state])) || device.state}
            </Badge>
            {device.simlockState && device.simlockState !== device.state && (
              <Badge variant="outline">
                <T>
                  Simlock: <Var>{device.simlockState}</Var>
                </T>
              </Badge>
            )}
            {device.enrolled !== true && (
              <Badge variant="outline">
                {device.enrolled === null ? <T>Enrollment unknown</T> : <T>Not enrolled</T>}
              </Badge>
            )}
          </div>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {osVersionLabel(device)} · {device.id}
          </p>
          {device.lease && <LeaseHolder lease={device.lease} environmentId={environmentId} />}
          {device.detail && <p className="mt-1 text-sm text-muted-foreground">{device.detail}</p>}
          {device.enrolled === false && (
            <p className="mt-1 text-sm text-muted-foreground">
              <T>Enroll this device in Simlock before QA can lease it.</T>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Inventory is fetched from the selected QA environment, never from the viewing browser's host. */
export function QaSimlockNote({
  environmentId,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    deviceEnvironment.simlockInventory({ environmentId, input: {} }),
  );
  const [search, setSearch] = useState("");
  const inventory = query.data;
  const physical = inventory?.devices.filter((device) => device.physical) ?? [];
  const virtual = inventory?.devices.filter((device) => !device.physical) ?? [];
  const groups = new Map<string, DeviceSimlockInventory["models"][number][]>();
  for (const model of inventory?.models ?? []) {
    if (!model.name.toLowerCase().includes(search.toLowerCase())) continue;
    const key = `${platformLabel(model.platform)} · ${model.formFactor}`;
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }
  return (
    <section
      aria-label={gt("Devices from Simlock")}
      className="min-w-0 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <MonitorSmartphoneIcon className="size-5 text-primary" />
          <T>Devices from Simlock</T>
        </h3>
        <Button variant="outline" size="sm" disabled={query.isPending} onClick={query.refresh}>
          <RefreshCwIcon className="size-4" />
          {query.isPending ? <T>Scanning…</T> : <T>Refresh devices</T>}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <T>
          Devices on <Var>{environmentLabel}</Var>. QA leases devices for each run and returns them
          when it ends. Availability can change before a run starts.
        </T>
      </p>
      {query.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {query.error}
        </p>
      )}
      {inventory?.issues.map((issue) => (
        <p role="alert" key={issue} className="mt-2 text-sm text-destructive">
          {issue}
        </p>
      ))}
      {!inventory && query.isPending && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          <T>Checking Simlock and Android connections…</T>
        </p>
      )}
      {inventory && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {query.error ? (
              <T>
                Last checked <Var>{qaWhen(inventory.scannedAt)}</Var> · Showing previous results
              </T>
            ) : (
              <T>
                Last checked <Var>{qaWhen(inventory.scannedAt)}</Var>
              </T>
            )}
          </p>
          <div className="mt-4 grid gap-5 @3xl/qa:grid-cols-2">
            <section aria-label={gt("Physical devices")}>
              <h4 className="text-sm font-semibold">
                <T>
                  Physical devices (<Var>{physical.length}</Var>)
                </T>
              </h4>
              <DeviceRows devices={physical} environmentId={environmentId} />
              {physical.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {inventory.issues.length ? (
                    <T>No physical devices reported by the sources that responded.</T>
                  ) : (
                    <T>No physical devices detected or enrolled.</T>
                  )}
                </p>
              )}
            </section>
            <section aria-label={gt("Simulator and emulator instances")}>
              <h4 className="text-sm font-semibold">
                <T>
                  Simulators and emulators (<Var>{virtual.length}</Var>)
                </T>
              </h4>
              <DeviceRows devices={virtual} environmentId={environmentId} />
              {virtual.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <T>
                    No current instances reported. QA can create an instance when it leases one.
                  </T>
                </p>
              )}
              {inventory.hiddenDeletedCount > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {gt(
                    "{count, plural, =1 {{count} deleted instance hidden.} other {{count} deleted instances hidden.}}",
                    { count: inventory.hiddenDeletedCount },
                  )}
                </p>
              )}
            </section>
          </div>
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              <T>
                Models available to create (
                <Var>{inventory.models.filter((model) => model.runtimes.length > 0).length}</Var>)
              </T>
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              <T>
                Model definitions, not connected devices. Models without an installed runtime cannot
                be created yet.
              </T>
            </p>
            <input
              aria-label={gt("Search device models")}
              placeholder={gt("Search models…")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="mt-3 max-h-80 overflow-y-auto">
              {[...groups]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([group, models]) => (
                  <details key={group} className="py-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      {group} ({models.length})
                    </summary>
                    <ul className="mt-2 space-y-1 pl-4 text-sm">
                      {models.map((model) => (
                        <li key={model.name}>
                          {model.name}{" "}
                          <span className="text-muted-foreground">
                            ·{" "}
                            {model.runtimes.length
                              ? model.runtimes.join(", ")
                              : gt("Runtime not installed")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              {groups.size === 0 && (
                <p className="text-sm text-muted-foreground">
                  <T>No matching models reported.</T>
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
