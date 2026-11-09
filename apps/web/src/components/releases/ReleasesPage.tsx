import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, KeyRoundIcon, PackageIcon, RefreshCwIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
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
  RELEASES_CONFIGURATION_EXAMPLE,
} from "@t3tools/client-runtime/releases";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { useClientSettings } from "../../hooks/useSettings";

import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import {
  ReleaseAppTable,
  ReleaseAttentionList,
  ReleaseGateList,
  ReleasePlatformCards,
  ReleaseServiceTable,
  ReleaseSourceList,
} from "./ReleaseSections";

// An open page asks this often; the server skips the command until the document is stale.
const STALE_CHECK_MS = 60_000;

export function ReleasesPage() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<string | null>(null);
  const key = (project: (typeof projects)[number]) => `${project.environmentId}:${project.id}`;
  const connected = (environmentId: string) =>
    environments.find((candidate) => candidate.environmentId === environmentId)?.connection
      .phase === "connected";
  const project =
    projects.find((candidate) => key(candidate) === selection) ??
    projects.find((candidate) => connected(candidate.environmentId)) ??
    projects[0];
  const environment = environments.find(
    (candidate) => candidate.environmentId === project?.environmentId,
  );
  const back = useNavigateToMainApp();
  const grouping = useClientSettings(selectProjectGroupingSettings);
  return (
    <SidebarInset className="h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to threads"
          onClick={() => {
            void back();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <PackageIcon className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Releases</h1>
        <div className="ml-auto max-w-[60%]">
          <Select value={project ? key(project) : ""} onValueChange={setSelection}>
            <SelectTrigger aria-label="Releases project">
              <SelectValue>{project?.title ?? "Select a project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((item) => (
                <SelectItem key={key(item)} value={key(item)}>
                  {item.title} ·{" "}
                  {environments.find((e) => e.environmentId === item.environmentId)?.label ??
                    "Environment"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="gap-6">
          {project ? (
            <ProjectReleases
              key={key(project)}
              environmentId={project.environmentId}
              projectId={project.id}
              settingsProjectKey={deriveLogicalProjectKeyFromSettings(project, grouping)}
              connected={environment?.connection.phase === "connected"}
              environmentLabel={environment?.label ?? "Environment"}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="text-xl font-semibold">Every release, in one place</h2>
              <p className="mt-2 text-muted-foreground">
                Add a project to see its pipelines, store rollouts and OTA updates.
              </p>
            </div>
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}

function ProjectReleases(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  settingsProjectKey: string;
  connected: boolean;
  environmentLabel: string;
}) {
  const { environmentId, projectId, connected } = props;
  const query = useEnvironmentQuery(
    serverEnvironment.releasesLive({ environmentId, input: { projectId } }),
  );
  const refresh = useAtomCommand(serverEnvironment.refreshReleases);
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const canRefresh = useAtomValue(serverEnvironment.refreshReleases.permissionAtom(environmentId));
  const [version, setVersion] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const snapshot = query.data;
  const configured = snapshot?.configured === true;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the server's release status fresh while the page is open; the server ignores calls for a fresh document.
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
    const timer = window.setInterval(check, STALE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [connected, configured, canRefresh, environmentId, projectId, registry]);

  const document = snapshot?.document ?? null;
  const selected =
    (version && document?.releases.some((release) => release.version === version)
      ? version
      : null) ?? (document ? defaultReleaseVersion(document) : null);
  const updated = releaseAge(document?.generatedAt, now);
  const apps = document ? releaseApps(document, snapshot?.icons) : [];
  const openCredentials = () => {
    void navigate({
      to: "/settings/projects",
      search: { project: props.settingsProjectKey, machine: environmentId },
      hash: "release-credentials",
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{document?.title ?? "Releases"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.environmentLabel}
            {!connected ? " · Offline" : ""}
            {updated ? ` · updated ${updated} ago` : ""}
          </p>
        </div>
        {document && selected ? (
          <Select value={selected} onValueChange={(value) => setVersion(value)}>
            <SelectTrigger aria-label="Release" className="w-auto">
              <SelectValue>
                <span className="font-mono">{selected}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {document.releases.map((release) => (
                <SelectItem
                  key={`${release.environment}:${release.version}`}
                  value={release.version}
                >
                  <span className="font-mono">{release.version}</span> · {release.environment}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {configured ? (
          <Button variant="outline" aria-label="Release credentials" onClick={openCredentials}>
            <KeyRoundIcon />
            <span className="hidden sm:inline">Credentials</span>
          </Button>
        ) : null}
        {configured ? (
          <Button
            variant="outline"
            aria-label="Refresh releases"
            disabled={!connected || !canRefresh || snapshot?.running}
            onClick={() => {
              void refresh({ environmentId, input: { projectId, force: true } });
            }}
          >
            <RefreshCwIcon />
            <span className="hidden sm:inline">
              {snapshot?.running ? "Refreshing…" : "Refresh"}
            </span>
          </Button>
        ) : null}
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : null}
      {snapshot?.configurationError ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {snapshot.configurationError}
        </p>
      ) : null}
      {snapshot?.lastRun?.error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive-foreground">
            The release command failed
            {document ? "; showing the last status it produced." : "."}
          </p>
          <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {snapshot.lastRun.error}
          </pre>
        </div>
      ) : null}
      {!snapshot && query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading releases…</p>
      ) : null}
      {snapshot && !snapshot.configured && !snapshot.configurationError ? (
        <div className="rounded-xl border border-dashed border-border p-6">
          <h3 className="text-lg font-semibold">Connect your release status</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Add a <code>releases</code> section to this project’s <code>t3.json</code>. Its command
            prints the project’s release status as JSON: pipelines, store tracks, OTA channels and
            deployed services.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 text-xs">
            {RELEASES_CONFIGURATION_EXAMPLE}
          </pre>
        </div>
      ) : null}
      {configured && !document && snapshot?.running ? (
        <p className="text-sm text-muted-foreground">
          Reading release status. The first run can take a minute.
        </p>
      ) : null}
      {document ? (
        <ReleaseSourceList
          sources={document.sources}
          onConnect={configured ? openCredentials : undefined}
        />
      ) : null}
      {document && selected ? (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
            {currentReleases(document).map((release) => (
              <span key={release.environment}>
                {release.environment}{" "}
                <span className="font-mono text-xs font-semibold text-foreground">
                  {release.version}
                </span>
                {release.createdAt ? ` · ${releaseAge(release.createdAt, now)} ago` : ""}
              </span>
            ))}
            {document.unreleased ? (
              <span className="sm:ml-auto">
                {document.unreleased.url ? (
                  <a
                    href={document.unreleased.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {document.unreleased.commits} commits since {document.unreleased.since}
                  </a>
                ) : (
                  `${document.unreleased.commits} commits since ${document.unreleased.since}`
                )}
              </span>
            ) : null}
          </div>
          {apps.length > 0 ? (
            <p className="-mt-3 text-sm">
              {releasePresenceLabel(selected, releasePresence(apps, selected))}
            </p>
          ) : null}
          <ReleasePlatformCards summaries={releasePlatformSummaries(apps)} version={selected} />
          <ReleaseAttentionList items={releaseAttention(document, apps)} now={now} />
          <ReleaseGateList gates={releaseGates(document, selected)} version={selected} />
          <ReleaseAppTable apps={apps} version={selected} now={now} />
          {apps.length > 0 ? (
            <p className="-mt-4 text-xs text-muted-foreground">
              Percentages are the share of users offered an update, not installs.
            </p>
          ) : null}
          <ReleaseServiceTable services={document.services} now={now} />
        </>
      ) : null}
    </>
  );
}
