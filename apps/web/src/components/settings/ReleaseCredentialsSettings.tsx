import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceEnvironment,
  type ReleaseSource,
  type ReleasesSnapshot,
  type SecretReference,
} from "@t3tools/contracts";
import { RELEASE_CREDENTIALS, type ReleaseCredential } from "@t3tools/client-runtime/releases";
import { useAtomValue } from "@effect/atom-react";
import { XIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const NO_VARIABLES: ProviderInstanceEnvironment = [];

/** Shown once the project's `t3.json` has a `releases` command. */
export function ReleaseCredentialsSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly id?: string;
}) {
  const { environmentId, projectId } = props;
  const query = useEnvironmentQuery(
    serverEnvironment.releasesLive({ environmentId, input: { projectId } }),
  );
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  if (!canWrite || query.data?.configured !== true) return null;
  return (
    <ReleaseCredentialList
      environmentId={environmentId}
      projectId={projectId}
      snapshot={query.data}
      title={props.title}
      {...(props.id !== undefined ? { id: props.id } : {})}
    />
  );
}

function ReleaseCredentialList(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly snapshot: ReleasesSnapshot;
  readonly title: string;
  readonly id?: string;
}) {
  const { environmentId, projectId } = props;
  const environmentKey = props.snapshot.environmentKey;
  const variables = useEnvironmentSettings(
    environmentId,
    (settings) => settings.releaseEnvironments[environmentKey] ?? NO_VARIABLES,
  );
  const secretSources = useSecretSources(environmentId);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save release credentials",
  });
  const refresh = useAtomCommand(serverEnvironment.refreshReleases, {
    label: "check release credentials",
  });
  const canCheck = useAtomValue(serverEnvironment.refreshReleases.permissionAtom(environmentId));
  const save = async (credential: ReleaseCredential, value: string | SecretReference | null) => {
    const others = variables.filter((variable) => variable.name !== credential.name);
    const next =
      value === null || value === ""
        ? others
        : [...others, { name: credential.name, value, sensitive: credential.sensitive }];
    const result = await updateSettings({
      environmentId,
      input: {
        patch: { releaseEnvironments: { [environmentKey]: next.length > 0 ? next : null } },
      },
    });
    if (result._tag === "Success" && canCheck)
      await refresh({ environmentId, input: { projectId, force: true } });
  };
  const sharedWith = environmentKey.startsWith("project:") ? "this checkout" : environmentKey;

  return (
    <SettingsSection {...(props.id !== undefined ? { id: props.id } : {})} title={props.title}>
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        What the Releases page uses to read pipelines, stores and OTA updates. Shared by every
        checkout of <span className="font-medium text-foreground">{sharedWith}</span> on this
        machine. Tokens are stored separately and never sent back to the app.
      </p>
      {RELEASE_CREDENTIALS.map((credential) => {
        const variable = variables.find((candidate) => candidate.name === credential.name);
        const stored = variable === undefined || variable.valueRedacted ? "" : variable.value;
        return (
          <SettingsRow
            key={credential.name}
            title={credential.label}
            description={credential.description}
            control={
              credential.sensitive ? (
                <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-80">
                  <SecretSourceInput
                    size="sm"
                    className="min-w-0 flex-1"
                    value={stored}
                    configured={variable?.valueRedacted === true}
                    onCommit={(value) => void save(credential, value)}
                    sources={secretSources}
                    onSecretChange={(secret) => void save(credential, secret ?? null)}
                    aria-label={credential.label}
                  />
                  {variable !== undefined ? (
                    <Button
                      type="button"
                      size="icon-micro"
                      variant="ghost-destructive"
                      onClick={() => void save(credential, null)}
                      aria-label={`Remove ${credential.label}`}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
              ) : (
                <DraftInput
                  size="sm"
                  className="w-full sm:w-80"
                  value={typeof stored === "string" ? stored : ""}
                  onCommit={(value) => void save(credential, value.trim())}
                  placeholder={credential.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={credential.label}
                />
              )
            }
          />
        );
      })}
      {canCheck ? <ReleaseCheck snapshot={props.snapshot} /> : null}
    </SettingsSection>
  );
}

const SOURCE_STATUS: Record<ReleaseSource["status"], { label: string; dot: string }> = {
  ok: { label: "ok", dot: "bg-success" },
  error: { label: "failed", dot: "bg-destructive" },
  unconfigured: { label: "not set up", dot: "bg-muted-foreground/50" },
};

/** What the last run of the release command reported, so a rejected credential shows here. */
function ReleaseCheck(props: { readonly snapshot: ReleasesSnapshot }) {
  const { running, lastRun, document } = props.snapshot;
  const sources = document?.sources ?? [];
  if (!running && !lastRun?.error && sources.length === 0) return null;
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5 px-3 py-2.5 text-xs sm:px-4">
      <p className="text-muted-foreground">
        {running ? "Checking with the release command…" : "Last check"}
      </p>
      {lastRun?.error ? (
        <p className="break-words whitespace-pre-wrap text-destructive-foreground">
          {lastRun.error}
        </p>
      ) : null}
      {sources.length > 0 ? (
        <ul
          aria-label="Release sources"
          className={cn("flex flex-col gap-1", running && "opacity-60")}
        >
          {sources.map((source) => {
            const status = SOURCE_STATUS[source.status];
            return (
              <li key={source.id} className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", status.dot)}
                />
                <span className="shrink-0 font-medium">{source.name}</span>
                <span className="shrink-0 text-muted-foreground">{status.label}</span>
                {source.status !== "ok" && source.message ? (
                  <span className="min-w-0 break-words text-muted-foreground">
                    {source.message}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
