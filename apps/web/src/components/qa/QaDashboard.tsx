import {
  ActivityIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  LayersIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type {
  DevicePoolEntry,
  EnvironmentId,
  ProjectId,
  QaDeviceSelection,
  QaRun,
  QaRunStatus,
} from "@t3tools/contracts";
import {
  QA_KIND_LABELS,
  qaRunHeadline,
  qaRunSource,
  qaStatusLabel,
  qaWhen,
  qaFreshnessLabel,
  type QaDashboardEntry,
  type QaResultFilter,
} from "@t3tools/client-runtime/qa";
import type { qaDashboard } from "@t3tools/client-runtime/qa";
import { qaDeviceAssignments } from "@t3tools/shared/qaDevices";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { QaRunActivity } from "./QaRunProgress";
import { QaSimlockDevices, QaSuiteDevices } from "./QaSuiteDevices";

export interface QaSuiteDeviceChoices {
  /** The project whose suites these are; its runs keep the devices they hold. */
  readonly projectId: string;
  /** Simlock leases each run's devices, so there is nothing to pick from the pool. */
  readonly simlock: boolean;
  /** Null while the device pool loads. */
  readonly pool: ReadonlyArray<DevicePoolEntry> | null;
  readonly selections: ReadonlyArray<QaDeviceSelection>;
  readonly canChoose: boolean;
  readonly onChoose: (suiteId: string, requirement: string, deviceKey: string | null) => void;
}

const METRICS = [
  {
    key: "all",
    count: "total",
    label: "Total suites",
    icon: LayersIcon,
    color: "bg-primary/5 text-foreground",
    bar: "bg-primary",
  },
  {
    key: "passed",
    count: "passed",
    label: "Passed",
    icon: CheckCircle2Icon,
    color: "bg-success/8 text-success-foreground",
    bar: "bg-success",
  },
  {
    key: "attention",
    count: "attention",
    label: "Needs attention",
    icon: AlertCircleIcon,
    color: "bg-warning/8 text-warning-foreground",
    bar: "bg-warning",
  },
  {
    key: "running",
    count: "running",
    label: "Running",
    icon: ActivityIcon,
    color: "bg-info/8 text-info-foreground",
    bar: "bg-info",
  },
  {
    key: "never",
    count: "never",
    label: "Never run",
    icon: CircleDashedIcon,
    color: "bg-muted/60 text-muted-foreground",
    bar: "bg-muted-foreground/35",
  },
] as const;

export function QaSummary({
  counts,
  filter,
  onFilter,
}: {
  counts: ReturnType<typeof qaDashboard>["counts"];
  filter: QaResultFilter;
  onFilter: (filter: QaResultFilter) => void;
}) {
  return (
    <section
      aria-label="Suite health"
      className="rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Suite health</h3>
        <span className="text-xs text-muted-foreground">Latest result for each suite</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        {METRICS.map(({ key, count, label, icon: Icon, color }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => onFilter(filter === key ? "all" : key)}
            className={`rounded-xl p-3 text-left -outline-offset-2 ring-inset hover:ring-1 hover:ring-current focus-visible:outline-2 focus-visible:outline-ring sm:p-4 ${key === "all" ? "col-span-2 flex items-center justify-between sm:col-span-1 sm:block" : ""} ${color} ${filter === key ? "ring-1 ring-current" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{label}</span>
              <Icon className="size-4 shrink-0 opacity-75" />
            </div>
            <div
              className={`${key === "all" ? "sm:mt-2" : "mt-2"} text-3xl font-semibold tabular-nums`}
            >
              {counts[count]}
            </div>
          </button>
        ))}
      </div>
      <div
        role="img"
        aria-label={METRICS.slice(1)
          .map(({ count, label }) => `${counts[count]} ${label.toLowerCase()}`)
          .join(", ")}
        className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted"
      >
        {METRICS.slice(1).map(({ count, bar }) =>
          counts[count] > 0 ? (
            <div
              key={count}
              className={bar}
              style={{ width: `${(counts[count] / counts.total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

export function QaRunBadge({ run }: { run: QaRun | undefined }) {
  return <QaStatusBadge status={run?.status} label={qaStatusLabel(run)} />;
}

export function QaStatusBadge({
  status,
  label,
}: {
  status: QaRunStatus | undefined;
  label: string;
}) {
  const Icon = !status
    ? CircleDashedIcon
    : status === "passed"
      ? CheckCircle2Icon
      : status === "running"
        ? ActivityIcon
        : AlertCircleIcon;
  return (
    <Badge
      variant={
        !status
          ? "secondary"
          : status === "passed"
            ? "success"
            : status === "failed"
              ? "error"
              : status === "running"
                ? "info"
                : "warning"
      }
    >
      <Icon /> {label}
    </Badge>
  );
}

const RESULT_TONES = {
  passed: { icon: CheckIcon, text: "text-success-foreground", circle: "bg-success/10" },
  failed: { icon: XIcon, text: "text-destructive-foreground", circle: "bg-error/10" },
  attention: { icon: TriangleAlertIcon, text: "text-warning-foreground", circle: "bg-warning/10" },
  running: { icon: null, text: "text-info-foreground", circle: "bg-info/10" },
  never: { icon: CircleDashedIcon, text: "text-muted-foreground", circle: "bg-muted" },
};

function resultTone(entry: QaDashboardEntry) {
  return RESULT_TONES[entry.run?.status === "failed" ? "failed" : entry.category];
}

function StatusIcon({ entry }: { entry: QaDashboardEntry }) {
  const { icon: Icon, text, circle } = resultTone(entry);
  return (
    <span
      aria-hidden
      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${circle} ${text}`}
    >
      {Icon ? <Icon className="size-4" /> : <Spinner size="md" />}
    </span>
  );
}

export function QaSuiteGroup({
  environmentId,
  projectId,
  label,
  entries,
  showComponent,
  devices,
  canRun,
  canCancel,
  onRun,
  onCancel,
  onView,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label: string;
  entries: readonly QaDashboardEntry[];
  showComponent: boolean;
  devices: QaSuiteDeviceChoices;
  canRun: boolean;
  canCancel: boolean;
  onRun: (suiteId: string) => void;
  onCancel: (runId: string) => void;
  onView: (runId: string) => void;
}) {
  const passed = entries.filter((entry) => entry.category === "passed").length;
  const attention = entries.filter((entry) => entry.category === "attention").length;
  return (
    <details open aria-label={label} className="group/qa">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-lg py-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/8 text-primary">
          <LayersIcon className="size-4" />
        </span>
        <h3 className="font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? "suite" : "suites"}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {attention > 0 ? (
            <span className="text-warning-foreground">{attention} need attention</span>
          ) : null}
          <span className="text-muted-foreground">
            {passed}/{entries.length} passed
          </span>
          <ChevronDownIcon className="size-4 -rotate-90 text-muted-foreground group-open/qa:rotate-0" />
        </span>
      </summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {entries.map((entry) => (
          <SuiteCard
            key={entry.suite.id}
            environmentId={environmentId}
            projectId={projectId}
            entry={entry}
            showComponent={showComponent}
            devices={devices}
            canRun={canRun}
            canCancel={canCancel}
            onRun={onRun}
            onCancel={onCancel}
            onView={onView}
          />
        ))}
      </div>
    </details>
  );
}

function SuiteCard({
  environmentId,
  projectId,
  entry,
  showComponent,
  devices,
  canRun,
  canCancel,
  onRun,
  onCancel,
  onView,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  entry: QaDashboardEntry;
  showComponent: boolean;
  devices: QaSuiteDeviceChoices;
  canRun: boolean;
  canCancel: boolean;
  onRun: (suiteId: string) => void;
  onCancel: (runId: string) => void;
  onView: (runId: string) => void;
}) {
  const { suite, run, component, kind, freshness } = entry;
  const assignments =
    suite.devices?.length && !devices.simlock
      ? devices.pool &&
        qaDeviceAssignments(suite, devices.pool, devices.selections, devices.projectId)
      : undefined;
  // A suite waiting for a busy device can still run; it starts when the device is free.
  const blocked =
    assignments?.some((assignment) => !assignment.device && !assignment.busy) ?? false;
  return (
    <section
      aria-label={suite.name}
      className="@container/suite flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <StatusIcon entry={entry} />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold leading-snug">{suite.name}</h4>
          <p className={`text-sm ${resultTone(entry).text}`}>{qaRunHeadline(run)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              QA_KIND_LABELS[kind],
              showComponent ? component : null,
              run ? qaWhen(run.startedAt) : null,
              run?.devices?.length
                ? `On ${run.devices.map((device) => device.name).join(", ")}`
                : null,
              run?.repositoryFile ? qaRunSource(run) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {blocked ? (
          <Badge variant="warning">
            <CircleAlertIcon /> Blocked
          </Badge>
        ) : null}
        {run?.status === "running" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!canCancel}
            onClick={() => onCancel(run.id)}
          >
            <SquareIcon /> Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!canRun || blocked}
            onClick={() => onRun(suite.id)}
          >
            <PlayIcon /> Run
          </Button>
        )}
      </div>
      {suite.devices?.length && devices.simlock ? (
        <QaSimlockDevices requirements={suite.devices} />
      ) : assignments !== undefined ? (
        <QaSuiteDevices
          assignments={assignments}
          canChoose={devices.canChoose}
          onChoose={(requirement, deviceKey) => devices.onChoose(suite.id, requirement, deviceKey)}
        />
      ) : null}
      {run?.outputTail ? (
        <div className="mt-3 rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="text-xs font-medium text-destructive-foreground">
            Failure output{run.exitCode !== null ? ` · Exit ${run.exitCode}` : ""}
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
            {run.outputTail}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Recent output. Open the run for more.
          </p>
        </div>
      ) : null}
      {freshness ? (
        <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
          <Badge
            variant={
              freshness.state === "current"
                ? "success"
                : freshness.state === "stale"
                  ? "warning"
                  : "secondary"
            }
          >
            {qaFreshnessLabel(freshness)}
          </Badge>
          <p className="mt-2 text-muted-foreground">{freshness.reason}</p>
          {freshness.changedPaths.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer">
                Changed inputs ({freshness.changedFileCount})
              </summary>
              <ul className="mt-2 space-y-1 break-all font-mono">
                {freshness.changedPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {freshness.changedFileCount > freshness.changedPaths.length ? (
                <p className="mt-1">Showing the first {freshness.changedPaths.length} paths.</p>
              ) : null}
            </details>
          ) : null}
          {run?.status !== "passed" ? (
            <p className="mt-2 text-muted-foreground">
              {freshness.lastPassedAt
                ? `Last passed ${qaWhen(freshness.lastPassedAt)}`
                : "No successful run recorded"}
            </p>
          ) : null}
        </div>
      ) : null}
      {run?.status === "running" && run.steps ? (
        <div className="mt-4">
          <QaRunActivity environmentId={environmentId} projectId={projectId} run={run} />
        </div>
      ) : null}
      {run?.note ? <p className="mt-3 text-xs text-muted-foreground">{run.note}</p> : null}
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">Command</summary>
        <p className="mt-2 break-all rounded-lg bg-muted/40 p-3 font-mono">
          {suite.cwd ? `${suite.cwd} › ` : ""}
          {suite.command}
        </p>
      </details>
      {run ? (
        <div className="mt-auto flex justify-end pt-3">
          <Button variant="ghost" size="sm" onClick={() => onView(run.id)}>
            {run.summary && !run.repositoryFile ? `View tests (${run.summary.tests})` : "View run"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
