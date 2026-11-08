import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProviderInstanceEnvironment,
} from "@t3tools/contracts";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderEnvironmentSection } from "../settings/ProviderInstanceCard";
import { useSecretSources } from "../settings/SecretSourceInput";

const NO_VARIABLES: ProviderInstanceEnvironment = [];

export function ReleaseEnvironmentSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentKey: string;
}) {
  const { environmentId, environmentKey } = props;
  const environment = useEnvironmentSettings(
    environmentId,
    (settings) => settings.releaseEnvironments[environmentKey] ?? NO_VARIABLES,
  );
  const secretSources = useSecretSources(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save release environment",
  });
  if (!canWrite) return null;
  return (
    <section className="rounded-xl border border-border px-4 pt-2">
      <ProviderEnvironmentSection
        environment={environment}
        secretSources={secretSources}
        description={
          <>
            Tokens the release command needs. They override the server’s environment and apply to
            every clone of <code>{environmentKey}</code>.
          </>
        }
        onChange={(next) => {
          void updateSettings({
            environmentId,
            input: {
              patch: { releaseEnvironments: { [environmentKey]: next.length > 0 ? next : null } },
            },
          });
        }}
      />
    </section>
  );
}
