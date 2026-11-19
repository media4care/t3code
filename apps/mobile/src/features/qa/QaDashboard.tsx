import { Image } from "expo-image";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View, type TextInputInstance } from "react-native";
import {
  QA_FILTER_OPTIONS,
  QA_GROUP_OPTIONS,
  QA_KIND_LABELS,
  groupQaSuites,
  qaAttention,
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
  qaOutputTail,
  qaRunHeadline,
  qaRunSource,
  qaWhen,
  type QaAttentionItem,
  type QaCoverageCell,
  type QaDashboardEntry,
  type QaGrouping,
  type QaLaneOutcome,
  type QaLaneResult,
  type QaResultFilter,
  type QaSuiteGroup,
  type qaDashboard,
} from "@t3tools/client-runtime/qa";
import type {
  EnvironmentId,
  ProjectId,
  QaApp,
  QaRunDevice,
  QaRunStatus,
  QaSnapshot,
  QaTestKind,
} from "@t3tools/contracts";
import { qaOsLabel } from "@t3tools/shared/qaDevices";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { SearchField } from "../../components/ui/SearchField";
import { ListFilterMenu, ListFilterRow } from "../layout/workspace/ListFilterMenu";
import { QaRunActivity } from "./QaRunProgress";

const RESULTS = {
  passed: "text-adaptive-emerald-700-300",
  attention: "text-warning-foreground",
  running: "text-update-foreground",
  never: "text-foreground-muted",
};

const TONES = {
  passed: { text: "text-adaptive-emerald-700-300", bar: "bg-adaptive-emerald-600-400" },
  failed: { text: "text-danger-foreground", bar: "bg-danger-foreground" },
  "not-run": { text: "text-warning-foreground", bar: "bg-warning-foreground" },
  stale: { text: "text-warning-foreground", bar: "bg-warning-foreground" },
  running: { text: "text-update-foreground", bar: "bg-update-foreground" },
  queued: { text: "text-foreground-muted", bar: "bg-foreground-muted/35" },
  never: { text: "text-foreground-muted", bar: "bg-foreground-muted/35" },
} satisfies Record<QaLaneOutcome | "stale", { text: string; bar: string }>;

const RUN_TINTS: Partial<Record<QaRunStatus, string>> = {
  passed: "accent-adaptive-emerald-700-300",
  failed: "accent-danger-foreground",
  running: "accent-update-foreground",
};

type Icons = Readonly<Record<string, string>>;

interface RunActions {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  canRun: boolean;
  canCancel: boolean;
  onRun: (id: string, lanes?: ReadonlyArray<string>) => void;
  onCancel: (id: string) => void;
  onView: (id: string) => void;
}

export function QaDashboard({
  entries,
  counts,
  snapshot,
  ...actions
}: RunActions & {
  entries: readonly QaDashboardEntry[];
  counts: ReturnType<typeof qaDashboard>["counts"];
  snapshot: QaSnapshot;
}) {
  const [grouping, setGrouping] = useState<QaGrouping>("app");
  const [filter, setFilter] = useState<QaResultFilter>("all");
  const [search, setSearch] = useState("");
  const inputRef = useRef<TextInputInstance>(null);
  const apps = snapshot.apps ?? [];
  const icons = snapshot.icons ?? {};
  const commit = snapshot.checkout?.commit ?? null;
  const runs = [...snapshot.latestRuns, ...snapshot.recentRuns];
  const tiles = groupQaSuites(entries, "app", "", "all", apps).filter((group) => !group.other);
  const attention = qaAttention(entries);
  const groups = groupQaSuites(entries, grouping, search, filter, apps);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  return (
    <View className="gap-5">
      {tiles.length ? (
        <Section title="On the latest commit" meta={commit?.slice(0, 7)}>
          <RowCard>
            {tiles.map((group, index) => (
              <GroupTile
                key={group.key}
                group={group}
                commit={commit}
                icons={icons}
                first={index === 0}
              />
            ))}
          </RowCard>
        </Section>
      ) : null}
      {attention.length ? (
        <Section title="Needs attention" meta={String(attention.length)}>
          <RowCard>
            {attention.map((item, index) => (
              <AttentionRow
                key={item.key}
                item={item}
                apps={apps}
                icons={icons}
                first={index === 0}
                {...actions}
              />
            ))}
          </RowCard>
        </Section>
      ) : null}
      <View className="flex-row">
        <SearchField
          inputRef={inputRef}
          autoFocus={false}
          accessibilityLabel="Search suites"
          clearAccessibilityLabel="Clear suite search"
          placeholder="Search suites, apps, types…"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ListFilterRow>
        <ListFilterMenu
          label={QA_GROUP_OPTIONS.find(({ value }) => value === grouping)?.label ?? "Group"}
          accessibilityLabel="Group suites by"
          actions={QA_GROUP_OPTIONS.map(({ value, label }) => ({
            id: value,
            title: label,
            state: value === grouping ? ("on" as const) : ("off" as const),
          }))}
          onSelect={(id) => {
            const option = QA_GROUP_OPTIONS.find(({ value }) => value === id);
            if (option) setGrouping(option.value);
          }}
        />
        <ListFilterMenu
          label={QA_FILTER_OPTIONS.find(({ value }) => value === filter)?.label ?? "Results"}
          active={filter !== "all"}
          accessibilityLabel="Filter suite results"
          actions={QA_FILTER_OPTIONS.map(({ value, label }) => ({
            id: value,
            title: label,
            state: value === filter ? ("on" as const) : ("off" as const),
          }))}
          onSelect={(id) => {
            const option = QA_FILTER_OPTIONS.find(({ value }) => value === id);
            if (option) setFilter(option.value);
          }}
        />
      </ListFilterRow>
      <Text className="text-xs text-foreground-muted">
        {visibleCount} of {counts.total} suites
      </Text>
      {groups.map((group) => (
        <SuiteGroup
          key={`${grouping}:${group.key}`}
          group={group}
          apps={group.apps}
          coverage={group.other ? [] : qaDeviceCoverage(qaGroupSuiteIds(group, entries), runs)}
          icons={icons}
          {...actions}
        />
      ))}
      {groups.length === 0 ? (
        <View className="gap-3 rounded-xl border border-border-subtle p-6">
          <Text>No suites match these filters</Text>
          <Button
            label="Clear filters"
            icon="xmark"
            tone="text"
            onPress={() => {
              setSearch("");
              setFilter("all");
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center px-1">
        <Text className="flex-1 font-t3-medium text-xs uppercase tracking-wide text-foreground-muted">
          {title}
        </Text>
        {meta ? <Text className="text-xs text-foreground-muted">{meta}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function RowCard({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-border-subtle bg-card">
      {children}
    </View>
  );
}

function AppIcons({
  apps,
  icons,
  size,
  ring,
}: {
  apps: ReadonlyArray<QaApp>;
  icons: Icons;
  size: number;
  ring: "border-card" | "border-screen";
}) {
  const sources = apps.flatMap((app) => {
    const icon = icons[app.id];
    return icon ? [icon] : [];
  });
  const radius = Math.round(size * 0.24);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {sources.length === 0 ? (
        <View
          style={{ width: size, height: size, borderRadius: radius }}
          className="items-center justify-center bg-subtle"
        >
          <SymbolView
            name={apps.length ? "cube" : "server.rack"}
            size={Math.round(size * 0.5)}
            tintColorClassName="accent-foreground-muted"
          />
        </View>
      ) : sources.length === 1 ? (
        <Image
          source={{ uri: sources[0] }}
          style={{ width: size, height: size, borderRadius: radius }}
        />
      ) : (
        <View style={{ width: size * 1.45, height: size }}>
          {sources.slice(0, 2).map((uri, index) => (
            <View
              key={uri}
              style={{
                position: "absolute",
                top: -2,
                left: index * size * 0.45 - 2,
                borderRadius: radius + 2,
              }}
              className={`overflow-hidden border-2 ${ring}`}
            >
              <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function OutcomeBar({ cells }: { cells: ReadonlyArray<{ key: string; outcome: QaLaneOutcome }> }) {
  if (!cells.length) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="h-1.5 w-12 flex-row gap-0.5"
    >
      {cells.map(({ key, outcome }) => (
        <View key={key} className={`flex-1 rounded-sm ${TONES[outcome].bar}`} />
      ))}
    </View>
  );
}

function GroupTile({
  group,
  commit,
  icons,
  first,
}: {
  group: QaSuiteGroup;
  commit: string | null;
  icons: Icons;
  first: boolean;
}) {
  const summary = qaGroupSummary(group.entries, commit);
  return (
    <View
      accessible
      accessibilityLabel={`${group.label}: ${summary.headline}, ${summary.detail}`}
      className={`flex-row items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-border-subtle"}`}
    >
      <AppIcons apps={group.apps} icons={icons} size={30} ring="border-card" />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-t3-semibold text-sm">
          {group.label}
        </Text>
        <Text numberOfLines={1} className="text-xs text-foreground-muted">
          <Text className={`font-t3-medium text-xs ${TONES[summary.tone].text}`}>
            {summary.headline}
          </Text>
          {` · ${summary.detail}`}
        </Text>
      </View>
      <OutcomeBar cells={summary.cells} />
    </View>
  );
}

function RowAction({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: AppSymbolName;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      className={`size-9 items-center justify-center rounded-full bg-subtle ${disabled ? "opacity-40" : ""}`}
    >
      <SymbolView name={icon} size={14} tintColorClassName="accent-foreground" />
    </Pressable>
  );
}

function AttentionRow({
  item: { entry, lane, run, reason },
  apps,
  icons,
  first,
  canRun,
  onRun,
  onView,
}: RunActions & {
  item: QaAttentionItem;
  apps: ReadonlyArray<QaApp>;
  icons: Icons;
  first: boolean;
}) {
  const tested = (entry.suite.apps ?? []).flatMap((id) => apps.filter((app) => app.id === id));
  const title = [
    tested.map((app) => app.name).join(" + "),
    entry.suite.name,
    lane ? qaLaneLabel(lane) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const detail =
    reason === "failed"
      ? `${qaRunHeadline(run)}${run ? ` · ${qaWhen(run.startedAt)}` : ""}`
      : reason === "not-run"
        ? (run?.note ?? "Not run")
        : (entry.freshness?.reason ?? "Inputs changed");
  return (
    <View
      className={`flex-row items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-border-subtle"}`}
    >
      <AppIcons apps={tested} icons={icons} size={26} ring="border-card" />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-t3-semibold text-sm">
          {title}
        </Text>
        <Text numberOfLines={2} className={`text-xs ${TONES[reason].text}`}>
          {detail}
        </Text>
      </View>
      {run ? <RowAction label={`View ${title}`} icon="eye" onPress={() => onView(run.id)} /> : null}
      <RowAction
        label={`${run ? "Rerun" : "Run"} ${title}`}
        icon={run ? "arrow.clockwise" : "play"}
        disabled={!canRun}
        onPress={() => onRun(entry.suite.id, lane ? [lane.key] : undefined)}
      />
    </View>
  );
}

function SuiteGroup({
  group,
  apps,
  coverage,
  icons,
  ...actions
}: RunActions & {
  group: QaSuiteGroup;
  apps: ReadonlyArray<QaApp>;
  coverage: ReadonlyArray<QaCoverageCell>;
  icons: Icons;
}) {
  const [open, setOpen] = useState(!group.other);
  const { detail } = qaGroupSummary(group.entries, null);
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.label}, ${detail}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="min-h-11 flex-row items-center gap-2.5 px-1"
      >
        <AppIcons apps={apps} icons={icons} size={22} ring="border-screen" />
        <Text numberOfLines={1} className="flex-1 font-t3-semibold text-base">
          {group.label}
        </Text>
        <Text className="text-xs text-foreground-muted">{detail}</Text>
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      {open && coverage.length ? <DeviceCoverage cells={coverage} /> : null}
      {open ? (
        <RowCard>
          {group.entries.map((entry, index) => (
            <SuiteRow key={entry.suite.id} entry={entry} first={index === 0} {...actions} />
          ))}
        </RowCard>
      ) : null}
    </View>
  );
}

function DeviceCoverage({ cells }: { cells: ReadonlyArray<QaCoverageCell> }) {
  return (
    <View accessibilityLabel="Devices tested" className="flex-row flex-wrap gap-1.5 px-1">
      {cells.map((cell) => {
        const label = qaOsLabel(cell.platform, cell.os);
        const runs = [
          { kind: "virtual", icon: "desktopcomputer", run: cell.virtual },
          { kind: "physical", icon: "iphone", run: cell.physical },
        ] as const;
        const ran = runs.flatMap(({ kind, icon, run }) => (run ? [{ kind, icon, run }] : []));
        const failed = ran.some(({ run }) => run.status === "failed");
        return (
          <View
            key={`${cell.platform}:${cell.os}`}
            accessible
            accessibilityLabel={`${label}: ${ran.map(({ kind, run }) => `${kind} ${run.status}`).join(", ")}`}
            className={`flex-row items-center gap-1 rounded-lg border px-2 py-1 ${failed ? "border-danger-border bg-danger" : "border-border-subtle"}`}
          >
            <Text className="font-t3-medium text-xs">{label}</Text>
            {ran.map(({ kind, icon, run }) => (
              <SymbolView
                key={kind}
                name={icon}
                size={11}
                tintColorClassName={RUN_TINTS[run.status] ?? "accent-foreground-muted"}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const KINDS = {
  unit: {
    icon: "flask",
    background: "bg-adaptive-emerald-500-a12-a16",
    text: "text-adaptive-emerald-700-300",
    tint: "accent-adaptive-emerald-700-300",
  },
  integration: {
    icon: "puzzlepiece",
    background: "bg-warning",
    text: "text-warning-foreground",
    tint: "accent-warning-foreground",
  },
  playwright: {
    icon: "globe",
    background: "bg-update",
    text: "text-update-foreground",
    tint: "accent-update-foreground",
  },
  maestro: {
    icon: "iphone",
    background: "bg-adaptive-violet-500-a12-a16",
    text: "text-adaptive-violet-700-300",
    tint: "accent-adaptive-violet-700-300",
  },
  e2e: {
    icon: "point.topleft.down.to.point.bottomright.curvepath",
    background: "bg-adaptive-rose-500-a12-a16",
    text: "text-adaptive-rose-700-300",
    tint: "accent-adaptive-rose-700-300",
  },
  tooling: {
    icon: "terminal",
    background: "bg-subtle-strong",
    text: "text-foreground-secondary",
    tint: "accent-foreground-secondary",
  },
  other: {
    icon: "cube",
    background: "bg-subtle",
    text: "text-foreground-muted",
    tint: "accent-foreground-muted",
  },
} satisfies Record<
  QaTestKind,
  { icon: AppSymbolName; background: string; text: string; tint: string }
>;

function TestKind({ kind }: { kind: QaTestKind }) {
  const style = KINDS[kind];
  return (
    <View className={`flex-row items-center gap-1 rounded px-1.5 py-0.5 ${style.background}`}>
      <SymbolView name={style.icon} size={11} tintColorClassName={style.tint} />
      <Text className={`font-t3-medium text-xs ${style.text}`}>{QA_KIND_LABELS[kind]}</Text>
    </View>
  );
}

const STATUS_ICONS = {
  passed: {
    name: "checkmark",
    tint: "accent-adaptive-emerald-700-300",
    background: "bg-adaptive-emerald-500-a12-a16",
  },
  failed: { name: "xmark", tint: "accent-danger-foreground", background: "bg-danger" },
  attention: {
    name: "exclamationmark.triangle",
    tint: "accent-warning-foreground",
    background: "bg-warning",
  },
  never: { name: "circle.dashed", tint: "accent-foreground-muted", background: "bg-subtle" },
} satisfies Record<string, { name: AppSymbolName; tint: string; background: string }>;

function StatusIcon({
  status,
  category,
}: {
  status: QaRunStatus | undefined;
  category: QaDashboardEntry["category"];
}) {
  const icon =
    status === "failed"
      ? STATUS_ICONS.failed
      : category === "running"
        ? null
        : STATUS_ICONS[category];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`size-7 items-center justify-center rounded-full ${icon?.background ?? "bg-update"}`}
    >
      {icon ? (
        <SymbolView name={icon.name} size={13} tintColorClassName={icon.tint} />
      ) : (
        <AppActivityIndicator
          size="small"
          colorClassName="accent-update-foreground"
          style={{ transform: [{ scale: 0.7 }] }}
        />
      )}
    </View>
  );
}

function SuiteRow({
  entry,
  first,
  canRun,
  canCancel,
  onRun,
  onCancel,
  ...actions
}: RunActions & {
  entry: QaDashboardEntry;
  first: boolean;
}) {
  const { suite, run, lanes, kind, category, freshness } = entry;
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const running = run?.status === "running";
  const separate = lanes.length > 0;
  const chosen = lanes.flatMap(({ lane }) => (selected.has(lane.key) ? [lane.key] : []));
  const headline = separate ? qaLanesHeadline(lanes) : qaRunHeadline(run);
  const stale = freshness?.state === "stale";
  const runLanes = (keys?: ReadonlyArray<string>) => {
    setSelected(new Set());
    onRun(suite.id, keys);
  };
  return (
    <View className={first ? "" : "border-t border-border-subtle"}>
      <View className="flex-row items-center gap-2 py-1.5 pl-3 pr-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${suite.name}: ${headline}${stale ? ", needs rerun" : ""}`}
          accessibilityHint={expanded ? "Hides details" : "Shows details"}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          className="min-h-11 flex-1 flex-row items-center gap-3 py-1"
        >
          <StatusIcon status={run?.status} category={category} />
          <View className="flex-1 gap-1">
            <Text numberOfLines={1} className="font-t3-semibold text-sm">
              {suite.name}
            </Text>
            <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
              <TestKind kind={kind} />
              <Text className="shrink text-xs text-foreground-muted">
                <Text
                  className={`text-xs ${run?.status === "failed" ? "text-danger-foreground" : RESULTS[category]}`}
                >
                  {headline}
                </Text>
                {run ? ` · ${qaWhen(run.startedAt)}` : ""}
                {stale ? (
                  <Text className="text-xs text-warning-foreground"> · Needs rerun</Text>
                ) : null}
              </Text>
            </View>
          </View>
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.right"}
            size={11}
            tintColorClassName="accent-foreground-muted"
          />
        </Pressable>
        {running ? (
          <IconButton
            accessibilityLabel={`Cancel ${suite.name}`}
            icon="stop.fill"
            variant="danger"
            disabled={!canCancel}
            onPress={() => onCancel(run.id)}
          />
        ) : chosen.length ? (
          <Button
            label={`Run ${chosen.length}`}
            accessibilityLabel={`Run ${chosen.length} selected`}
            icon="play"
            tone="primary"
            size="compact"
            disabled={!canRun}
            onPress={() => runLanes(chosen)}
          />
        ) : (
          <IconButton
            accessibilityLabel={
              !separate
                ? `Run ${suite.name}`
                : lanes.length === 2
                  ? `Run both ${suite.name} lanes`
                  : `Run all ${suite.name} lanes`
            }
            icon="play"
            variant="tonal"
            disabled={!canRun}
            onPress={() => runLanes()}
          />
        )}
      </View>
      {expanded ? <SuiteDetails entry={entry} {...actions} /> : null}
      {separate ? (
        <LaneRows
          lanes={lanes}
          canRun={canRun}
          expanded={expanded}
          selected={selected}
          onSelect={(key) => {
            const next = new Set(selected);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setSelected(next);
          }}
          onRun={(lane) => runLanes([lane])}
          onView={actions.onView}
        />
      ) : null}
    </View>
  );
}

function SuiteDetails({
  entry: { suite, run, lanes, component, category, freshness },
  environmentId,
  projectId,
  onView,
}: Pick<RunActions, "environmentId" | "projectId" | "onView"> & { entry: QaDashboardEntry }) {
  const separate = lanes.length > 0;
  const meta = [
    component,
    separate
      ? suite.variants
        ? "Each device and variant runs on its own"
        : "Each device runs on its own"
      : null,
    run?.repositoryFile ? qaRunSource(run) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View className="gap-3 px-3 pb-3">
      <Text className="text-xs text-foreground-muted">{meta}</Text>
      {run && !separate ? (
        <Button
          label="Open run"
          icon="doc.text"
          tone="text"
          size="compact"
          onPress={() => onView(run.id)}
        />
      ) : null}
      {run?.outputTail && !separate ? (
        <View className="gap-2 rounded-lg bg-danger p-3">
          <Text className="font-t3-semibold text-xs text-danger-foreground">
            Failure output{run.exitCode !== null ? ` · Exit ${run.exitCode}` : ""}
          </Text>
          <View className="max-h-40">
            <ScrollView nestedScrollEnabled>
              <Text selectable className="font-mono text-xs">
                {run.outputTail}
              </Text>
            </ScrollView>
          </View>
          <Text className="text-xs text-foreground-muted">
            Recent output. Open the run for more.
          </Text>
        </View>
      ) : null}
      {run?.status === "running" && run.steps ? (
        <QaRunActivity environmentId={environmentId} projectId={projectId} run={run} />
      ) : null}
      {freshness?.state === "stale" ? (
        <View className="gap-2 rounded-lg bg-subtle p-3">
          <Text className="text-warning-foreground">{qaFreshnessLabel(freshness)}</Text>
          <Text className="text-xs text-foreground-muted">{freshness.reason}</Text>
          {freshness.changedPaths.map((path) => (
            <Text key={path} className="font-mono text-xs text-foreground-muted">
              {path}
            </Text>
          ))}
          {freshness.changedFileCount > freshness.changedPaths.length ? (
            <Text className="text-xs text-foreground-muted">
              Showing the first {freshness.changedPaths.length} of {freshness.changedFileCount}{" "}
              changed paths.
            </Text>
          ) : null}
          {category !== "passed" && freshness.lastPassedAt ? (
            <Text className="text-xs text-foreground-muted">
              Last passed {qaWhen(freshness.lastPassedAt)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {run?.note && !separate ? (
        <Text className="text-xs text-foreground-muted">{run.note}</Text>
      ) : null}
      <Text selectable className="font-mono text-xs text-foreground-muted">
        {suite.cwd ? `${suite.cwd} › ` : ""}
        {suite.command}
      </Text>
    </View>
  );
}

const LANE_ICONS: Record<
  Exclude<QaLaneOutcome, "running">,
  { name: AppSymbolName; tint: string; background: string }
> = {
  passed: STATUS_ICONS.passed,
  failed: STATUS_ICONS.failed,
  "not-run": STATUS_ICONS.attention,
  queued: { name: "clock", tint: "accent-foreground-muted", background: "bg-subtle" },
  never: STATUS_ICONS.never,
};

function DeviceKind({ device }: { device: QaRunDevice }) {
  return (
    <View
      className={`flex-row items-center gap-1 rounded px-1.5 py-px ${device.physical ? "bg-adaptive-violet-500-a12-a16" : "bg-subtle"}`}
    >
      {device.physical ? (
        <SymbolView name="iphone" size={10} tintColorClassName="accent-adaptive-violet-700-300" />
      ) : null}
      <Text
        className={`font-t3-medium text-[11px] ${device.physical ? "text-adaptive-violet-700-300" : "text-foreground-muted"}`}
      >
        {qaDeviceKind(device)}
      </Text>
    </View>
  );
}

function LaneRows({
  lanes,
  canRun,
  expanded,
  selected,
  onSelect,
  onRun,
  onView,
}: {
  lanes: ReadonlyArray<QaLaneResult>;
  canRun: boolean;
  expanded: boolean;
  selected: ReadonlySet<string>;
  onSelect: (lane: string) => void;
  onRun: (lane: string) => void;
  onView: (id: string) => void;
}) {
  return (
    <View className="pb-2">
      {qaLaneSections(lanes).map((section) => (
        <View key={section.title ?? ""}>
          {section.title ? (
            <Text className="pb-0.5 pl-12 pr-3 pt-1.5 font-t3-medium text-xs text-foreground-muted">
              {section.title}
            </Text>
          ) : null}
          {section.lanes.map((result) => {
            const { lane, run, outcome } = result;
            const label = qaLaneLabel(lane);
            const icon = outcome === "running" ? null : LANE_ICONS[outcome];
            const busy = outcome === "running" || outcome === "queued";
            const headline =
              run && !busy
                ? `${qaLaneHeadline(result)} · ${qaWhen(run.startedAt)}`
                : qaLaneHeadline(result);
            return (
              <View key={lane.key} className="gap-1.5 py-1 pl-4 pr-2">
                <View className="flex-row items-center gap-2">
                  <View className="w-7 items-center">
                    {busy ? null : (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Select ${label}`}
                        accessibilityState={{ checked: selected.has(lane.key), disabled: !canRun }}
                        disabled={!canRun}
                        hitSlop={8}
                        onPress={() => onSelect(lane.key)}
                        className={canRun ? "" : "opacity-40"}
                      >
                        <SymbolView
                          name={selected.has(lane.key) ? "checkmark.circle.fill" : "circle"}
                          size={18}
                          tintColorClassName="accent-primary-text"
                        />
                      </Pressable>
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label}: ${headline}`}
                    accessibilityHint={run ? "Opens the run" : undefined}
                    disabled={!run}
                    onPress={() => run && onView(run.id)}
                    className="min-h-11 flex-1 flex-row items-center gap-2.5"
                  >
                    <View
                      className={`size-5 items-center justify-center rounded-full ${icon?.background ?? "bg-update"}`}
                    >
                      {icon ? (
                        <SymbolView name={icon.name} size={10} tintColorClassName={icon.tint} />
                      ) : (
                        <AppActivityIndicator
                          size="small"
                          colorClassName="accent-update-foreground"
                          style={{ transform: [{ scale: 0.5 }] }}
                        />
                      )}
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text numberOfLines={1} className="font-t3-medium text-sm">
                        {qaLaneDeviceLabel(lane)}
                      </Text>
                      {run?.devices?.map((device) => (
                        <View
                          key={device.deviceId}
                          className="flex-row flex-wrap items-center gap-1.5"
                        >
                          <Text numberOfLines={1} className="shrink text-xs text-foreground-muted">
                            {device.name}
                            {device.version && !lane.os ? ` · ${device.version}` : ""}
                          </Text>
                          <DeviceKind device={device} />
                        </View>
                      ))}
                      <Text className={`text-xs ${TONES[outcome].text}`}>{headline}</Text>
                      {run?.note && outcome !== "passed" && !busy ? (
                        <Text className="text-xs text-foreground-muted">{run.note}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {busy ? null : (
                    <RowAction
                      label={`Run ${label}${run ? " again" : ""}`}
                      icon={run ? "arrow.clockwise" : "play"}
                      disabled={!canRun}
                      onPress={() => onRun(lane.key)}
                    />
                  )}
                </View>
                {expanded && outcome === "failed" && run?.outputTail ? (
                  <View className="ml-9 rounded-lg bg-danger p-2">
                    <Text selectable className="font-mono text-xs">
                      {qaOutputTail(run.outputTail, 4)}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
