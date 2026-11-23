import {
  ActivityIcon,
  AlertCircleIcon,
  BlocksIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  ClockIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GlobeIcon,
  LayersIcon,
  MonitorIcon,
  PlayIcon,
  RotateCwIcon,
  RouteIcon,
  SmartphoneIcon,
  SquareIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import type {
  DevicePoolEntry,
  EnvironmentId,
  ProjectId,
  QaApp,
  QaDeviceSelection,
  QaRun,
  QaRunStatus,
  QaTestKind,
} from "@t3tools/contracts";
import {
  QA_KIND_LABELS,
  qaDeviceCoverage,
  qaDeviceKind,
  qaFreshnessLabel,
  qaGroupSuiteIds,
  qaGroupSummary,
  qaLaneDeviceLabel,
  qaLaneHeadline,
  qaLaneLabel,
  qaLaneSections,
  qaLanesHeadline,
  qaNeedsRerun,
  qaOutputTail,
  qaRunHeadline,
  qaRunSource,
  qaStatusLabel,
  qaWhen,
  type QaAttentionItem,
  type QaCoverageCell,
  type QaDashboardEntry,
  type QaLaneOutcome,
  type QaLaneResult,
  type QaSuiteGroup,
} from "@t3tools/client-runtime/qa";
import { qaDeviceAssignments, qaOsLabel } from "@t3tools/shared/qaDevices";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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

/** What the rows of the dashboard need to show apps and act on suites. */
export interface QaDashboardContext {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly apps: ReadonlyArray<QaApp>;
  /** App icons as data URLs by app id. */
  readonly icons: Readonly<Record<string, string>>;
  /** The commit QA tests; null when unknown. */
  readonly commit: string | null;
  readonly devices: QaSuiteDeviceChoices;
  readonly canRun: boolean;
  readonly canCancel: boolean;
  readonly onRun: (suiteId: string, lanes?: ReadonlyArray<string>) => void;
  readonly onCancel: (runId: string) => void;
  readonly onView: (runId: string) => void;
}

const KIND_STYLES = {
  unit: { icon: FlaskConicalIcon, color: "bg-success/10 text-success-foreground" },
  integration: { icon: BlocksIcon, color: "bg-warning/10 text-warning-foreground" },
  playwright: { icon: GlobeIcon, color: "bg-info/10 text-info-foreground" },
  maestro: { icon: SmartphoneIcon, color: "bg-guest/10 text-guest-foreground" },
  e2e: { icon: RouteIcon, color: "bg-error/10 text-error-foreground" },
  tooling: { icon: TerminalIcon, color: "bg-primary/10 text-primary" },
  other: { icon: LayersIcon, color: "bg-muted text-muted-foreground" },
} satisfies Record<QaTestKind, { icon: typeof LayersIcon; color: string }>;

function TestKind({ kind }: { kind: QaTestKind }) {
  const { icon: Icon, color } = KIND_STYLES[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${color}`}
    >
      <Icon className="size-3" /> {QA_KIND_LABELS[kind]}
    </span>
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

type Tone = QaLaneOutcome | "stale";

const TONES: Record<Tone, { icon: typeof CheckIcon | null; text: string; bar: string }> = {
  passed: { icon: CheckIcon, text: "text-success-foreground", bar: "bg-success" },
  failed: { icon: XIcon, text: "text-destructive-foreground", bar: "bg-destructive" },
  "not-run": { icon: TriangleAlertIcon, text: "text-warning-foreground", bar: "bg-warning" },
  stale: { icon: RotateCwIcon, text: "text-warning-foreground", bar: "bg-warning" },
  running: { icon: null, text: "text-info-foreground", bar: "bg-info" },
  queued: { icon: ClockIcon, text: "text-muted-foreground", bar: "bg-info/40" },
  never: { icon: CircleDashedIcon, text: "text-muted-foreground", bar: "bg-muted-foreground/25" },
};

function entryTone(entry: QaDashboardEntry): Tone {
  if (entry.lanes.length) {
    const outcomes = entry.lanes.map(({ outcome }) => outcome);
    return (
      (["running", "queued", "failed", "not-run", "never"] as const).find((outcome) =>
        outcomes.includes(outcome),
      ) ?? (qaNeedsRerun(entry) ? "stale" : "passed")
    );
  }
  if (entry.category === "running") return "running";
  if (entry.category === "never") return "never";
  if (entry.category === "attention") return entry.run?.status === "failed" ? "failed" : "not-run";
  return qaNeedsRerun(entry) ? "stale" : "passed";
}

function ToneIcon({ tone }: { tone: Tone }) {
  const Icon = TONES[tone].icon;
  return Icon ? <Icon className="size-3.5 shrink-0" /> : <Spinner size="sm" />;
}

/** An app's icon, two overlapping for suites that test several, or a glyph without one. */
function AppIcons({
  apps,
  icons,
}: {
  apps: ReadonlyArray<QaApp>;
  icons: Readonly<Record<string, string>>;
}) {
  const shown = apps.flatMap((app) => (icons[app.id] ? [icons[app.id]!] : [])).slice(0, 2);
  if (!shown.length)
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <LayersIcon className="size-3.5" />
      </span>
    );
  return (
    <span className={`relative h-6 shrink-0 ${shown.length > 1 ? "w-9" : "w-6"}`}>
      {shown.map((icon, index) => (
        <img
          key={icon}
          src={icon}
          alt=""
          className={`absolute top-0 size-6 rounded-md ring-2 ring-card ${index ? "left-3" : "left-0"}`}
        />
      ))}
    </span>
  );
}

/** How each app stands on the commit QA tests. */
export function QaGroupTiles({
  groups,
  context,
}: {
  groups: ReadonlyArray<QaSuiteGroup>;
  context: QaDashboardContext;
}) {
  const shown = groups.filter((group) => !group.other);
  if (!shown.length) return null;
  const summaries = shown.map((group) => qaGroupSummary(group.entries, context.commit));
  const green = summaries.filter((summary) => summary.tone === "passed").length;
  return (
    <section aria-label="On the latest commit" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">On the latest commit</h3>
        <span className="text-xs text-muted-foreground">
          {green} of {shown.length} passed
          {context.commit ? (
            <>
              {" "}
              on <span className="font-mono">{context.commit.slice(0, 7)}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 @xl/qa:grid-cols-3 @4xl/qa:grid-cols-5">
        {shown.map((group, index) => {
          const summary = summaries[index]!;
          return (
            <div
              key={group.key}
              className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <AppIcons apps={group.apps} icons={context.icons} />
                <span className="truncate">{group.label}</span>
              </div>
              <div
                className={`flex items-center gap-1.5 text-sm font-medium ${TONES[summary.tone].text}`}
              >
                <ToneIcon tone={summary.tone} />
                {summary.headline}
              </div>
              <div aria-hidden className="flex h-1.5 gap-0.5">
                {summary.cells.map(({ key, outcome }) => (
                  <span key={key} className={`flex-1 rounded-full ${TONES[outcome].bar}`} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{summary.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function attentionDetail({ reason, run, entry }: QaAttentionItem) {
  if (reason === "stale") return entry.freshness?.reason ?? "Its inputs changed since it passed.";
  if (!run) return "";
  if (reason === "not-run") return run.note ?? qaStatusLabel(run);
  return `${qaRunHeadline(run)} · ${qaWhen(run.startedAt)}`;
}

/** Failed suites and lanes, ones that could not run, and passed ones whose inputs changed. */
export function QaAttentionList({
  items,
  context,
}: {
  items: ReadonlyArray<QaAttentionItem>;
  context: QaDashboardContext;
}) {
  if (!items.length) return null;
  return (
    <section aria-label="Needs attention" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Needs attention</h3>
        <Badge variant="warning">{items.length}</Badge>
      </div>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
        {items.map((item) => {
          const { entry, lane, run, reason } = item;
          const apps = context.apps.filter((app) => entry.suite.apps?.includes(app.id));
          const title = [
            apps.length ? apps.map((app) => app.name).join(" + ") : entry.component,
            entry.suite.name,
            lane ? qaLaneLabel(lane) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${reason === "failed" ? "bg-destructive" : "bg-warning"}`}
              />
              <AppIcons apps={apps} icons={context.icons} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{title}</p>
                <p className="truncate text-xs text-muted-foreground">{attentionDetail(item)}</p>
              </div>
              {run ? (
                <Button variant="outline" size="compact" onClick={() => context.onView(run.id)}>
                  View
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="compact"
                disabled={!context.canRun}
                onClick={() => context.onRun(entry.suite.id, lane ? [lane.key] : undefined)}
              >
                {reason === "stale" ? <PlayIcon /> : <RotateCwIcon />}
                {reason === "stale" ? "Run" : "Rerun"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const COLUMNS = 5;

/** Every suite, a table section per app, with each suite's lanes below it. */
export function QaSuiteTable({
  groups,
  entries,
  runs,
  showComponent,
  context,
}: {
  groups: ReadonlyArray<QaSuiteGroup>;
  /** Every suite, for the runs that count for a group's devices. */
  entries: ReadonlyArray<QaDashboardEntry>;
  /** The latest and recent runs. */
  runs: ReadonlyArray<QaRun>;
  showComponent: boolean;
  context: QaDashboardContext;
}) {
  // Groups are open unless they are Other; toggling flips that.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-2 pl-3 font-medium">Suite</th>
            <th className="px-2 py-2 font-medium">Result</th>
            <th className="px-2 py-2 font-medium">Tested</th>
            <th className="px-2 py-2 font-medium">Ran</th>
            <th className="py-2 pr-3 pl-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => {
          const open = group.other === toggled.has(group.key);
          return (
            <GroupRows
              key={group.key}
              group={group}
              open={open}
              coverage={group.other ? [] : qaDeviceCoverage(qaGroupSuiteIds(group, entries), runs)}
              showComponent={showComponent || group.other}
              context={context}
              onToggle={() => {
                const next = new Set(toggled);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                setToggled(next);
              }}
            />
          );
        })}
      </table>
    </div>
  );
}

function GroupRows({
  group,
  open,
  coverage,
  showComponent,
  context,
  onToggle,
}: {
  group: QaSuiteGroup;
  open: boolean;
  coverage: ReadonlyArray<QaCoverageCell>;
  showComponent: boolean;
  context: QaDashboardContext;
  onToggle: () => void;
}) {
  const summary = qaGroupSummary(group.entries, context.commit);
  const components = [...new Set(group.entries.map((entry) => entry.component))];
  return (
    <>
      <tbody aria-label={group.label} className="border-t border-border first-of-type:border-t-0">
        <tr className="bg-muted/40">
          <td colSpan={COLUMNS} className="p-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={onToggle}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <AppIcons apps={group.apps} icons={context.icons} />
              <span className="font-semibold">{group.label}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {[
                  group.other ? components.join(", ") : null,
                  `${summary.passed}/${summary.total} passed`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <ChevronRightIcon
                className={`ml-auto size-4 shrink-0 text-muted-foreground ${open ? "rotate-90" : ""}`}
              />
            </button>
          </td>
        </tr>
        {open && coverage.length ? (
          <tr>
            <td colSpan={COLUMNS} className="px-3 pt-2 pb-1">
              <DeviceCoverage cells={coverage} />
            </td>
          </tr>
        ) : null}
      </tbody>
      {open
        ? group.entries.map((entry) => (
            <SuiteRows
              key={entry.suite.id}
              entry={entry}
              showComponent={showComponent}
              context={context}
            />
          ))
        : null}
    </>
  );
}

/** The OS versions a group's suites ran on, with the latest result on virtual and physical devices. */
function DeviceCoverage({ cells }: { cells: ReadonlyArray<QaCoverageCell> }) {
  return (
    <div role="list" aria-label="Device coverage" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Tested on</span>
      {cells.map((cell) => {
        const os = qaOsLabel(cell.platform, cell.os);
        return (
          <span
            key={`${cell.platform}:${cell.os}`}
            role="listitem"
            className="inline-flex items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-1.5 text-xs"
          >
            {os}
            {cell.virtual ? <CoverageMarker os={os} run={cell.virtual} physical={false} /> : null}
            {cell.physical ? <CoverageMarker os={os} run={cell.physical} physical /> : null}
          </span>
        );
      })}
    </div>
  );
}

const MARKER_TONES: Partial<Record<QaRunStatus, string>> = {
  passed: "bg-success/15 text-success-foreground",
  failed: "bg-destructive/15 text-destructive-foreground",
  running: "bg-info/15 text-info-foreground",
};

function CoverageMarker({ os, run, physical }: { os: string; run: QaRun; physical: boolean }) {
  const Icon = physical ? SmartphoneIcon : MonitorIcon;
  const label = `${os} on a ${physical ? "physical device" : "virtual device"}: ${QA_STATUS_WORDS[run.status]} · ${run.suite.name} · ${qaWhen(run.startedAt)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className={`flex size-5 items-center justify-center rounded ${MARKER_TONES[run.status] ?? "bg-muted text-muted-foreground"}`}
          />
        }
      >
        <Icon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

const QA_STATUS_WORDS: Record<QaRunStatus, string> = {
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "interrupted",
  incomplete: "not run",
};

function CommitCell({ run, commit }: { run: QaRun | undefined; commit: string | null }) {
  if (!run?.commit) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="whitespace-nowrap font-mono text-xs">
      {run.commit.slice(0, 7)}
      {commit && run.commit === commit ? (
        <span className="ml-1 rounded bg-success/10 px-1 font-sans text-success-foreground">
          latest
        </span>
      ) : null}
    </span>
  );
}

function SuiteRows({
  entry,
  showComponent,
  context,
}: {
  entry: QaDashboardEntry;
  showComponent: boolean;
  context: QaDashboardContext;
}) {
  const { suite, run, lanes, component, kind } = entry;
  const { devices, canRun, canCancel } = context;
  const separate = lanes.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const assignments =
    suite.devices?.length && !devices.simlock
      ? devices.pool &&
        qaDeviceAssignments(suite, devices.pool, devices.selections, devices.projectId)
      : undefined;
  // A suite waiting for a busy device can still run; it starts when the device is free.
  const blockedDevices = new Set(
    assignments?.flatMap((assignment) =>
      !assignment.device && !assignment.busy ? [assignment.key] : [],
    ),
  );
  const blocked = separate
    ? lanes.every(({ lane }) => blockedDevices.has(lane.device))
    : blockedDevices.size > 0;
  const chosen = lanes.flatMap(({ lane }) =>
    selected.has(lane.key) && !blockedDevices.has(lane.device) ? [lane.key] : [],
  );
  const runLanes = (keys?: ReadonlyArray<string>) => {
    setSelected(new Set());
    context.onRun(suite.id, keys);
  };
  const tone = entryTone(entry);
  const running = run?.status === "running";
  const latest = separate
    ? lanes
        .flatMap(({ run: laneRun }) => (laneRun ? [laneRun] : []))
        .toSorted((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]
    : run;
  return (
    <tbody aria-label={suite.name}>
      <tr className={`border-t border-border/60 ${tone === "failed" ? "bg-error/5" : ""}`}>
        <td className="py-1.5 pr-2 pl-3">
          <div className="flex min-w-0 items-center gap-1.5 pl-1">
            <Button
              variant="ghost"
              size="icon-micro"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} details of ${suite.name}`}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronRightIcon className={expanded ? "rotate-90" : ""} />
            </Button>
            <span className="font-medium wrap-anywhere">{suite.name}</span>
            <TestKind kind={kind} />
            {showComponent ? (
              <span className="shrink-0 text-xs text-muted-foreground">{component}</span>
            ) : null}
            {blocked ? (
              <Badge variant="warning">
                <CircleAlertIcon /> Blocked
              </Badge>
            ) : null}
          </div>
        </td>
        <td className={`px-2 py-1.5 ${TONES[tone].text}`}>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <ToneIcon tone={tone} />
            {separate ? qaLanesHeadline(lanes) : qaRunHeadline(run)}
          </span>
        </td>
        <td className="px-2 py-1.5">
          <CommitCell run={latest} commit={context.commit} />
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
          {latest ? qaWhen(latest.startedAt) : "–"}
        </td>
        <td className="py-1.5 pr-3 pl-2 text-right">
          {running && run ? (
            <Button
              variant="outline"
              size="compact"
              disabled={!canCancel}
              onClick={() => context.onCancel(run.id)}
            >
              <SquareIcon /> Cancel
            </Button>
          ) : (
            <Button
              variant="outline"
              size="compact"
              disabled={!canRun || blocked}
              onClick={() => runLanes(chosen.length ? chosen : undefined)}
            >
              <PlayIcon />
              {!separate
                ? run
                  ? "Rerun"
                  : "Run"
                : chosen.length
                  ? `Run ${chosen.length} selected`
                  : lanes.length === 2
                    ? "Run both"
                    : "Run all"}
            </Button>
          )}
        </td>
      </tr>
      {qaLaneSections(lanes).flatMap((section) => [
        ...(section.title
          ? [
              <tr key={`${section.title}:title`}>
                <td
                  colSpan={COLUMNS}
                  className="pt-1.5 pr-3 pb-0.5 pl-14 text-xs text-muted-foreground"
                >
                  {section.title}
                </td>
              </tr>,
            ]
          : []),
        ...section.lanes.map((result) => (
          <LaneRow
            key={result.lane.key}
            result={result}
            indented={section.title !== null}
            commit={context.commit}
            selected={selected.has(result.lane.key)}
            canRun={canRun && !blockedDevices.has(result.lane.device)}
            onSelect={(on) => {
              const next = new Set(selected);
              if (on) next.add(result.lane.key);
              else next.delete(result.lane.key);
              setSelected(next);
            }}
            onRun={() => runLanes([result.lane.key])}
            onView={context.onView}
          />
        )),
      ])}
      {running && run?.steps && !separate ? (
        <tr>
          <td colSpan={COLUMNS} className="px-3 pt-1 pb-3 pl-12">
            <QaRunActivity
              environmentId={context.environmentId}
              projectId={context.projectId}
              run={run}
            />
          </td>
        </tr>
      ) : null}
      {expanded ? (
        <tr>
          <td colSpan={COLUMNS} className="px-3 pt-1 pb-3 pl-12">
            <SuiteDetails
              entry={entry}
              assignments={assignments}
              context={context}
              showActivity={running && separate}
            />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

/** One lane: the OS and device it ran on, and its own result. */
function LaneRow({
  result,
  indented,
  commit,
  selected,
  canRun,
  onSelect,
  onRun,
  onView,
}: {
  result: QaLaneResult;
  indented: boolean;
  commit: string | null;
  selected: boolean;
  canRun: boolean;
  onSelect: (selected: boolean) => void;
  onRun: () => void;
  onView: (runId: string) => void;
}) {
  const { lane, run, outcome } = result;
  const device = run?.devices?.find((candidate) => candidate.requirement === lane.device);
  const label = qaLaneLabel(lane);
  const busy = outcome === "running" || outcome === "queued";
  const headline = qaLaneHeadline(result);
  return (
    <tr className={outcome === "failed" ? "bg-error/5" : ""}>
      <td className={`py-1 pr-2 ${indented ? "pl-14" : "pl-11"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            aria-label={`Select ${label}`}
            checked={selected}
            disabled={!canRun || busy}
            onCheckedChange={(checked) => onSelect(checked === true)}
          />
          <span className="whitespace-nowrap font-medium">{qaLaneDeviceLabel(lane)}</span>
          {device ? (
            <>
              <span className="min-w-0 text-xs wrap-anywhere text-muted-foreground">
                {device.name}
                {device.version && !lane.os ? ` · ${device.version}` : ""}
              </span>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded border px-1 text-xs ${device.physical ? "border-guest/40 bg-guest/10 text-guest-foreground" : "border-border text-muted-foreground"}`}
              >
                {device.physical ? (
                  <SmartphoneIcon className="size-3" />
                ) : (
                  <MonitorIcon className="size-3" />
                )}
                {qaDeviceKind(device)}
              </span>
            </>
          ) : null}
        </div>
      </td>
      <td className={`px-2 py-1 text-xs ${TONES[outcome].text}`}>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <ToneIcon tone={outcome} />
          {headline}
        </span>
      </td>
      <td className="px-2 py-1">
        <CommitCell run={run} commit={commit} />
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
        {run ? qaWhen(run.startedAt) : "–"}
      </td>
      <td className="py-1 pr-3 pl-2 text-right whitespace-nowrap">
        {run ? (
          <Button
            variant="ghost"
            size="icon-micro"
            aria-label={`View ${label} ${run.summary && !run.repositoryFile ? "tests" : "output"}`}
            title={run.summary && !run.repositoryFile ? `Tests (${run.summary.tests})` : "Output"}
            onClick={() => onView(run.id)}
          >
            <FileTextIcon />
          </Button>
        ) : null}
        {busy ? null : (
          <Button
            variant="ghost"
            size="icon-micro"
            aria-label={`Run ${label}${run ? " again" : ""}`}
            title={`Run ${label} only`}
            disabled={!canRun}
            onClick={onRun}
          >
            <RotateCwIcon />
          </Button>
        )}
      </td>
    </tr>
  );
}

/** What a suite row opens: its devices, why it failed, its freshness, and its command. */
function SuiteDetails({
  entry,
  assignments,
  context,
  showActivity,
}: {
  entry: QaDashboardEntry;
  assignments: ReturnType<typeof qaDeviceAssignments> | null | undefined;
  context: QaDashboardContext;
  showActivity: boolean;
}) {
  const { suite, run, lanes, freshness } = entry;
  const separate = lanes.length > 0;
  const { devices } = context;
  const problems = lanes.filter(
    ({ outcome, run: laneRun }) => (outcome === "failed" || outcome === "not-run") && laneRun,
  );
  const active = lanes.find(({ outcome }) => outcome === "running")?.run;
  return (
    <div className="grid gap-3 text-xs">
      {showActivity && active?.steps ? (
        <QaRunActivity
          environmentId={context.environmentId}
          projectId={context.projectId}
          run={active}
        />
      ) : null}
      {suite.devices?.length && devices.simlock ? (
        <QaSimlockDevices requirements={suite.devices} />
      ) : assignments !== undefined ? (
        <QaSuiteDevices
          assignments={assignments}
          canChoose={devices.canChoose}
          onChoose={(requirement, deviceKey) => devices.onChoose(suite.id, requirement, deviceKey)}
        />
      ) : null}
      {run?.outputTail && !separate ? (
        <div className="rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="font-medium text-destructive-foreground">
            Failure output{run.exitCode !== null ? ` · Exit ${run.exitCode}` : ""}
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
            {run.outputTail}
          </pre>
        </div>
      ) : null}
      {problems.map(({ lane, run: laneRun, outcome }) => (
        <div
          key={lane.key}
          className={`rounded-lg p-3 ${outcome === "failed" ? "border border-error/20 bg-error/5" : "bg-muted/40"}`}
        >
          <p className="font-medium">{qaLaneLabel(lane)}</p>
          {laneRun?.note ? <p className="mt-1 text-muted-foreground">{laneRun.note}</p> : null}
          {outcome === "failed" && laneRun?.outputTail ? (
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono">
              {qaOutputTail(laneRun.outputTail, 4)}
            </pre>
          ) : null}
        </div>
      ))}
      {run?.note && !separate ? <p className="text-muted-foreground">{run.note}</p> : null}
      {freshness ? (
        <div className="rounded-lg bg-muted/40 p-3">
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
          {entry.category !== "passed" ? (
            <p className="mt-2 text-muted-foreground">
              {freshness.lastPassedAt
                ? `Last passed ${qaWhen(freshness.lastPassedAt)}`
                : "No successful run recorded"}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="text-muted-foreground">
        <p className="font-medium text-foreground">Command</p>
        <p className="mt-1 break-all rounded-lg bg-muted/40 p-3 font-mono">
          {suite.cwd ? `${suite.cwd} › ` : ""}
          {suite.command}
        </p>
      </div>
      {run && !separate ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {[
              run.devices?.length
                ? `On ${run.devices.map((device) => device.name).join(", ")}`
                : null,
              run.repositoryFile ? qaRunSource(run) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <Button variant="ghost" size="sm" onClick={() => context.onView(run.id)}>
            {run.summary && !run.repositoryFile ? `View tests (${run.summary.tests})` : "View run"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
