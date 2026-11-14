import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  QA_CONFIGURATION_EXAMPLE,
  qaDashboard,
  qaProjects,
  qaRepositories,
  qaStatusLabel,
  qaRunDuration,
  qaRunSummary,
  qaRunSource,
  QA_OFF_EVERYWHERE,
  QA_SHARED_RESULTS_NOTICE,
} from "@t3tools/client-runtime/qa";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { Sheet } from "../../components/ui/Sheet";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { QaDashboard } from "./QaDashboard";
import { QaAutomation } from "./QaAutomation";
import { QaCheckoutLine, QaRefComparison, QaRefMenu } from "./QaRefs";
import { QaOutput, QaRunSteps, useQaLiveRun } from "./QaRunProgress";
import { QaTestList } from "./QaTestList";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { ListFilterMenu, ListFilterRow } from "../layout/workspace/ListFilterMenu";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export function QaScreen() {
  const allProjects = useProjects();
  const { environments } = useEnvironments();
  const repositories = qaRepositories(qaProjects(allProjects, environments));
  const [selection, setSelection] = useState<string | null>(null);
  const repository = repositories.find((item) => item.key === selection) ?? repositories[0];
  const project = repository?.project;
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  const multipleEnvironments =
    new Set(repositories.map((item) => item.project.environmentId)).size > 1;
  const projectPicker = repository ? (
    <ListFilterMenu
      label={repository.title}
      accessibilityLabel="QA repository"
      actions={repositories.map((item) => ({
        id: item.key,
        title: item.title,
        ...(multipleEnvironments
          ? {
              subtitle: environments.find((e) => e.environmentId === item.project.environmentId)
                ?.label,
            }
          : {}),
        state: item.key === repository.key ? ("on" as const) : ("off" as const),
      }))}
      onSelect={setSelection}
    />
  ) : null;
  return (
    <>
      {/* The workspace header belongs to the tab bar's toolbar on iOS. */}
      {Platform.OS === "ios" ? null : <AppBar title="QA" subtitle="Test suites and run history" />}
      <ScreenContent>
        {repository && project ? (
          <ProjectQa
            key={repository.key}
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
  // Null shows the default branch, which only the server knows.
  const [ref, setRef] = useState<string | null>(null);
  const scope = { projectId, ...(ref ? { ref } : {}) };
  const query = useEnvironmentQuery(serverEnvironment.qaLive({ environmentId, input: scope }));
  const deleteCheckout = useAtomCommand(serverEnvironment.deleteQaCheckout);
  const canDeleteCheckout = useAtomValue(
    serverEnvironment.deleteQaCheckout.permissionAtom(environmentId),
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
    await start({ environmentId, input: { ...scope, suiteId } });
    setBusy(false);
  };
  const cancelRun = async (runId: string) => {
    setBusy(true);
    await cancel({ environmentId, input: { projectId, runId } });
    setBusy(false);
  };
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0) + 24,
        gap: 16,
      }}
    >
      <ListFilterRow bleed={16}>
        {projectPicker}
        {snapshot?.ref ? (
          <QaRefMenu
            value={snapshot.ref}
            refs={snapshot.refs ?? []}
            onChange={(next) => {
              setSelectedRun(null);
              setRef(next);
            }}
          />
        ) : null}
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
      {snapshot?.ref && snapshot.checkout ? (
        <QaCheckoutLine
          gitRef={snapshot.ref}
          checkout={snapshot.checkout}
          canDelete={connected && canDeleteCheckout && !running && !snapshot.batchRunning}
          onDelete={() => {
            void deleteCheckout({ environmentId, input: scope });
          }}
        />
      ) : null}
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
      {snapshot &&
      !snapshot.configurationError &&
      snapshot.checkout?.commit !== null &&
      snapshot.suites.length === 0 ? (
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
          gitRef={ref}
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
          gitRef={snapshot.ref ?? null}
          snapshot={snapshot}
          connected={connected}
          onView={setSelectedRun}
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
                  void cancelAffected({ environmentId, input: scope }).finally(() =>
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
                void startAffected({ environmentId, input: scope }).finally(() => setBusy(false));
              }}
            />
          )}
        </View>
      ) : null}
      {snapshot?.ref && snapshot.refs ? (
        <QaRefComparison
          refs={snapshot.refs}
          selected={snapshot.ref}
          onSelect={(next) => {
            setSelectedRun(null);
            setRef(next);
          }}
        />
      ) : null}
      {counts.total > 0 ? (
        <QaDashboard
          environmentId={environmentId}
          projectId={projectId}
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
          onView={setSelectedRun}
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
              onPress={() => setSelectedRun(run.id)}
              className="gap-2 rounded-xl border border-border-subtle p-4"
            >
              <Text className="font-t3-semibold">
                {run.suite.name} · {qaStatusLabel(run)} · {qaRunSource(run)}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {new Date(run.startedAt).toLocaleString()} · {qaRunDuration(run)}
              </Text>
              <Text className="font-mono text-xs text-foreground-muted">
                {run.ref ? `${run.ref} · ` : ""}
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
  gitRef,
  runId,
  supportsTests,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  gitRef: string | null;
  runId: string;
  supportsTests: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const query = useEnvironmentQuery(
    serverEnvironment.qaDetails({
      environmentId,
      input: { projectId, runId, ...(gitRef ? { ref: gitRef } : {}) },
    }),
  );
  const [showReport, setShowReport] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState<boolean | null>(null);
  const data = query.data;
  // A run in progress is followed live; its saved details arrive once it ends.
  const live = useQaLiveRun(environmentId, projectId, data?.run);
  const run = live?.run ?? data?.run;
  const output = live ?? data;
  const running = run?.status === "running";
  const showOutput =
    outputExpanded ??
    (running ||
      run?.status === "failed" ||
      run?.status === "incomplete" ||
      run?.status === "interrupted");
  return (
    <Sheet title={run?.suite.name ?? "Run details"} onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(20, insets.bottom),
          gap: 12,
        }}
      >
        {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
        {run && output ? (
          <>
            <Text>
              {qaStatusLabel(run)} · {qaRunSummary(run)} · {qaRunDuration(run)}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {qaRunSource(run)} · {run.ref ?? run.branch ?? "No branch"} ·{" "}
              {run.commit?.slice(0, 8) ?? "Unknown revision"}
              {run.dirty ? " + changes" : ""}
              {run.exitCode !== null ? ` · Exit ${run.exitCode}` : ""}
            </Text>
            <QaRunSteps run={run} />
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
              {/* A server from before runs were streamed sends output only when asked. */}
              {running && !live ? (
                <Button
                  label="Refresh progress"
                  icon="arrow.clockwise"
                  tone="text"
                  onPress={query.refresh}
                />
              ) : null}
            </View>
            {showCommand ? (
              <Text selectable className="font-mono text-xs text-foreground-muted">
                {run.repositoryFile
                  ? run.repositoryFile
                  : run.source?.type === "ci"
                    ? (run.source.url ?? "CI result")
                    : `${run.cwd}\n${run.suite.command}`}
              </Text>
            ) : null}
            {showOutput ? (
              <>
                {output.outputTruncated ? (
                  <Text className="text-sm text-foreground-muted">
                    Output truncated; showing the most recent output.
                  </Text>
                ) : null}
                <QaOutput
                  text={output.output}
                  placeholder={running ? "Waiting for output…" : "No output captured."}
                />
              </>
            ) : null}
            {run.note ? <Text>{run.note}</Text> : null}
            {running || !run.summary ? null : supportsTests ? (
              <QaTestList
                environmentId={environmentId}
                projectId={projectId}
                gitRef={gitRef}
                runId={runId}
              />
            ) : (
              <Text className="text-sm text-foreground-muted">
                Update this environment’s server to view individual test results.
              </Text>
            )}
            {data?.reportXml ? (
              <Button
                label={showReport ? "Hide JUnit report" : "View JUnit report"}
                icon="doc.text"
                tone="text"
                onPress={() => setShowReport(!showReport)}
              />
            ) : null}
            {showReport && data?.reportXml ? (
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
      </ScrollView>
    </Sheet>
  );
}
