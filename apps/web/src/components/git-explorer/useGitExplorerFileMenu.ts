import { useAtomValue } from "@effect/atom-react";
import type { ContextMenuItem, EnvironmentId, GitExplorerFile } from "@t3tools/contracts";
import {
  resolveFileContextMenuAbsolutePath,
  useFileContextMenu,
  type FileContextMenuAction,
} from "~/fileContextMenu";
import { useOpenInPreferredEditor, usePreferredEditor } from "~/editorPreferences";
import { openInEditorMenuLabel } from "~/editorLabels";
import { shellEnvironment } from "~/state/shell";
import { toastManager } from "../ui/toast";
import { copyGitExplorerValue, showGitExplorerContextMenu } from "./gitExplorerContextMenu";

type FileAction = FileContextMenuAction | "copy-path" | "open-editor";

export function useGitExplorerFileMenu(environmentId: EnvironmentId, workspaceRoot?: string) {
  const fileMenu = useFileContextMenu(environmentId);
  const allowed = useAtomValue(shellEnvironment.openInEditor.permissionAtom(environmentId));
  const editors = fileMenu.capabilities.editorIds.filter((id) => id !== "file-manager");
  const [editor] = usePreferredEditor(editors);
  const openEditor = useOpenInPreferredEditor(environmentId, editors);
  return (file: GitExplorerFile, position: { x: number; y: number }) => {
    const target = { environmentId, filePath: file.path, workspaceRoot };
    const path = resolveFileContextMenuAbsolutePath(target);
    const canOpen = allowed && file.status !== "deleted" && path !== null;
    const items: ContextMenuItem<FileAction>[] = [
      { id: "copy-path", label: "Copy file path", icon: "copy" },
      { id: "open-editor", label: openInEditorMenuLabel(editor), disabled: !canOpen || !editor },
      ...fileMenu.buildItems(target).map((item) => ({ ...item, disabled: !canOpen })),
    ];
    return showGitExplorerContextMenu(items, position, async (action) => {
      if (action === "copy-path") return copyGitExplorerValue(file.path, "file path");
      if (!canOpen) return;
      if (action === "open-editor") {
        const result = await openEditor(path);
        if (result._tag === "Failure")
          toastManager.add({ type: "error", title: "Could not open file in editor" });
      } else await fileMenu.activate(action, target);
    });
  };
}
