import { useAtomValue } from "@effect/atom-react";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  QA_CONFIGURATION_EXAMPLE,
  qaDashboard,
  qaProjects,
  qaStatusLabel,
  qaRunDuration,
  qaRunSummary,
  qaRunSource,
  QA_OFF_EVERYWHERE,
  QA_SHARED_RESULTS_NOTICE,
} from "@t3tools/client-runtime/qa";
import { AppBar } from "../../components/ui/AppBar";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { QaDashboard } from "./QaDashboard";
import { QaAutomation } from "./QaAutomation";
import { QaTestList } from "./QaTestList";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { ListFilterMenu, ListFilterRow } from "../workspace/ListFilterMenu";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export function QaScreen() {
  const allProjects = useProjects();
  const { environments } = useEnvironments();
  const projects = qaProjects(allProjects, environments);
  const [selection, setSelection] = useState<string | null>(null);
  const projectKey = (project: (typeof projects)[number]) =>
    `${project.environmentId}:${project.id}`;
  const project = projects.find((item) => projectKey(item) === selection) ?? projects[0];
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  const multipleEnvironments = new Set(projects.map((item) => item.environmentId)).size > 1;
  const projectPicker = project ? (
    <ListFilterMenu
      label={project.title}
      accessibilityLabel="QA project"
      actions={projects.map((item) => ({
        id: projectKey(item),
        title: item.title,
        ...(multipleEnvironments
          ? { subtitle: environments.find((e) => e.environmentId === item.environmentId)?.label }
          : {}),
        state: projectKey(item) === projectKey(project) ? ("on" as const) : ("off" as const),
      }))}
      onSelect={setSelection}
    />
  ) : null;
  return (
    <>
      {/* The workspace header belongs to the tab bar's toolbar on iOS. */}
      {Platform.OS === "ios" ? null : <AppBar title="QA" subtitle="Test suites and run history" />}
      <ScreenContent>
        {project ? (
          <ProjectQa
            key={projectKey(project)}
            environmentId={project.environmentId}
            projectId={project.id}
            projectPicker={projectPicker}
            connected={environment?.connection.phase === "connected"}
            environmentLabel={environment?.label ?? "Environment"}
          />
        ) : (
          <Text className="p-6 text-foreground-muted">
            {allProjects.length > 0 ? QA_OFF_EVERYWHERE : "Add a project to see its QA suites."}
          </Text>
        )}
      </ScreenContent>
    </>
  );
}

function ProjectQa({
  environmentId,
  projectId,
  projectPicker,
  connected,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  projectPicker: ReactNode;
  connected: boolean;
  environmentLabel: string;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaLive({ environmentId, input: { projectId } }),
  );
  const start = useAtomCommand(serverEnvironment.startQa);
  const startAffected = useAtomCommand(serverEnvironment.startAffectedQa);
  const cancelAffected = useAtomCommand(serverEnvironment.cancelAffectedQa);
  const cancel = useAtomCommand(serverEnvironment.cancelQa);
  const permission = useAtomValue(serverEnvironment.startQa.permissionAtom(environmentId));
  const affectedPermission = useAtomValue(
    serverEnvironment.startAffectedQa.permissionAtom(environmentId),
  );
  const stopPermission = useAtomValue(
    serverEnvironment.cancelAffectedQa.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewRun = (id: string) => {
    setSelectedRun(id);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const { themeAppearance } = useAppearancePreferences();
  const snapshot = query.data;
  const running = snapshot?.latestRuns.some((run) => run.status === "running");
  const { entries, counts } = qaDashboard(
    snapshot?.suites ?? [],
    snapshot?.latestRuns ?? [],
    snapshot?.freshness,
  );
  const affectedCount = snapshot?.freshness?.filter((item) => item.needsRun).length ?? 0;
  const [showHistory, setShowHistory] = useState(false);
  const runSuite = async (suiteId: string) => {
    setBusy(true);
    const result = await start({ environmentId, input: { projectId, suiteId } });
    if (result._tag === "Success") viewRun(result.value.id);
    setBusy(false);
  };
  const cancelRun = async (runId: string) => {
    setBusy(true);
    await cancel({ environmentId, input: { projectId, runId } });
    setBusy(false);
  };
  return (
    <ScrollView
      ref={scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0) + 24,
        gap: 16,
      }}
    >
      <ListFilterRow bleed={16}>
        {projectPicker}
        <Chip
          label="Refresh"
          icon="arrow.clockwise"
          glass
          colorScheme={themeAppearance}
          accessibilityLabel="Refresh QA"
          onPress={query.refresh}
          disabled={!connected}
        />
      </ListFilterRow>
      {connected ? null : (
        <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
          {environmentLabel} is offline. Reconnect to run QA.
        </Text>
      )}
      {snapshot?.sharedResults?.enabled ? (
        <Text className="text-sm text-foreground-muted">{QA_SHARED_RESULTS_NOTICE}</Text>
      ) : null}
      {snapshot?.sharedResults?.warning ? (
        <Text accessibilityRole="alert" className="text-danger">
          {snapshot.sharedResults.warning}
        </Text>
      ) : null}
      {snapshot?.batchError ? (
        <Text accessibilityRole="alert" className="text-danger">
          Queued run stopped: {snapshot.batchError}
        </Text>
      ) : null}
      {query.error || snapshot?.configurationError ? (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error ?? snapshot?.configurationError}
        </Text>
      ) : null}
      {!snapshot && query.isPending ? <Text>Loading QA…</Text> : null}
      {snapshot && !snapshot.configurationError && snapshot.suites.length === 0 ? (
        <View className="gap-3 rounded-2xl border border-border-subtle p-4">
          <Text className="text-lg font-t3-semibold">Add your first suite</Text>
          <Text className="text-foreground-muted">
            Add qa.suites to this project’s t3.json, then refresh. Use your existing unit,
            integration, Playwright, or Maestro commands.
          </Text>
          <Text selectable className="font-mono text-xs">
            {QA_CONFIGURATION_EXAMPLE}
          </Text>
          <Text className="text-sm text-foreground-muted">
            Set cwd for a subdirectory. For saved test counts, set report to junit and write JUnit
            XML to the T3_QA_REPORT_PATH environment variable.
          </Text>
        </View>
      ) : null}
      {selectedRun ? (
        <RunDetails
          key={selectedRun}
          environmentId={environmentId}
          projectId={projectId}
          runId={selectedRun}
          supportsTests={snapshot?.testResultsAvailable ?? false}
          onClose={() => setSelectedRun(null)}
        />
      ) : null}
      {snapshot &&
      snapshot.schedule !== undefined &&
      (counts.total > 0 || snapshot.schedule || snapshot.latestCiRuns?.length) ? (
        <QaAutomation
          environmentId={environmentId}
          projectId={projectId}
          snapshot={snapshot}
          connected={connected}
          onView={viewRun}
        />
      ) : null}
      {snapshot?.freshness && counts.total > 0 ? (
        <View className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
          <Text className="font-t3-semibold">
            {affectedCount} {affectedCount === 1 ? "suite needs" : "suites need"} a rerun
          </Text>
          <Text className="text-xs text-foreground-muted">
            Includes changed, expired, unknown, untested, and unsuccessful suites.
            {snapshot.checkedAt
              ? ` Checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}. Refresh after editing files.`
              : ""}
          </Text>
          {snapshot.batchRunning ? (
            <>
              <Text className="text-sm">
                {snapshot.queuedSuiteIds?.length ?? 0} queued · Runs continue when you leave QA.
              </Text>
              <Button
                label="Stop queued run"
                icon="stop.fill"
                disabled={!connected || !stopPermission || busy}
                onPress={() => {
                  setBusy(true);
                  void cancelAffected({ environmentId, input: { projectId } }).finally(() =>
                    setBusy(false),
                  );
                }}
              />
            </>
          ) : (
            <Button
              label={`Run affected suites (${affectedCount})`}
              icon="play"
              disabled={!connected || !affectedPermission || busy || running || !affectedCount}
              onPress={() => {
                setBusy(true);
                void startAffected({ environmentId, input: { projectId } }).finally(() =>
                  setBusy(false),
                );
              }}
            />
          )}
        </View>
      ) : null}
      {counts.total > 0 ? (
        <QaDashboard
          entries={entries}
          counts={counts}
          canRun={connected && permission && !busy && !running && !snapshot?.batchRunning}
          canCancel={connected && permission && !busy}
          onRun={(suiteId) => {
            void runSuite(suiteId);
          }}
          onCancel={(runId) => {
            void cancelRun(runId);
          }}
          onView={viewRun}
        />
      ) : null}
      {snapshot?.recentRuns.length ? (
        <Button
          label={showHistory ? "Hide recent runs" : "Recent runs · Latest 50"}
          icon="clock"
          tone="text"
          onPress={() => setShowHistory(!showHistory)}
        />
      ) : null}
      {showHistory && snapshot?.recentRuns.length ? (
        <>
          <Text className="text-lg font-t3-semibold">Recent runs · Latest 50</Text>
          {snapshot.recentRuns.map((run) => (
            <Pressable
              key={run.id}
              accessibilityRole="button"
              accessibilityLabel={`View ${run.suite.name} run`}
              onPress={() => viewRun(run.id)}
              className="gap-2 rounded-xl border border-border-subtle p-4"
            >
              <Text className="font-t3-semibold">
                {run.suite.name} · {qaStatusLabel(run)} · {qaRunSource(run)}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {new Date(run.startedAt).toLocaleString()} · {qaRunDuration(run)}
              </Text>
              <Text className="font-mono text-xs text-foreground-muted">
                {run.commit?.slice(0, 8) ?? "Unknown revision"}
                {run.dirty ? " + changes" : ""}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function RunDetails({
  environmentId,
  projectId,
  runId,
  supportsTests,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
  supportsTests: boolean;
  onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaDetails({ environmentId, input: { projectId, runId } }),
  );
  const [showReport, setShowReport] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState<boolean | null>(null);
  const data = query.data;
  const running = data?.run.status === "running";
  const showOutput =
    outputExpanded ??
    (running ||
      data?.run.status === "failed" ||
      data?.run.status === "incomplete" ||
      data?.run.status === "interrupted");
  return (
    <View
      className={`gap-3 rounded-2xl border p-4 ${running ? "border-primary bg-update" : "border-border-subtle"}`}
    >
      <Text className="text-lg font-t3-semibold">{data?.run.suite.name ?? "Run details"}</Text>
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {data ? (
        <>
          {running ? (
            <View className="flex-row items-center gap-2">
              <AppActivityIndicator colorClassName="accent-update-foreground" />
              <Text className="font-t3-semibold text-update-foreground">
                Running since {new Date(data.run.startedAt).toLocaleTimeString()}
              </Text>
            </View>
          ) : (
            <Text>
              {qaStatusLabel(data.run)} · {qaRunSummary(data.run)} · {qaRunDuration(data.run)}
            </Text>
          )}
          <Text className="text-xs text-foreground-muted">
            {qaRunSource(data.run)} · {data.run.branch ?? "No branch"} ·{" "}
            {data.run.commit?.slice(0, 8) ?? "Unknown revision"}
            {data.run.dirty ? " + changes" : ""}
            {data.run.exitCode !== null ? ` · Exit ${data.run.exitCode}` : ""}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={showOutput ? "Hide output" : "Output"}
              icon="terminal"
              tone="text"
              onPress={() => setOutputExpanded(!showOutput)}
            />
            <Button
              label={showCommand ? "Hide command" : "Command"}
              icon="chevron.left.forwardslash.chevron.right"
              tone="text"
              onPress={() => setShowCommand(!showCommand)}
            />
          </View>
          {showCommand ? (
            <Text selectable className="font-mono text-xs text-foreground-muted">
              {data.run.repositoryFile
                ? data.run.repositoryFile
                : data.run.source?.type === "ci"
                  ? (data.run.source.url ?? "CI result")
                  : `${data.run.cwd}\n${data.run.suite.command}`}
            </Text>
          ) : null}
          {showOutput ? (
            <>
              {data.outputTruncated ? (
                <Text className="text-sm text-foreground-muted">
                  Output truncated; showing the most recent output.
                </Text>
              ) : null}
              <View className="max-h-80">
                <ScrollView nestedScrollEnabled>
                  <Text selectable className="font-mono text-xs">
                    {data.output ||
                      (running
                        ? "No output captured yet. Refresh to see progress."
                        : "No output captured.")}
                  </Text>
                </ScrollView>
              </View>
            </>
          ) : null}
          {data.run.note ? <Text>{data.run.note}</Text> : null}
          {running || !data.run.summary ? null : supportsTests ? (
            <QaTestList environmentId={environmentId} projectId={projectId} runId={runId} />
          ) : (
            <Text className="text-sm text-foreground-muted">
              Update this environment’s server to view individual test results.
            </Text>
          )}
          {data.reportXml ? (
            <Button
              label={showReport ? "Hide JUnit report" : "View JUnit report"}
              icon="doc.text"
              tone="text"
              onPress={() => setShowReport(!showReport)}
            />
          ) : null}
          {showReport && data.reportXml ? (
            <View className="max-h-80">
              <ScrollView nestedScrollEnabled>
                <Text selectable className="font-mono text-xs">
                  {data.reportXml}
                </Text>
              </ScrollView>
            </View>
          ) : null}
        </>
      ) : (
        <Text>Loading run…</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={running ? "Refresh progress" : "Refresh"}
          icon="arrow.clockwise"
          onPress={query.refresh}
        />
        <Button label="Close" icon="xmark" tone="text" onPress={onClose} />
      </View>
    </View>
  );
}
