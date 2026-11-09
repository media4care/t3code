import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceEnvironment,
  type SecretReference,
} from "@t3tools/contracts";
import { RELEASE_CREDENTIALS, type ReleaseCredential } from "@t3tools/client-runtime/releases";
import { XIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
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
      environmentKey={query.data.environmentKey}
      title={props.title}
      {...(props.id !== undefined ? { id: props.id } : {})}
    />
  );
}

function ReleaseCredentialList(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentKey: string;
  readonly title: string;
  readonly id?: string;
}) {
  const { environmentId, environmentKey } = props;
  const variables = useEnvironmentSettings(
    environmentId,
    (settings) => settings.releaseEnvironments[environmentKey] ?? NO_VARIABLES,
  );
  const secretSources = useSecretSources(environmentId);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save release credentials",
  });
  const save = (credential: ReleaseCredential, value: string | SecretReference | null) => {
    const others = variables.filter((variable) => variable.name !== credential.name);
    const next =
      value === null || value === ""
        ? others
        : [...others, { name: credential.name, value, sensitive: credential.sensitive }];
    void updateSettings({
      environmentId,
      input: {
        patch: { releaseEnvironments: { [environmentKey]: next.length > 0 ? next : null } },
      },
    });
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
                    onCommit={(value) => save(credential, value)}
                    sources={secretSources}
                    onSecretChange={(secret) => save(credential, secret ?? null)}
                    aria-label={credential.label}
                  />
                  {variable !== undefined ? (
                    <Button
                      type="button"
                      size="icon-micro"
                      variant="ghost-destructive"
                      onClick={() => save(credential, null)}
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
                  onCommit={(value) => save(credential, value.trim())}
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
    </SettingsSection>
  );
}
