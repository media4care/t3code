import { InsightImplementationBadge } from "./InsightImplementationBadge";
import { InsightsDashboard } from "./InsightsDashboard";
import { InsightsEvidence } from "./InsightsEvidence";
import { useNowMinuteMs } from "../../lib/clock";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  EnvironmentId,
  ProjectId,
  type InsightRecommendation,
  type InsightStatus,
  type InsightsSnapshot,
  type InsightsSettings,
} from "@t3tools/contracts";
import {
  INSIGHT_IMPLEMENTATION_FILTERS,
  matchesInsightFilter,
  insightImplementationUrl,
  defaultInsightsSettings,
  insightsModelChoices,
  INSIGHT_STATUS_LABELS,
} from "@t3tools/client-runtime/insights";
import { useState } from "react";
import {
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

function Picker({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Menu
      actions={choices.map((choice) => ({
        id: choice.value,
        title: choice.label,
        state: choice.value === value ? "on" : "off",
      }))}
      onPressAction={({ nativeEvent }) => onChange(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        className="min-h-11 justify-center rounded-xl border border-border-subtle px-4 py-2"
      >
        <Text className="text-sm text-foreground">
          {choices.find((choice) => choice.value === value)?.label ?? label} ▾
        </Text>
      </Pressable>
    </Menu>
  );
}

export function InsightsScreen({ workspace: inWorkspace }: { readonly workspace?: boolean }) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment = environments.find((e) => e.environmentId === selected) ?? environments[0];
  const navigation = useNavigation();
  return (
    <>
      {inWorkspace && Platform.OS === "ios" ? null : (
        <AppBar
          title="Insights"
          subtitle="Improve your agent workflows"
          sidebar={!inWorkspace}
          onBack={inWorkspace ? undefined : () => navigation.goBack()}
        />
      )}
      <ScreenContent>
        <View className="px-4 py-2">
          <Picker
            label="Insights environment"
            value={environment?.environmentId ?? ""}
            choices={environments.map((e) => ({
              value: e.environmentId,
              label: `${e.label}${e.connection.phase === "connected" ? "" : " · Offline"}`,
            }))}
            onChange={(id) => setSelected(EnvironmentId.make(id))}
          />
        </View>
        {environment ? (
          <EnvironmentInsights
            key={environment.environmentId}
            environmentId={environment.environmentId}
            connected={environment.connection.phase === "connected"}
          />
        ) : (
          <EmptyState
            title="Connect an environment"
            detail="Insights uses the threads and providers on your T3 server."
            variant="plain"
          />
        )}
      </ScreenContent>
    </>
  );
}

function EnvironmentInsights({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const query = useEnvironmentQuery(serverEnvironment.insightsLive({ environmentId, input: {} }));
  const canOperate = useAtomValue(
    serverEnvironment.configureInsights.permissionAtom(environmentId),
  );
  const now = useNowMinuteMs();
  const selectDetail = useSelectWorkspaceDetail();
  const [tab, setTab] = useState("review");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusedRecommendationId, setFocusedRecommendationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const run = useAtomCommand(serverEnvironment.runInsights);
  const configure = useAtomCommand(serverEnvironment.configureInsights);
  const snapshot = query.data;
  const active =
    snapshot?.reports.some((report) => report.status === "analyzing") ||
    Boolean(
      snapshot?.latestAnalysis &&
      ["preparing", "queued", "starting", "running", "waiting"].includes(
        snapshot.latestAnalysis.status,
      ),
    );
  const recommendations =
    tab === "review"
      ? []
      : (snapshot?.recommendations ?? [])
          .filter(
            (rec) =>
              matchesInsightFilter(rec, filter, now) &&
              `${rec.title} ${rec.targetFile ?? ""}`.toLowerCase().includes(search.toLowerCase()),
          )
          .sort(
            (a, b) =>
              Number(b.id === focusedRecommendationId) - Number(a.id === focusedRecommendationId),
          );
  const runNow = async () => {
    setBusy(true);
    const result = await run({ environmentId, input: {} });
    if (result._tag === "Success") {
      setSelectedReportId(null);
      setFocusedRecommendationId(null);
      setTab("review");
    }
    query.refresh();
    setBusy(false);
  };
  return (
    <FlatList
      data={recommendations}
      keyExtractor={(rec) => rec.id}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: 16,
        paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0) + 24,
        gap: 12,
      }}
      refreshControl={
        <RefreshControl refreshing={query.isPending && !!snapshot} onRefresh={query.refresh} />
      }
      ListHeaderComponent={
        <View className="gap-4">
          <Text className="font-t3-semibold text-2xl text-foreground">Workflow overview</Text>
          {!connected && (
            <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
              This environment is offline. Reconnect to load insights.
            </Text>
          )}
          {query.error && (
            <Text accessibilityRole="alert" className="text-sm text-danger">
              {query.error}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={busy || active ? "Refreshing insights…" : "Refresh insights"}
              tone="primary"
              icon="arrow.clockwise"
              accessibilityHint="Run a fresh Astra max review and show the latest insights."
              disabled={!snapshot?.settings || !canOperate || !connected || busy || active}
              onPress={() => {
                void runNow();
              }}
            />
            <Button
              label="Settings"
              icon="gearshape"
              onPress={() => setSettingsOpen(!settingsOpen)}
            />
          </View>
          {snapshot?.settings && (
            <View className="gap-2">
              <Text className="text-xs text-foreground-muted">
                Astra · Max ·{" "}
                {snapshot.schedule?.enabled
                  ? `Daily at ${snapshot.settings.timeOfDay} (server local time)`
                  : "Paused"}
              </Text>
              <Button
                label={snapshot.schedule?.enabled ? "Pause daily review" : "Resume daily review"}
                tone="text"
                disabled={!canOperate || !connected}
                onPress={() => {
                  const settings = snapshot.settings;
                  if (settings)
                    void configure({
                      environmentId,
                      input: { ...settings, enabled: !snapshot.schedule?.enabled },
                    });
                }}
              />
              {snapshot.schedule?.lastRunError && (
                <Text accessibilityRole="alert" className="text-sm text-danger">
                  {snapshot.schedule.lastRunError}
                </Text>
              )}
            </View>
          )}
          {(settingsOpen || (snapshot && !snapshot.settings)) && (
            <SettingsForm
              key={
                snapshot?.settings
                  ? `${snapshot.settings.projectId}:${snapshot.settings.timeOfDay}:${snapshot.settings.enabled}`
                  : "new"
              }
              environmentId={environmentId}
              initial={snapshot?.settings ?? null}
              disabled={!canOperate || !connected}
              onSaved={() => {
                setSettingsOpen(false);
                query.refresh();
              }}
            />
          )}
          {snapshot?.latestAnalysis && (active || snapshot.latestAnalysis.status === "failed") && (
            <Button
              label={`Latest analyst thread · ${snapshot.latestAnalysis.status}`}
              tone="text"
              onPress={() => {
                const latest = snapshot.latestAnalysis;
                if (latest)
                  selectDetail({
                    name: "Thread",
                    params: { environmentId, threadId: latest.threadId },
                  });
              }}
            />
          )}
          <Picker
            label="Insights view"
            value={tab}
            choices={[
              { value: "review", label: "Dashboard" },
              { value: "recommendations", label: "Recommendations" },
              { value: "history", label: "Implementation" },
            ]}
            onChange={(value) => {
              setFocusedRecommendationId(null);
              setTab(value);
              setFilter(value === "history" ? "all" : "active");
            }}
          />
          {tab === "review" ? (
            snapshot?.reports.length ? (
              <DailyReview
                environmentId={environmentId}
                snapshot={snapshot}
                selectedReportId={selectedReportId}
                onSelectReport={setSelectedReportId}
                onOpenRecommendation={(id) => {
                  setFilter("all");
                  setSearch("");
                  setExpanded(id);
                  setFocusedRecommendationId(id);
                  setTab("recommendations");
                }}
                onOpenHistory={(filter = "all") => {
                  setFocusedRecommendationId(null);
                  setSearch("");
                  setFilter(filter);
                  setTab("history");
                }}
              />
            ) : (
              <EmptyState
                variant="plain"
                title="Your first review starts here"
                detail="Enable daily insights and choose Refresh insights. Reports will cite the threads behind each recommendation."
              />
            )
          ) : (
            <>
              <TextInput
                accessibilityLabel="Search recommendations"
                placeholder="Search recommendations…"
                value={search}
                onChangeText={setSearch}
                className="min-h-12 rounded-xl border border-border-subtle px-4 text-foreground"
              />
              <Picker
                label="Recommendation status"
                value={filter}
                choices={[
                  { value: "active", label: "Actionable" },
                  { value: "all", label: "All statuses" },
                  ...INSIGHT_IMPLEMENTATION_FILTERS,
                  ...Object.entries(INSIGHT_STATUS_LABELS)
                    .filter(([value]) => value !== "implemented")
                    .map(([value, label]) => ({
                      value,
                      label,
                    })),
                ]}
                onChange={setFilter}
              />
              {snapshot?.truncated && (
                <Text className="text-xs text-foreground-muted">
                  Showing the 250 most recently updated recommendations.
                </Text>
              )}
            </>
          )}
        </View>
      }
      ListEmptyComponent={
        tab !== "review" ? (
          <EmptyState
            variant="plain"
            title={tab === "history" ? "Track the changes you make" : "No recommendations here"}
            detail={
              tab === "history"
                ? "Mark a recommendation implemented and add its change reference. Later reviews will assess its effect."
                : "Recommendations appear when evidence supports a useful change. Use the filter to revisit dismissed or deferred items."
            }
          />
        ) : undefined
      }
      renderItem={({ item }) => (
        <View className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: expanded === item.id }}
            onPress={() => setExpanded(expanded === item.id ? null : item.id)}
            className="gap-2 p-4"
          >
            <Text className="text-xs text-foreground-muted">
              {item.priority.toUpperCase()} · {item.category} · {INSIGHT_STATUS_LABELS[item.status]}
            </Text>
            <InsightImplementationBadge recommendation={item} />
            <Text className="font-t3-semibold text-base text-foreground">{item.title}</Text>
            {item.implementationRef && (
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                Change: {item.implementationRef}
              </Text>
            )}
            <Text className="text-xs text-foreground-muted">
              {item.confidence} confidence · {item.occurrences} reports
            </Text>
          </Pressable>
          {expanded === item.id && (
            <RecommendationDetail
              key={`${item.id}:${item.updatedAt}`}
              environmentId={environmentId}
              summary={item}
              disabled={!canOperate || !connected}
            />
          )}
        </View>
      )}
    />
  );
}

function SettingsForm({
  environmentId,
  initial,
  disabled,
  onSaved,
}: {
  environmentId: EnvironmentId;
  initial: InsightsSettings | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const providers =
    useAtomValue(environmentPresentations.providersByEnvironmentAtom).get(environmentId) ?? [];
  const choices = insightsModelChoices(providers);
  const defaults =
    initial ?? (projects[0] ? defaultInsightsSettings(projects[0].id, providers) : null);
  const [draft, setDraft] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const configure = useAtomCommand(serverEnvironment.configureInsights);
  const value = draft ?? defaults;
  if (!value)
    return (
      <EmptyState
        variant="plain"
        title="Astra and a project are needed"
        detail="Enable a Codex provider with Astra and add a project to this environment."
      />
    );
  const update = (patch: Partial<InsightsSettings>) => setDraft({ ...value, ...patch });
  const save = async () => {
    setBusy(true);
    const result = await configure({ environmentId, input: value });
    if (result._tag === "Success") onSaved();
    setBusy(false);
  };
  return (
    <View className="gap-4 rounded-2xl border border-border-subtle p-4">
      <Text className="font-t3-semibold text-foreground">Daily workflow review</Text>
      <Text className="text-sm text-foreground-muted">
        The selected provider analyzes excerpts from these projects. Recommendations are implemented
        only when you start work on them.
      </Text>
      <Picker
        label="Analysis project"
        value={value.projectId}
        choices={projects.map((p) => ({ value: p.id, label: p.title }))}
        onChange={(id) => update({ projectId: ProjectId.make(id) })}
      />
      <Picker
        label="Analysis provider"
        value={`${value.modelSelection.instanceId}/${value.modelSelection.model}`}
        choices={choices.map((choice) => ({ value: choice.key, label: choice.label }))}
        onChange={(key) => {
          const choice = choices.find((c) => c.key === key);
          if (choice) update({ modelSelection: choice.selection });
        }}
      />
      <Text className="text-sm text-foreground">Daily time · server local time</Text>
      <TextInput
        accessibilityLabel="Daily analysis time"
        value={value.timeOfDay}
        onChangeText={(timeOfDay) => update({ timeOfDay })}
        placeholder="09:00"
        className="min-h-12 rounded-xl border border-border-subtle px-4 text-foreground"
      />
      <Text className="text-sm text-foreground">Lookback days (1–90)</Text>
      <TextInput
        accessibilityLabel="Lookback days"
        keyboardType="number-pad"
        value={String(value.lookbackDays)}
        onChangeText={(text) => update({ lookbackDays: Number(text) })}
        className="min-h-12 rounded-xl border border-border-subtle px-4 text-foreground"
      />
      <Text className="text-sm text-foreground">Maximum runs per analysis (10–200)</Text>
      <TextInput
        accessibilityLabel="Maximum runs"
        keyboardType="number-pad"
        value={String(value.maxRuns)}
        onChangeText={(text) => update({ maxRuns: Number(text) })}
        className="min-h-12 rounded-xl border border-border-subtle px-4 text-foreground"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-foreground">All projects</Text>
        <Switch
          accessibilityLabel="Analyze all projects"
          value={value.projectIds.length === 0}
          onValueChange={(all) => update({ projectIds: all ? [] : [value.projectId] })}
        />
      </View>
      {value.projectIds.length > 0 &&
        projects.map((project) => (
          <View key={project.id} className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 text-sm text-foreground">{project.title}</Text>
            <Switch
              accessibilityLabel={`Analyze ${project.title}`}
              value={value.projectIds.includes(project.id)}
              onValueChange={(checked) => {
                const next = checked
                  ? [...value.projectIds, project.id]
                  : value.projectIds.filter((id) => id !== project.id);
                if (next.length) update({ projectIds: next });
              }}
            />
          </View>
        ))}
      <Text className="text-xs text-foreground-muted">
        The server must be running at the scheduled time. Activity carries forward within the
        lookback window. Larger batches use more context.
      </Text>
      <Button
        label={initial ? "Save settings" : "Enable daily insights"}
        tone="primary"
        loading={busy}
        disabled={disabled}
        onPress={() => {
          void save();
        }}
      />
    </View>
  );
}

function DailyReview({
  environmentId,
  snapshot,
  selectedReportId,
  onSelectReport,
  onOpenRecommendation,
  onOpenHistory,
}: {
  environmentId: EnvironmentId;
  snapshot: InsightsSnapshot;
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  onOpenRecommendation: (id: string) => void;
  onOpenHistory: (filter?: string) => void;
}) {
  const summary =
    snapshot.reports.find((report) => report.id === selectedReportId) ?? snapshot.reports[0];
  const detail = useEnvironmentQuery(
    summary ? serverEnvironment.insightReport({ environmentId, input: { id: summary.id } }) : null,
  );
  const loaded = detail.data;
  const report =
    loaded && summary && loaded.id === summary.id && loaded.status === summary.status
      ? loaded
      : summary;
  if (!report) return null;
  return (
    <View className="gap-4">
      <Picker
        label="Review date"
        value={report.id}
        choices={snapshot.reports.map((r) => ({
          value: r.id,
          label: `${new Date(r.createdAt).toLocaleDateString()} · ${r.status}`,
        }))}
        onChange={onSelectReport}
      />
      {detail.error && (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {detail.error}
        </Text>
      )}
      {report.hasMore && (
        <Text className="text-xs text-warning-foreground">More activity to review</Text>
      )}
      <InsightsDashboard
        environmentId={environmentId}
        report={report}
        snapshot={snapshot}
        onOpenRecommendation={onOpenRecommendation}
        onOpenHistory={onOpenHistory}
        onSelectReport={onSelectReport}
      />
    </View>
  );
}

function RecommendationDetail({
  environmentId,
  summary,
  disabled,
}: {
  environmentId: EnvironmentId;
  summary: InsightRecommendation;
  disabled: boolean;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.insightRecommendation({ environmentId, input: { id: summary.id } }),
  );
  const loaded = query.data;
  const rec = loaded && loaded.updatedAt === summary.updatedAt ? loaded : summary;
  const [note, setNote] = useState(rec.note);
  const [reference, setReference] = useState(rec.implementationRef ?? "");
  const implementationUrl = insightImplementationUrl(rec.implementationRef);
  const [busy, setBusy] = useState(false);
  const update = useAtomCommand(serverEnvironment.updateInsight);
  const implement = useAtomCommand(serverEnvironment.implementInsight);
  const selectDetail = useSelectWorkspaceDetail();
  const act = async (status: InsightStatus) => {
    setBusy(true);
    await update({
      environmentId,
      input: {
        id: rec.id,
        status,
        note,
        implementationRef: reference || null,
        deferredUntil:
          status === "deferred"
            ? rec.status === "deferred"
              ? rec.deferredUntil
              : new Date(Date.now() + 7 * 86400000).toISOString()
            : null,
      },
    });
    query.refresh();
    setBusy(false);
  };
  const start = async () => {
    setBusy(true);
    const result = await implement({ environmentId, input: { id: rec.id } });
    if (result._tag === "Success")
      selectDetail({ name: "Thread", params: { environmentId, threadId: result.value.threadId } });
    setBusy(false);
  };
  return (
    <View className="gap-4 border-t border-border-subtle p-4">
      <View className="gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <Text className="font-t3-semibold text-sm text-foreground">Implementation</Text>
        <InsightImplementationBadge recommendation={rec} />
        <Text className="text-xs text-foreground-muted">
          {rec.status === "implemented"
            ? "Completion recorded. Later reviews assess whether the change helped."
            : "Completion has not been recorded. Confirm it after checking the change."}
        </Text>
        <Text selectable className="text-xs text-foreground-muted">
          {rec.implementationRef || "No change reference recorded."}
        </Text>
        {implementationUrl && (
          <Button
            label="Open change reference"
            tone="text"
            onPress={() => {
              void Linking.openURL(implementationUrl);
            }}
          />
        )}
        {rec.implementationThreadId ? (
          <Button
            label="Open implementation thread"
            tone="text"
            onPress={() => {
              if (rec.implementationThreadId)
                selectDetail({
                  name: "Thread",
                  params: { environmentId, threadId: rec.implementationThreadId },
                });
            }}
          />
        ) : (
          rec.status !== "implemented" && (
            <Button
              label="Start implementation"
              disabled={disabled || busy}
              onPress={() => {
                void start();
              }}
            />
          )
        )}
        <Button
          label={rec.status === "implemented" ? "Reopen" : "Mark implemented"}
          tone={rec.status === "implemented" ? "secondary" : "primary"}
          disabled={disabled || busy}
          onPress={() => {
            void act(rec.status === "implemented" ? "open" : "implemented");
          }}
        />
      </View>
      {rec.targetFile && (
        <Text selectable className="text-xs text-primary-text">
          {rec.targetFile}
        </Text>
      )}
      {[
        { title: "Observation", text: rec.observation },
        { title: "Recommendation", text: rec.recommendation },
        { title: "Suggested change", text: rec.suggestedChange },
        { title: "Expected impact", text: rec.expectedImpact },
        { title: "How to validate", text: rec.validation },
      ].map((section) => (
        <View key={section.title} className="gap-1">
          <Text className="font-t3-semibold text-sm text-foreground">{section.title}</Text>
          <Text selectable className="text-sm text-foreground-muted">
            {section.text}
          </Text>
        </View>
      ))}
      <InsightsEvidence environmentId={environmentId} evidence={rec.evidence} />
      {rec.assessments.map((assessment) => (
        <View key={assessment.reportId} className="gap-2">
          <Text className="font-t3-semibold text-sm text-foreground">
            {assessment.outcome.replaceAll("_", " ")}
          </Text>
          <Text className="text-sm text-foreground-muted">{assessment.explanation}</Text>
          <InsightsEvidence environmentId={environmentId} evidence={assessment.evidence} />
        </View>
      ))}
      <TextInput
        accessibilityLabel="Decision note"
        value={note}
        onChangeText={setNote}
        placeholder="Decision note"
        multiline
        className="min-h-16 rounded-xl border border-border-subtle p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel="Implementation reference"
        value={reference}
        onChangeText={setReference}
        placeholder="Commit, PR, or change reference"
        className="min-h-12 rounded-xl border border-border-subtle p-3 text-foreground"
      />
      <Button
        label="Save note"
        disabled={disabled || busy}
        onPress={() => {
          void act(rec.status);
        }}
      />
      <View className="flex-row flex-wrap gap-2">
        {(["accepted", "deferred", "dismissed", "open"] as const)
          .filter(
            (status) =>
              status !== rec.status && !(status === "open" && rec.status === "implemented"),
          )
          .map((status) => (
            <Button
              key={status}
              label={
                status === "open"
                  ? "Reopen"
                  : status === "deferred"
                    ? "Defer 7 days"
                    : status === "dismissed"
                      ? "Dismiss"
                      : "Accept"
              }
              disabled={disabled || busy}
              onPress={() => {
                void act(status);
              }}
            />
          ))}
      </View>
      {rec.history.map((event) => (
        <Text
          key={`${event.at}:${event.status}:${event.note}`}
          className="text-xs text-foreground-muted"
        >
          {new Date(event.at).toLocaleDateString()} · {INSIGHT_STATUS_LABELS[event.status]} ·{" "}
          {event.note}
        </Text>
      ))}
    </View>
  );
}
