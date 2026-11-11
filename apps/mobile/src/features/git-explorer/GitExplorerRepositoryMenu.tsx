import { useAtomSet } from "@effect/atom-react";

import { useProjects } from "../../state/entities";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";

type ProjectRef = { readonly environmentId: string; readonly projectId: string };

/** The repository the Git Explorer tab opens on: the last one picked, else the first. */
export function gitExplorerHomeProject<
  Project extends {
    readonly environmentId: string;
    readonly id: string;
    readonly isScratch?: true;
  },
>(projects: readonly Project[], saved: ProjectRef | undefined) {
  const repositories = projects.filter((project) => !project.isScratch);
  return (
    repositories.find(
      (project) => project.environmentId === saved?.environmentId && project.id === saved.projectId,
    ) ?? repositories[0]
  );
}

/** The Repository chip. Picking one remembers it for the next time the tab opens. */
export function GitExplorerRepositoryMenu(props: {
  readonly selected: ProjectRef;
  readonly onSelect?: (next: ProjectRef) => void;
}) {
  const projects = useProjects().filter((project) => !project.isScratch);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const idOf = (project: ProjectRef) => JSON.stringify([project.environmentId, project.projectId]);
  const selectedId = idOf(props.selected);
  const multipleEnvironments = new Set(projects.map((project) => project.environmentId)).size > 1;
  const choices = projects.map((project) => ({
    ref: { environmentId: project.environmentId, projectId: project.id },
    title: project.title,
  }));
  return (
    <ListFilterMenu
      label={choices.find((choice) => idOf(choice.ref) === selectedId)?.title ?? "Repository"}
      accessibilityLabel="Choose repository"
      actions={choices.map((choice) => ({
        id: idOf(choice.ref),
        title: choice.title,
        ...(multipleEnvironments
          ? { subtitle: savedConnectionsById[choice.ref.environmentId]?.environmentLabel }
          : {}),
        state: idOf(choice.ref) === selectedId ? ("on" as const) : ("off" as const),
      }))}
      onSelect={(id) => {
        const next = choices.find((choice) => idOf(choice.ref) === id)?.ref;
        if (!next) return;
        savePreferences({ gitExplorerProject: next });
        props.onSelect?.(next);
      }}
    />
  );
}
