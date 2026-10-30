import {
  ActivityIcon,
  AlertCircleIcon,
  BlocksIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  Clock3Icon,
  FlaskConicalIcon,
  GlobeIcon,
  LayersIcon,
  PlayIcon,
  RouteIcon,
  SmartphoneIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import type { QaRun, QaTestKind } from "@t3tools/contracts";
import {
  QA_KIND_LABELS,
  qaRunDuration,
  qaStatusLabel,
  qaFreshnessLabel,
  type QaDashboardEntry,
  type QaResultFilter,
} from "@t3tools/client-runtime/qa";
import type { qaDashboard } from "@t3tools/client-runtime/qa";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const KIND_STYLES = {
  unit: { icon: FlaskConicalIcon, color: "bg-success/10 text-success-foreground" },
  integration: { icon: BlocksIcon, color: "bg-warning/10 text-warning-foreground" },
  playwright: { icon: GlobeIcon, color: "bg-info/10 text-info-foreground" },
  maestro: { icon: SmartphoneIcon, color: "bg-guest/10 text-guest-foreground" },
  e2e: { icon: RouteIcon, color: "bg-error/10 text-error-foreground" },
  tooling: { icon: TerminalIcon, color: "bg-primary/10 text-primary" },
  other: { icon: LayersIcon, color: "bg-muted text-muted-foreground" },
};

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
  const Icon = !run
    ? CircleDashedIcon
    : run.status === "passed"
      ? CheckCircle2Icon
      : run.status === "running"
        ? ActivityIcon
        : AlertCircleIcon;
  return (
    <Badge
      variant={
        !run
          ? "secondary"
          : run.status === "passed"
            ? "success"
            : run.status === "failed"
              ? "error"
              : run.status === "running"
                ? "info"
                : "warning"
      }
    >
      <Icon /> {qaStatusLabel(run)}
    </Badge>
  );
}

function TestKind({ kind }: { kind: QaTestKind }) {
  const { icon: Icon, color } = KIND_STYLES[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${color}`}
    >
      <Icon className="size-3.5" /> {QA_KIND_LABELS[kind]}
    </span>
  );
}

export function QaSuiteGroup({
  label,
  entries,
  showComponent,
  canRun,
  canCancel,
  onRun,
  onCancel,
  onView,
}: {
  label: string;
  entries: readonly QaDashboardEntry[];
  showComponent: boolean;
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
            entry={entry}
            showComponent={showComponent}
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
  entry: { suite, run, component, kind, freshness },
  showComponent,
  canRun,
  canCancel,
  onRun,
  onCancel,
  onView,
}: {
  entry: QaDashboardEntry;
  showComponent: boolean;
  canRun: boolean;
  canCancel: boolean;
  onRun: (suiteId: string) => void;
  onCancel: (runId: string) => void;
  onView: (runId: string) => void;
}) {
  return (
    <section
      aria-label={suite.name}
      className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TestKind kind={kind} />
        {showComponent ? <span className="text-xs text-muted-foreground">{component}</span> : null}
        <div className="ml-auto">
          <QaRunBadge run={run} />
        </div>
      </div>
      <h4 className="mt-3 font-semibold leading-snug">{suite.name}</h4>
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
                ? `Last passed ${new Date(freshness.lastPassedAt).toLocaleString()}`
                : "No successful run recorded"}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock3Icon className="size-3.5" />
          {run ? (
            <time dateTime={run.startedAt}>
              Last run{" "}
              {new Date(run.startedAt).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          ) : (
            "No QA runs recorded"
          )}
        </span>
        {run ? <span>{qaRunDuration(run)}</span> : null}
      </div>
      {run?.summary ? (
        <div className="mt-4 flex flex-wrap gap-4 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          <span className="text-success-foreground">
            <strong className="tabular-nums">
              {run.summary.tests - run.summary.failures - run.summary.skipped}
            </strong>{" "}
            passed
          </span>
          <span
            className={
              run.summary.failures ? "text-destructive-foreground" : "text-muted-foreground"
            }
          >
            <strong className="tabular-nums">{run.summary.failures}</strong> failed
          </span>
          <span className="text-muted-foreground">
            <strong className="tabular-nums">{run.summary.skipped}</strong> skipped
          </span>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          {run?.status === "running"
            ? "Executing on the selected environment."
            : run
              ? "No test report recorded."
              : "Run this suite to record its first result."}
        </p>
      )}
      {run?.note ? <p className="mt-3 text-xs text-muted-foreground">{run.note}</p> : null}
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">Command</summary>
        <p className="mt-2 break-all rounded-lg bg-muted/40 p-3 font-mono">
          {suite.cwd ? `${suite.cwd} › ` : ""}
          {suite.command}
        </p>
      </details>
      <div className="mt-auto flex justify-end gap-2 pt-4">
        {run ? (
          <Button variant="ghost" size="sm" onClick={() => onView(run.id)}>
            {run.summary ? `View tests (${run.summary.tests})` : "View run"}
          </Button>
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
          <Button variant="outline" size="sm" disabled={!canRun} onClick={() => onRun(suite.id)}>
            <PlayIcon /> Run
          </Button>
        )}
      </div>
    </section>
  );
}
