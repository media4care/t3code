import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  QA_CONFIGURATION_EXAMPLE,
  qaStatusLabel,
  qaRunDuration,
  qaRunSummary,
} from "@t3tools/client-runtime/qa";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

export function QaScreen() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<string | null>(null);
  const projectKey = (project: (typeof projects)[number]) =>
    `${project.environmentId}:${project.id}`;
  const project = projects.find((item) => projectKey(item) === selection) ?? projects[0];
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  return (
    <>
      {Platform.OS === "ios" ? null : <AppBar title="QA" subtitle="Test suites and run history" />}
      <ScreenContent>
        <View className="px-4 py-2">
          <Menu
            actions={projects.map((item) => ({
              id: projectKey(item),
              title: `${item.title} · ${environments.find((e) => e.environmentId === item.environmentId)?.label ?? "Environment"}`,
              state: projectKey(item) === (project ? projectKey(project) : null) ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => setSelection(nativeEvent.event)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="QA project"
              className="min-h-11 justify-center rounded-xl border border-border-subtle px-4 py-2"
            >
              <Text>{project?.title ?? "Select a project"} ▾</Text>
            </Pressable>
          </Menu>
        </View>
        {project ? (
          <ProjectQa
            key={projectKey(project)}
            environmentId={project.environmentId}
            projectId={project.id}
            connected={environment?.connection.phase === "connected"}
            environmentLabel={environment?.label ?? "Environment"}
          />
        ) : (
          <Text className="p-6 text-foreground-muted">Add a project to see its QA suites.</Text>
        )}
      </ScreenContent>
    </>
  );
}

function ProjectQa({
  environmentId,
  projectId,
  connected,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  connected: boolean;
  environmentLabel: string;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaLive({ environmentId, input: { projectId } }),
  );
  const start = useAtomCommand(serverEnvironment.startQa);
  const cancel = useAtomCommand(serverEnvironment.cancelQa);
  const permission = useAtomValue(serverEnvironment.startQa.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const snapshot = query.data;
  const running = snapshot?.latestRuns.some((run) => run.status === "running");
  const latest = new Map(snapshot?.latestRuns.map((run) => [run.suite.id, run]));
  const runSuite = async (suiteId: string) => {
    setBusy(true);
    const result = await start({ environmentId, input: { projectId, suiteId } });
    if (result._tag === "Success") setSelectedRun(result.value.id);
    setBusy(false);
  };
  const cancelRun = async (runId: string) => {
    setBusy(true);
    await cancel({ environmentId, input: { projectId, runId } });
    setBusy(false);
  };
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0) + 24,
        gap: 16,
      }}
    >
      <Text className="text-2xl font-t3-semibold">Test suites</Text>
      <Text className="text-sm text-foreground-muted">
        {environmentLabel}
        {connected ? "" : " · Offline"}
        {"\n"}
        {snapshot?.workspaceRoot}
      </Text>
      <Button label="Refresh catalog" onPress={query.refresh} disabled={!connected} />
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
      {snapshot?.suites.map((suite) => {
        const run = latest.get(suite.id);
        return (
          <View key={suite.id} className="gap-3 rounded-2xl border border-border-subtle p-4">
            <Text className="text-lg font-t3-semibold">{suite.name}</Text>
            <Text>{qaStatusLabel(run)}</Text>
            <Text selectable className="font-mono text-xs text-foreground-muted">
              {suite.cwd ? `${suite.cwd} › ` : ""}
              {suite.command}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {run
                ? `${new Date(run.startedAt).toLocaleString()} · ${qaRunDuration(run)}\n${qaRunSummary(run)}`
                : "Never run through QA"}
            </Text>
            {run?.note ? <Text className="text-sm text-foreground-muted">{run.note}</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              {run ? (
                <Button label="View run" tone="text" onPress={() => setSelectedRun(run.id)} />
              ) : null}
              {run?.status === "running" ? (
                <Button
                  label="Cancel"
                  disabled={!connected || !permission || busy}
                  onPress={() => {
                    void cancelRun(run.id);
                  }}
                />
              ) : (
                <Button
                  label="Run"
                  disabled={!connected || !permission || busy || running}
                  onPress={() => {
                    void runSuite(suite.id);
                  }}
                />
              )}
            </View>
          </View>
        );
      })}
      {selectedRun ? (
        <RunDetails
          environmentId={environmentId}
          projectId={projectId}
          runId={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      ) : null}
      {snapshot?.recentRuns.length ? (
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
                {run.suite.name} · {qaStatusLabel(run)}
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
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
  onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaDetails({ environmentId, input: { projectId, runId } }),
  );
  const [showReport, setShowReport] = useState(false);
  const data = query.data;
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle p-4">
      <Text className="text-lg font-t3-semibold">{data?.run.suite.name ?? "Run details"}</Text>
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {data ? (
        <>
          <Text>
            {qaStatusLabel(data.run)} · {qaRunSummary(data.run)}
          </Text>
          <Text selectable className="font-mono text-xs text-foreground-muted">
            {data.run.cwd}
            {"\n"}
            {data.run.suite.command}
            {"\n"}
            {data.run.branch ?? "No branch"} · {data.run.commit ?? "Unknown revision"}
            {data.run.dirty ? " + changes" : ""}
          </Text>
          {data.run.note ? <Text>{data.run.note}</Text> : null}
          {data.outputTruncated ? (
            <Text className="text-sm text-foreground-muted">
              Output truncated; showing the most recent output.
            </Text>
          ) : null}
          <View className="max-h-80">
            <ScrollView nestedScrollEnabled>
              <Text selectable className="font-mono text-xs">
                {data.output || "No output captured yet. Refresh to see progress."}
              </Text>
            </ScrollView>
          </View>
          {data.reportXml ? (
            <Button
              label={showReport ? "Hide JUnit report" : "View JUnit report"}
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
        <Button label="Refresh output" onPress={query.refresh} />
        <Button label="Close" tone="text" onPress={onClose} />
      </View>
    </View>
  );
}
