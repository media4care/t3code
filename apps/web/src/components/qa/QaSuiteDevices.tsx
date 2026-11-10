import { CircleAlertIcon, MonitorSmartphoneIcon } from "lucide-react";
import {
  qaDeviceRequirementKey,
  type DevicePoolEntry,
  type QaDeviceRequirement,
} from "@t3tools/contracts";
import {
  DEVICE_POOL_CATEGORY_LABELS,
  DEVICE_POOL_STATE_LABELS,
  devicePoolCategory,
  devicePoolKind,
} from "@t3tools/client-runtime/device/pool";
import {
  qaDeviceRequirementLabel,
  qaDeviceUnavailableReason,
  type QaDeviceAssignment,
} from "@t3tools/shared/qaDevices";
import { cn } from "../../lib/utils";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { DEVICE_FORM_FACTOR_ICONS } from "./deviceIcons";

const AUTOMATIC = "automatic";

/** The devices a suite runs on, each with a picker; null while the pool loads. */
export function QaSuiteDevices({
  assignments,
  canChoose,
  onChoose,
}: {
  assignments: ReadonlyArray<QaDeviceAssignment> | null;
  canChoose: boolean;
  onChoose: (requirement: string, deviceKey: string | null) => void;
}) {
  return (
    <div role="group" aria-label="Devices" className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
      {assignments ? (
        assignments.map((assignment) => (
          <DeviceRequirement
            key={assignment.key}
            assignment={assignment}
            canChoose={canChoose}
            onChoose={(deviceKey) => onChoose(assignment.key, deviceKey)}
          />
        ))
      ) : (
        <p className="text-xs text-muted-foreground">Checking devices…</p>
      )}
    </div>
  );
}

/** The devices a suite needs when Simlock leases them; each run gets fresh ones. */
export function QaSimlockDevices({
  requirements,
}: {
  requirements: ReadonlyArray<QaDeviceRequirement>;
}) {
  return (
    <div role="group" aria-label="Devices" className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3">
      {requirements.map((requirement, index) => {
        const Icon = requirement.formFactor
          ? DEVICE_FORM_FACTOR_ICONS[requirement.formFactor]
          : MonitorSmartphoneIcon;
        return (
          <p
            key={qaDeviceRequirementKey(requirement, index)}
            className="flex items-center gap-2 text-xs"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{qaDeviceRequirementLabel(requirement)}</span>
            {requirement.defaultDevice ? (
              <span className="text-muted-foreground">· {requirement.defaultDevice}</span>
            ) : null}
          </p>
        );
      })}
      <p className="text-xs text-muted-foreground">Leased from Simlock for each run.</p>
    </div>
  );
}

function DeviceRequirement({
  assignment,
  canChoose,
  onChoose,
}: {
  assignment: QaDeviceAssignment;
  canChoose: boolean;
  onChoose: (deviceKey: string | null) => void;
}) {
  const { requirement, candidates, device, automatic, busy, chosenKey } = assignment;
  const label = qaDeviceRequirementLabel(requirement);
  const Icon = requirement.formFactor
    ? DEVICE_FORM_FACTOR_ICONS[requirement.formFactor]
    : MonitorSmartphoneIcon;
  const chosen = candidates.find((entry) => entry.key === chosenKey);
  const groups = (["ready", "startable", "offline"] as const)
    .map((category) => ({
      category,
      entries: candidates.filter((entry) => devicePoolCategory(entry) === category),
    }))
    .filter((group) => group.entries.length > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex min-w-0 flex-1 basis-36 items-center gap-2 text-xs font-medium">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {label}
      </span>
      <div className="w-full min-w-0 @md/suite:w-60">
        <Select
          value={chosen ? chosen.key : AUTOMATIC}
          disabled={!canChoose}
          onValueChange={(value) => {
            if (value) onChoose(value === AUTOMATIC ? null : value);
          }}
        >
          <SelectTrigger size="sm" aria-label={`Device for ${label}`}>
            <SelectValue>
              {device ? (
                <span className="flex min-w-0 items-center gap-2">
                  <StateDot entry={device} />
                  <span className="truncate">{device.name}</span>
                  {device.key === chosenKey ? null : (
                    <span className="shrink-0 text-muted-foreground">Auto</span>
                  )}
                </span>
              ) : busy ? (
                <span className="flex min-w-0 items-center gap-2">
                  <StateDot entry={busy} />
                  <span className="truncate">Waiting for {busy.name}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">No device available</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={AUTOMATIC}>
              <span className="flex min-w-0 flex-col">
                <span>Automatic</span>
                <span className="text-xs text-muted-foreground">
                  {automatic
                    ? `Currently ${automatic.name}`
                    : busy && !chosen
                      ? `Waits for ${busy.name}`
                      : "No device available"}
                </span>
              </span>
            </SelectItem>
            {groups.map((group) => (
              <SelectGroup key={group.category}>
                <SelectGroupLabel>{DEVICE_POOL_CATEGORY_LABELS[group.category]}</SelectGroupLabel>
                {group.entries.map((entry) => (
                  <SelectItem
                    key={entry.key}
                    value={entry.key}
                    disabled={entry.state === "offline"}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <StateDot entry={entry} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[
                            entry.version,
                            devicePoolKind(entry),
                            entry.qaRun ? `In use by ${entry.qaRun.suiteName}` : null,
                            entry.inUse ? "In use" : null,
                            entry.state === "starting" ? DEVICE_POOL_STATE_LABELS.starting : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {!device && busy ? (
        <p className="w-full text-xs text-muted-foreground">
          {busy.name} is in use by {busy.qaRun?.suiteName ?? "another suite"}. A run here starts
          when it finishes.
        </p>
      ) : !device ? (
        <p className="flex w-full items-start gap-1.5 text-xs text-warning-foreground">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {qaDeviceUnavailableReason(assignment)}
        </p>
      ) : chosen && chosen.key !== device.key ? (
        <p className="w-full text-xs text-muted-foreground">
          {chosen.name} is {chosen.state === "offline" ? "offline" : "already used by this suite"}.
          Runs use {device.name} until it is available.
        </p>
      ) : device.inUse ? (
        <p className="w-full text-xs text-muted-foreground">
          {device.name} is open in a Device panel. A run can interrupt what is happening there.
        </p>
      ) : device.state === "stopped" ? (
        <p className="w-full text-xs text-muted-foreground">Starts when the suite runs.</p>
      ) : null}
    </div>
  );
}

function StateDot({ entry }: { entry: DevicePoolEntry }) {
  return (
    <span
      role="img"
      aria-label={DEVICE_POOL_STATE_LABELS[entry.state]}
      className={cn(
        "size-2 shrink-0 rounded-full",
        entry.state === "running" || entry.state === "connected"
          ? "bg-success"
          : entry.state === "starting"
            ? "bg-info"
            : entry.state === "stopped"
              ? "bg-muted-foreground/40"
              : "border border-muted-foreground/60",
      )}
    />
  );
}
