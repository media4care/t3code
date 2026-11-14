import { useRef, useState } from "react";
import { Pressable, ScrollView, View, type TextInputInstance } from "react-native";
import {
  QA_FILTER_OPTIONS,
  QA_GROUP_OPTIONS,
  QA_KIND_LABELS,
  groupQaSuites,
  qaRunDuration,
  qaRunSource,
  qaRunSummary,
  qaStatusLabel,
  qaFreshnessLabel,
  type QaDashboardEntry,
  type QaGrouping,
  type QaResultFilter,
  type qaDashboard,
} from "@t3tools/client-runtime/qa";
import type { EnvironmentId, ProjectId, QaTestKind } from "@t3tools/contracts";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { SearchField } from "../../components/ui/SearchField";
import { ListFilterMenu, ListFilterRow } from "../layout/workspace/ListFilterMenu";
import { QaRunActivity } from "./QaRunProgress";

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
const RESULTS = {
  passed: {
    label: "Passed",
    color: "text-adaptive-emerald-700-300",
    background: "bg-adaptive-emerald-500-a12-a16",
    bar: "bg-adaptive-emerald-600-400",
  },
  attention: {
    label: "Needs attention",
    color: "text-warning-foreground",
    background: "bg-warning",
    bar: "bg-warning-foreground",
  },
  running: {
    label: "Running",
    color: "text-update-foreground",
    background: "bg-update",
    bar: "bg-primary",
  },
  never: {
    label: "Never run",
    color: "text-foreground-muted",
    background: "bg-subtle",
    bar: "bg-foreground-muted/35",
  },
};

interface RunActions {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  canRun: boolean;
  canCancel: boolean;
  onRun: (id: string) => void;
  onCancel: (id: string) => void;
  onView: (id: string) => void;
}

export function QaDashboard({
  entries,
  counts,
  ...actions
}: RunActions & {
  entries: readonly QaDashboardEntry[];
  counts: ReturnType<typeof qaDashboard>["counts"];
}) {
  const [grouping, setGrouping] = useState<QaGrouping>("component");
  const [filter, setFilter] = useState<QaResultFilter>("all");
  const [search, setSearch] = useState("");
  const inputRef = useRef<TextInputInstance>(null);
  const groups = groupQaSuites(entries, grouping, search, filter);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  return (
    <View className="gap-5">
      <View className="gap-4 rounded-2xl border border-border-subtle bg-card p-4">
        <View className="flex-row items-center justify-between gap-2">
          <View>
            <Text className="font-t3-semibold text-lg">Suite health</Text>
            <Text className="text-xs text-foreground-muted">Latest result per suite</Text>
          </View>
          <Button label={`${counts.total} suites`} tone="text" onPress={() => setFilter("all")} />
        </View>
        <View className="flex-row flex-wrap gap-2">
          {QA_FILTER_OPTIONS.filter(
            (option) => option.value !== "all" && option.value !== "affected",
          ).map(({ value }) => {
            const result = RESULTS[value];
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${result.label}: ${counts[value]} suites`}
                accessibilityState={{ selected: filter === value }}
                onPress={() => setFilter(filter === value ? "all" : value)}
                className={`min-w-32 flex-1 basis-2/5 gap-2 rounded-xl border p-3 ${result.background} ${filter === value ? "border-primary" : "border-transparent"}`}
              >
                <Text className={`text-xs ${result.color}`}>{result.label}</Text>
                <Text className={`font-t3-semibold text-3xl ${result.color}`}>{counts[value]}</Text>
              </Pressable>
            );
          })}
        </View>
        <View
          className="h-2 flex-row overflow-hidden rounded-full bg-subtle"
          accessible
          accessibilityLabel={`${counts.passed} passed, ${counts.attention} need attention, ${counts.running} running, ${counts.never} never run`}
        >
          {QA_FILTER_OPTIONS.filter(
            (option) => option.value !== "all" && option.value !== "affected",
          ).map(({ value }) =>
            counts[value] ? (
              <View
                key={value}
                className={RESULTS[value].bar}
                style={{ width: `${(counts[value] / counts.total) * 100}%` }}
              />
            ) : null,
          )}
        </View>
      </View>
      <View className="flex-row">
        <SearchField
          inputRef={inputRef}
          autoFocus={false}
          accessibilityLabel="Search suites"
          clearAccessibilityLabel="Clear suite search"
          placeholder="Search suites, components, types…"
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
          key={`${grouping}:${group.label}`}
          label={group.label}
          entries={group.entries}
          showComponent={grouping !== "component"}
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

function SuiteGroup({
  label,
  entries,
  showComponent,
  ...actions
}: RunActions & {
  label: string;
  entries: readonly QaDashboardEntry[];
  showComponent: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="min-h-11 flex-row items-center gap-3"
      >
        <View className="flex-1">
          <Text className="font-t3-semibold text-lg">{label}</Text>
          <Text className="text-xs text-foreground-muted">
            {entries.length} {entries.length === 1 ? "suite" : "suites"} ·{" "}
            {entries.filter((entry) => entry.category === "passed").length}/{entries.length} passed
          </Text>
        </View>
        <Text className="text-foreground-muted">{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open
        ? entries.map((entry) => (
            <SuiteCard
              key={entry.suite.id}
              entry={entry}
              showComponent={showComponent}
              {...actions}
            />
          ))
        : null}
    </View>
  );
}

function SuiteCard({
  entry: { suite, run, component, kind, category, freshness },
  showComponent,
  environmentId,
  projectId,
  canRun,
  canCancel,
  onRun,
  onCancel,
  onView,
}: RunActions & {
  entry: QaDashboardEntry;
  showComponent: boolean;
}) {
  const [showCommand, setShowCommand] = useState(false);
  return (
    <View
      className={`gap-3 rounded-2xl border bg-card p-4 ${run?.status === "running" ? "border-primary" : "border-border-subtle"}`}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <View
          className={`flex-row items-center gap-1.5 rounded-md px-2 py-1 ${KINDS[kind].background}`}
        >
          <SymbolView name={KINDS[kind].icon} size={13} tintColorClassName={KINDS[kind].tint} />
          <Text className={`text-xs ${KINDS[kind].text}`}>{QA_KIND_LABELS[kind]}</Text>
        </View>
        {showComponent ? <Text className="text-xs text-foreground-muted">{component}</Text> : null}
      </View>
      <Text className="font-t3-semibold text-base">{suite.name}</Text>
      {run?.outputTail ? (
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
      ) : run?.status === "running" ? (
        <View className="flex-row items-center gap-2">
          <AppActivityIndicator colorClassName="accent-update-foreground" />
          <Text className="font-t3-semibold text-sm text-update-foreground">
            Running since {new Date(run.startedAt).toLocaleTimeString()}
          </Text>
        </View>
      ) : (
        <Text
          className={`text-sm ${run?.status === "failed" ? "text-danger-foreground" : RESULTS[category].color}`}
        >
          {qaStatusLabel(run)}
          {run ? ` · ${new Date(run.startedAt).toLocaleString()} · ${qaRunDuration(run)}` : ""}
        </Text>
      )}
      {run?.summary ? (
        <Text className="text-xs text-foreground-muted">{qaRunSummary(run)}</Text>
      ) : null}
      {run?.repositoryFile ? (
        <Text className="text-xs text-foreground-muted">{qaRunSource(run)}</Text>
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
          {run?.status !== "passed" && freshness.lastPassedAt ? (
            <Text className="text-xs text-foreground-muted">
              Last passed {new Date(freshness.lastPassedAt).toLocaleString()}
            </Text>
          ) : null}
        </View>
      ) : null}
      {run?.note ? <Text className="text-xs text-foreground-muted">{run.note}</Text> : null}
      <View className="flex-row flex-wrap items-center gap-2">
        {run?.status === "running" ? (
          <Button
            label="Cancel"
            icon="stop.fill"
            tone="danger"
            disabled={!canCancel}
            onPress={() => onCancel(run.id)}
          />
        ) : (
          <Button label="Run" icon="play" disabled={!canRun} onPress={() => onRun(suite.id)} />
        )}
        {run ? (
          <Button
            label={
              run.status === "running"
                ? "Full output"
                : run.summary && !run.repositoryFile
                  ? `Tests (${run.summary.tests})`
                  : "Details"
            }
            icon={run.status === "running" ? "terminal" : "list.number"}
            tone="text"
            onPress={() => onView(run.id)}
          />
        ) : (
          <Button
            label={showCommand ? "Hide command" : "Command"}
            icon="chevron.left.forwardslash.chevron.right"
            tone="text"
            onPress={() => setShowCommand(!showCommand)}
          />
        )}
      </View>
      {showCommand ? (
        <Text selectable className="font-mono text-xs text-foreground-muted">
          {suite.cwd ? `${suite.cwd} › ` : ""}
          {suite.command}
        </Text>
      ) : null}
    </View>
  );
}
