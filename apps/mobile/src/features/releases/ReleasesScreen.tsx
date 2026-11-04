import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EnvironmentId, ProjectId, ReleaseStatusDocument } from "@t3tools/contracts";
import {
  currentReleases,
  defaultReleaseVersion,
  releaseAge,
  releaseSourcesLabel,
  releaseAttention,
  releaseGates,
  releaseTargetGroups,
  RELEASES_CONFIGURATION_EXAMPLE,
  type ReleaseTargetRow,
  type ReleaseTone,
} from "@t3tools/client-runtime/releases";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

// An open screen asks this often; the server skips the command until the document is stale.
const STALE_CHECK_MS = 60_000;

const TONE_TEXT: Record<ReleaseTone, string> = {
  ok: "text-green-500",
  info: "text-foreground-secondary",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
  muted: "text-foreground-muted",
};

export function ReleasesScreen() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<string | null>(null);
  const projectKey = (project: (typeof projects)[number]) =>
    `${project.environmentId}:${project.id}`;
  const connected = (environmentId: string) =>
    environments.find((item) => item.environmentId === environmentId)?.connection.phase ===
    "connected";
  const project =
    projects.find((item) => projectKey(item) === selection) ??
    projects.find((item) => connected(item.environmentId)) ??
    projects[0];
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  const projectItems = projects.map((item) => ({
    id: projectKey(item),
    title: item.title,
    subtitle: environments.find((e) => e.environmentId === item.environmentId)?.label,
    selected: projectKey(item) === (project ? projectKey(project) : null),
    onPress: () => setSelection(projectKey(item)),
  }));
  return (
    <>
      {Platform.OS === "ios" ? (
        <NativeStackScreenOptions
          optionsVersion={JSON.stringify(projectItems)}
          options={{
            unstable_headerRightItems: () =>
              projectItems.length > 1
                ? [
                    withNativeGlassHeaderItem({
                      accessibilityLabel: "Releases project",
                      icon: { name: "folder", type: "sfSymbol" },
                      label: "",
                      type: "menu",
                      menu: {
                        title: "Releases project",
                        items: projectItems.map((item) => ({
                          type: "action" as const,
                          label: item.title,
                          description: item.subtitle,
                          state: item.selected ? ("on" as const) : undefined,
                          onPress: item.onPress,
                        })),
                      },
                    }),
                  ]
                : [],
          }}
        />
      ) : (
        <AppBar
          title="Releases"
          subtitle={project?.title ?? "Pipelines, stores and OTA updates"}
          menus={
            projectItems.length > 1
              ? [{ title: "Releases project", icon: "folder", items: projectItems }]
              : []
          }
        />
      )}
      <ScreenContent>
        {project ? (
          <ProjectReleases
            key={projectKey(project)}
            environmentId={project.environmentId}
            projectId={project.id}
            projectTitle={project.title}
            connected={environment?.connection.phase === "connected"}
            environmentLabel={environment?.label ?? "Environment"}
          />
        ) : (
          <Text className="p-6 text-foreground-muted">Add a project to see its releases.</Text>
        )}
      </ScreenContent>
    </>
  );
}

function ProjectReleases(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  projectTitle: string;
  connected: boolean;
  environmentLabel: string;
}) {
  const { environmentId, projectId, connected } = props;
  const query = useEnvironmentQuery(
    serverEnvironment.releasesLive({ environmentId, input: { projectId } }),
  );
  const refresh = useAtomCommand(serverEnvironment.refreshReleases);
  const registry = useContext(RegistryContext);
  const canRefresh = useAtomValue(serverEnvironment.refreshReleases.permissionAtom(environmentId));
  const [version, setVersion] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const snapshot = query.data;
  const configured = snapshot?.configured === true;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the server's release status fresh while the screen is open; the server ignores calls for a fresh document.
  useEffect(() => {
    if (!connected || !configured || !canRefresh) return;
    const check = () => {
      setNow(Date.now());
      void runAtomCommand(
        registry,
        serverEnvironment.refreshReleases,
        { environmentId, input: { projectId } },
        { reportFailure: false },
      );
    };
    check();
    const timer = setInterval(check, STALE_CHECK_MS);
    return () => clearInterval(timer);
  }, [connected, configured, canRefresh, environmentId, projectId, registry]);

  const document = snapshot?.document ?? null;
  const selected =
    (version && document?.releases.some((release) => release.version === version)
      ? version
      : null) ?? (document ? defaultReleaseVersion(document) : null);
  const updated = releaseAge(document?.generatedAt, now);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: 16,
        paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0) + 24,
        gap: 16,
      }}
    >
      <View className="gap-1">
        <Text className="text-2xl font-t3-semibold">{document?.title ?? props.projectTitle}</Text>
        <Text className="text-sm text-foreground-muted">
          {props.environmentLabel}
          {connected ? "" : " · Offline"}
          {document && document.sources.length > 0 ? ` · ${releaseSourcesLabel(document)}` : ""}
          {updated ? ` · updated ${updated} ago` : ""}
        </Text>
      </View>
      {configured ? (
        <Button
          label={snapshot?.running ? "Refreshing…" : "Refresh releases"}
          icon="arrow.clockwise"
          disabled={!connected || !canRefresh || snapshot?.running}
          onPress={() => {
            void refresh({ environmentId, input: { projectId, force: true } });
          }}
        />
      ) : null}
      {query.error || snapshot?.configurationError ? (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error ?? snapshot?.configurationError}
        </Text>
      ) : null}
      {snapshot?.lastRun?.error ? (
        <View className="gap-2 rounded-2xl border border-danger-border p-4">
          <Text className="font-t3-semibold text-danger-foreground">
            The release command failed{document ? "; showing the last status it produced." : "."}
          </Text>
          <Text selectable className="font-mono text-xs text-foreground-muted">
            {snapshot.lastRun.error}
          </Text>
        </View>
      ) : null}
      {!snapshot && query.isPending ? <Text>Loading releases…</Text> : null}
      {snapshot && !snapshot.configured && !snapshot.configurationError ? (
        <View className="gap-3 rounded-2xl border border-border-subtle p-4">
          <Text className="text-lg font-t3-semibold">Connect your release status</Text>
          <Text className="text-foreground-muted">
            Add releases to this project’s t3.json. Its command prints the project’s release status
            as JSON: pipelines, store tracks, OTA channels and deployed services.
          </Text>
          <Text selectable className="font-mono text-xs">
            {RELEASES_CONFIGURATION_EXAMPLE}
          </Text>
        </View>
      ) : null}
      {configured && !document && snapshot?.running ? (
        <Text className="text-foreground-muted">
          Reading release status. The first run can take a minute.
        </Text>
      ) : null}
      {document && selected ? (
        <ReleaseDetails document={document} version={selected} now={now} onVersion={setVersion} />
      ) : null}
    </ScrollView>
  );
}

function open(url: string | undefined) {
  if (url) void Linking.openURL(url);
}

function Card(props: { children: ReactNode; onPress?: (() => void) | undefined }) {
  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      className="gap-1 rounded-xl border border-border-subtle bg-card p-3"
    >
      {props.children}
    </Pressable>
  );
}

function binaryLine(row: ReleaseTargetRow, version: string) {
  const binary = row.binary;
  if (!binary) return "No build";
  const percent =
    binary.audience === "public" ? ` ${binary.rollout?.percent ?? 100}%` : " · not public";
  return `${binary.label}${binary.version !== version ? ` ${binary.version}` : ""}${percent}`;
}

function otaLine(row: ReleaseTargetRow) {
  if (!row.ota) return "No OTA update";
  if (row.ota.state === "preview") return `OTA preview · ${row.ota.update.runtime}`;
  const other = row.ota.state === "other" ? ` (${row.ota.update.version})` : "";
  return `OTA ${row.ota.update.percent}%${other} · ${row.ota.update.runtime}`;
}

function ReleaseDetails(props: {
  document: ReleaseStatusDocument;
  version: string;
  now: number;
  onVersion: (version: string) => void;
}) {
  const { document, version, now } = props;
  const attention = releaseAttention(document);
  const gates = releaseGates(document, version);
  const targetGroups = releaseTargetGroups(document, version);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {document.releases.map((release) => (
            <Pressable
              key={`${release.environment}:${release.version}`}
              accessibilityRole="button"
              accessibilityState={{ selected: release.version === version }}
              onPress={() => props.onVersion(release.version)}
              className={
                release.version === version
                  ? "rounded-full border border-primary bg-primary/10 px-3 py-1.5"
                  : "rounded-full border border-border-subtle px-3 py-1.5"
              }
            >
              <Text className="font-mono text-xs">
                {release.version} · {release.environment}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <Text className="text-sm text-foreground-muted">
        {currentReleases(document)
          .map((release) => `${release.environment} ${release.version}`)
          .join(" · ")}
        {document.unreleased
          ? ` · ${document.unreleased.commits} commits since ${document.unreleased.since}`
          : ""}
      </Text>
      {attention.length ? (
        <View className="gap-2">
          <Text className="text-lg font-t3-semibold">Waiting on you · {attention.length}</Text>
          {attention.map((item) => {
            const age = releaseAge(item.since, now);
            return (
              <Card key={item.id} onPress={item.url ? () => open(item.url) : undefined}>
                <Text
                  className={`font-t3-semibold ${item.tone === "error" ? "text-danger-foreground" : item.tone === "warning" ? "text-warning-foreground" : ""}`}
                >
                  {item.title}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {item.detail}
                  {age ? ` · ${age} ago` : ""} · {item.source}
                </Text>
              </Card>
            );
          })}
        </View>
      ) : null}
      {gates.length ? (
        <View className="gap-2">
          <Text className="text-lg font-t3-semibold">Rollout gates</Text>
          {gates.map((gate) => (
            <Card key={gate.id} onPress={gate.url ? () => open(gate.url) : undefined}>
              <Text className="font-t3-semibold">{gate.name}</Text>
              <Text className="text-sm text-foreground-muted">
                {gate.steps
                  .map((step) =>
                    step.state === "done"
                      ? `✓ ${step.label}`
                      : step.state === "waiting"
                        ? `${step.label} · approve`
                        : step.state === "failed"
                          ? `✕ ${step.label}`
                          : step.label,
                  )
                  .join("  →  ")}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
      {targetGroups.length ? (
        <View className="gap-2">
          <Text className="text-lg font-t3-semibold">Where {version} is</Text>
          {targetGroups.map((group) => (
            <View key={group.key} className="gap-2">
              <Text className="text-sm font-t3-semibold">
                {group.group}
                {group.detail ? ` · ${group.detail}` : ""}
              </Text>
              {group.rows.map((row) => (
                <Card
                  key={row.target.id}
                  onPress={row.binary?.url ? () => open(row.binary?.url) : undefined}
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 font-t3-semibold">{row.target.name}</Text>
                    <Text className={`text-sm ${TONE_TEXT[row.check.tone]}`}>
                      {row.check.label}
                    </Text>
                  </View>
                  <Text className="text-sm text-foreground-muted">{binaryLine(row, version)}</Text>
                  <Text className="text-sm text-foreground-muted">{otaLine(row)}</Text>
                </Card>
              ))}
            </View>
          ))}
          <Text className="text-xs text-foreground-muted">
            Percentages are the share of users offered an update, not installs.
          </Text>
        </View>
      ) : null}
      {document.services.length ? (
        <View className="gap-2">
          <Text className="text-lg font-t3-semibold">Services</Text>
          {document.services.map((service) => (
            <Card key={service.id}>
              <Text className="font-t3-semibold">
                {service.name}
                {service.host ? ` · ${service.host}` : ""}
              </Text>
              {service.deployments.map((deployment) => (
                <Text
                  key={deployment.environment}
                  className={`text-sm ${deployment.state === "failed" ? "text-danger-foreground" : deployment.pending?.state === "waiting" ? "text-warning-foreground" : "text-foreground-muted"}`}
                >
                  {deployment.environment}:{" "}
                  {deployment.state === "retired"
                    ? "Retired"
                    : (deployment.version ?? deployment.state)}
                  {deployment.at ? ` · ${releaseAge(deployment.at, now)}` : ""}
                  {deployment.pending
                    ? ` → ${deployment.pending.version} ${deployment.pending.state}`
                    : ""}
                </Text>
              ))}
            </Card>
          ))}
        </View>
      ) : null}
    </>
  );
}
