import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Image } from "expo-image";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  EnvironmentId,
  ProjectId,
  ReleaseBinary,
  ReleaseStatusDocument,
  ReleaseStore,
} from "@t3tools/contracts";
import {
  currentReleases,
  defaultReleaseVersion,
  releaseAge,
  releaseApps,
  releaseAttention,
  releaseGates,
  releasePlatformSummaries,
  releasePresence,
  releasePresenceLabel,
  RELEASE_REACH,
  RELEASES_CONFIGURATION_EXAMPLE,
  type ReleaseAppRow,
  type ReleaseTone,
} from "@t3tools/client-runtime/releases";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import IconBrandAndroid from "@tabler/icons-react-native/IconBrandAndroid";
import IconBrandApple from "@tabler/icons-react-native/IconBrandApple";
import IconBrandAppstore from "@tabler/icons-react-native/IconBrandAppstore";
import IconBrandFirebase from "@tabler/icons-react-native/IconBrandFirebase";
import IconBrandGooglePlay from "@tabler/icons-react-native/IconBrandGooglePlay";
import IconCloudDownload from "@tabler/icons-react-native/IconCloudDownload";
import IconDeviceMobile from "@tabler/icons-react-native/IconDeviceMobile";
import IconPropeller from "@tabler/icons-react-native/IconPropeller";
import IconWorld from "@tabler/icons-react-native/IconWorld";
import type { Icon } from "@tabler/icons-react-native/types";
import { useResolveClassNames } from "uniwind";
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
        <ReleaseDetails
          document={document}
          icons={snapshot?.icons}
          version={selected}
          now={now}
          onVersion={setVersion}
        />
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

const PLATFORM_ICON: Record<NonNullable<ReleaseAppRow["platform"]>, Icon> = {
  ios: IconBrandApple,
  android: IconBrandAndroid,
  web: IconWorld,
};
const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web" } as const;
const STORE_ICON: Record<ReleaseStore, { icon: Icon; color?: string }> = {
  "app-store": { icon: IconBrandAppstore, color: "#0D84FF" },
  testflight: { icon: IconPropeller, color: "#1A9CF0" },
  play: { icon: IconBrandGooglePlay, color: "#01A66F" },
  firebase: { icon: IconBrandFirebase, color: "#F59E0B" },
  direct: { icon: IconCloudDownload },
};

function PlatformIcon(props: { platform: ReleaseAppRow["platform"] }) {
  const { color } = useResolveClassNames("text-foreground-muted");
  const PlatformGlyph = props.platform ? PLATFORM_ICON[props.platform] : IconDeviceMobile;
  return <PlatformGlyph size={18} color={color} strokeWidth={1.8} />;
}

function StoreIcon(props: { binary: ReleaseBinary | undefined }) {
  const { color: muted } = useResolveClassNames("text-foreground-muted");
  const store = props.binary?.store ? STORE_ICON[props.binary.store] : null;
  if (!store) return null;
  const StoreGlyph = store.icon;
  return <StoreGlyph size={14} color={store.color ?? muted} strokeWidth={2} />;
}

function binaryDetail(binary: ReleaseBinary, now: number) {
  const rollout = binary.rollout;
  const percent =
    binary.audience !== "public"
      ? binary.build
      : !rollout || rollout.state === "completed"
        ? `${rollout?.percent ?? 100}%`
        : rollout.state === "active"
          ? `staged ${rollout.percent}%`
          : `${rollout.state} ${rollout.percent}%`;
  const age = releaseAge(binary.updatedAt, now);
  return [binary.label, percent, age].filter(Boolean).join(" · ");
}

function versionClass(version: string, selected: string) {
  return version === selected
    ? "font-mono text-sm font-t3-semibold text-primary"
    : "font-mono text-sm font-t3-semibold";
}

function BinaryLine(props: {
  title: string;
  binary: ReleaseBinary | null;
  version: string;
  now: number;
}) {
  const binary = props.binary;
  return (
    <Pressable
      disabled={!binary?.url}
      onPress={() => open(binary?.url)}
      className="flex-row items-center gap-2"
    >
      <Text className="w-16 text-xs text-foreground-muted">{props.title}</Text>
      {binary ? (
        <>
          <StoreIcon binary={binary} />
          <Text className={versionClass(binary.version, props.version)}>{binary.version}</Text>
          <Text numberOfLines={1} className="flex-1 text-xs text-foreground-muted">
            {binaryDetail(binary, props.now)}
          </Text>
        </>
      ) : (
        <Text className="text-xs text-foreground-muted">–</Text>
      )}
    </Pressable>
  );
}

function OtaLines(props: { row: ReleaseAppRow; version: string }) {
  if (props.row.ota.length === 0)
    return (
      <View className="flex-row items-center gap-2">
        <Text className="w-16 text-xs text-foreground-muted">OTA</Text>
        <Text className="text-xs text-foreground-muted">
          {props.row.hasOtaChannel ? "No live update" : "–"}
        </Text>
      </View>
    );
  return props.row.ota.map((lane) => {
    // Unknown reach is said once under the apps, not on every line.
    const reach = lane.reach && lane.reach !== "unknown" ? RELEASE_REACH[lane.reach] : null;
    return (
      <Pressable
        key={lane.key}
        disabled={!lane.live?.url}
        onPress={() => open(lane.live?.url)}
        className="flex-row items-center gap-2"
      >
        <Text className="w-16 text-xs text-foreground-muted">OTA</Text>
        {lane.live ? (
          <Text className={versionClass(lane.live.version, props.version)}>
            {lane.live.version}
          </Text>
        ) : null}
        <Text numberOfLines={1} className="flex-1 text-xs text-foreground-muted">
          {[
            lane.label,
            lane.live ? `${lane.live.percent}%` : null,
            lane.preview ? `preview ${lane.preview.version}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {reach ? <Text className={`text-xs ${TONE_TEXT[reach.tone]}`}>{reach.label}</Text> : null}
      </Pressable>
    );
  });
}

function AppRowCard(props: { row: ReleaseAppRow; version: string; now: number }) {
  const { row, version, now } = props;
  return (
    <View
      className={
        row.tone === "error" || row.tone === "warning"
          ? "gap-1.5 rounded-xl border border-warning-border bg-card p-3"
          : "gap-1.5 rounded-xl border border-border-subtle bg-card p-3"
      }
    >
      <View className="flex-row items-center gap-2">
        <PlatformIcon platform={row.platform} />
        <Text className="flex-1 font-t3-semibold">
          {row.platform ? PLATFORM_LABEL[row.platform] : row.name}
          {row.detail ? (
            <Text className="text-sm text-foreground-muted"> · {row.detail}</Text>
          ) : null}
        </Text>
      </View>
      <BinaryLine title="Store" binary={row.store} version={version} now={now} />
      <OtaLines row={row} version={version} />
      <BinaryLine title="Testers" binary={row.testers} version={version} now={now} />
    </View>
  );
}

function ReleaseDetails(props: {
  document: ReleaseStatusDocument;
  icons: Readonly<Record<string, string>> | undefined;
  version: string;
  now: number;
  onVersion: (version: string) => void;
}) {
  const { document, version, now } = props;
  const apps = releaseApps(document, props.icons);
  const attention = releaseAttention(document, apps);
  const gates = releaseGates(document, version);
  return (
    <>
      {document.sources.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {document.sources.map((source) => (
            <View
              key={source.id}
              className={
                source.status === "ok"
                  ? "flex-row items-center gap-1.5 rounded-full border border-border-subtle px-2 py-0.5"
                  : "flex-row items-center gap-1.5 rounded-full border border-dashed border-border-subtle px-2 py-0.5"
              }
            >
              <View
                className={`size-1.5 rounded-full ${source.status === "ok" ? "bg-green-500" : source.status === "error" ? "bg-danger-foreground" : "bg-foreground-muted"}`}
              />
              <Text className={`text-xs ${source.status === "ok" ? "" : "text-foreground-muted"}`}>
                {source.name}
                {source.status === "error"
                  ? " failed"
                  : source.status === "unconfigured"
                    ? " · not set up"
                    : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
      {apps.length ? (
        <View className="gap-2">
          <Text className="text-sm">
            {releasePresenceLabel(version, releasePresence(apps, version))}
          </Text>
          {releasePlatformSummaries(apps).map((summary) => (
            <Card key={summary.platform}>
              <View className="flex-row items-center gap-2">
                <PlatformIcon platform={summary.platform} />
                <Text className="font-t3-semibold">{PLATFORM_LABEL[summary.platform]}</Text>
              </View>
              {(
                [
                  ["Store", summary.store, summary.store[0]],
                  ["OTA", summary.ota, undefined],
                  ["Testers", summary.testers, summary.testers[0]],
                ] as const
              ).map(([title, items, first]) => (
                <View key={title} className="flex-row flex-wrap items-center gap-2">
                  <Text className="w-16 text-xs text-foreground-muted">{title}</Text>
                  <StoreIcon binary={first} />
                  {items.length === 0 ? (
                    <Text className="text-xs text-foreground-muted">–</Text>
                  ) : (
                    items.slice(0, 3).map((item) => (
                      <Text key={item.version} className={versionClass(item.version, version)}>
                        {item.version}
                      </Text>
                    ))
                  )}
                  {items.length > 3 ? (
                    <Text className="text-xs text-foreground-muted">+{items.length - 3}</Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ))}
        </View>
      ) : null}
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
      {apps.length ? (
        <View className="gap-2">
          <Text className="text-lg font-t3-semibold">Apps</Text>
          {apps.map((app) => (
            <View key={app.key} className="gap-2">
              <View className="flex-row items-center gap-2.5">
                {app.icon ? (
                  <Image
                    source={{ uri: app.icon }}
                    style={{ width: 28, height: 28, borderRadius: 7 }}
                  />
                ) : null}
                <Text className="text-base font-t3-semibold">{app.name}</Text>
              </View>
              {app.builds.map((build) => {
                const single = build.variants.length === 1;
                return (
                  <View key={build.key} className="gap-2">
                    <Text className="text-sm font-t3-semibold">
                      {build.name}
                      {single && build.variants[0]?.name ? (
                        <Text className="text-sm text-foreground-muted">
                          {" "}
                          · {build.variants[0].name}
                        </Text>
                      ) : null}
                    </Text>
                    {build.variants.map((variant) => (
                      <View key={variant.key} className={single ? "gap-2" : "gap-2 pl-3"}>
                        {single ? null : (
                          <Text className="text-xs text-foreground-muted">
                            {variant.name ?? "–"}
                          </Text>
                        )}
                        {variant.rows.map((row) => (
                          <AppRowCard key={row.key} row={row} version={version} now={now} />
                        ))}
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
          {apps.some((app) =>
            app.rows.some((row) => row.ota.some((lane) => lane.reach === "unknown")),
          ) ? (
            <Text className="text-xs text-foreground-muted">
              OTA reach is unknown where it isn't shown: those store builds don't report their
              runtime.
            </Text>
          ) : null}
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
