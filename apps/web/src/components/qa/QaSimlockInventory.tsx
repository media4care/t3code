import { useState } from "react";
import { MonitorSmartphoneIcon, RefreshCwIcon } from "lucide-react";
import type { DeviceSimlockInventory, EnvironmentId } from "@t3tools/contracts";
import { deviceEnvironment } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const stateLabels: Record<string, string> = {
  ready: "Available",
  leased: "Leased",
  provisioning: "Starting",
  reclaiming: "Returning",
  quarantined: "Quarantined",
  absent: "Absent",
  shutdown: "Stopped",
  connected: "Connected",
  unauthorized: "Unauthorized",
  offline: "Offline",
  "no permissions": "No permission",
};
const platformLabel = (platform: string) => (platform === "ios" ? "iOS" : "Android");

function DeviceRows({ devices }: { devices: DeviceSimlockInventory["devices"] }) {
  return (
    <ul className="divide-y divide-border">
      {devices.map((device) => (
        <li key={`${device.platform}:${device.id}`} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{device.name}</span>
            <Badge
              variant={device.state === "ready" && device.enrolled === true ? "success" : "outline"}
            >
              {stateLabels[device.state] ?? device.state}
            </Badge>
            {device.simlockState && device.simlockState !== device.state && (
              <Badge variant="outline">Simlock: {device.simlockState}</Badge>
            )}
            {device.enrolled !== true && (
              <Badge variant="outline">
                {device.enrolled === null ? "Enrollment unknown" : "Not enrolled"}
              </Badge>
            )}
          </div>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {platformLabel(device.platform)} {device.version} · {device.id}
          </p>
          {device.detail && <p className="mt-1 text-sm text-muted-foreground">{device.detail}</p>}
          {device.enrolled === false && (
            <p className="mt-1 text-sm text-muted-foreground">
              Enroll this device in Simlock before QA can lease it.
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
      aria-label="Devices from Simlock"
      className="min-w-0 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <MonitorSmartphoneIcon className="size-5 text-primary" />
          Devices from Simlock
        </h3>
        <Button variant="outline" size="sm" disabled={query.isPending} onClick={query.refresh}>
          <RefreshCwIcon className="size-4" />
          {query.isPending ? "Scanning…" : "Refresh devices"}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Devices on {environmentLabel}. QA leases devices for each run and returns them when it ends.
        Availability can change before a run starts.
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
          Checking Simlock and Android connections…
        </p>
      )}
      {inventory && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Last checked {new Date(inventory.scannedAt).toLocaleTimeString()}
            {query.error ? " · Showing previous results" : ""}
          </p>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <section aria-label="Physical devices">
              <h4 className="text-sm font-semibold">Physical devices ({physical.length})</h4>
              <DeviceRows devices={physical} />
              {physical.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {inventory.issues.length
                    ? "No physical devices reported by the sources that responded."
                    : "No physical devices detected or enrolled."}
                </p>
              )}
            </section>
            <section aria-label="Simulator and emulator instances">
              <h4 className="text-sm font-semibold">Simulators and emulators ({virtual.length})</h4>
              <DeviceRows devices={virtual} />
              {virtual.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No current instances reported. QA can create an instance when it leases one.
                </p>
              )}
              {inventory.hiddenDeletedCount > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {inventory.hiddenDeletedCount} deleted instances hidden.
                </p>
              )}
            </section>
          </div>
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Models available to create (
              {inventory.models.filter((model) => model.runtimes.length > 0).length})
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Model definitions, not connected devices. Models without an installed runtime cannot
              be created yet.
            </p>
            <input
              aria-label="Search device models"
              placeholder="Search models…"
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
                              : "Runtime not installed"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              {groups.size === 0 && (
                <p className="text-sm text-muted-foreground">No matching models reported.</p>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
