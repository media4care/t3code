import type { ContextMenuItem } from "@t3tools/contracts";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { ensureLocalApi } from "~/localApi";
import { toastManager } from "../ui/toast";

export async function showGitExplorerContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position: { x: number; y: number },
  activate: (action: T) => void | Promise<void>,
) {
  try {
    const action = await ensureLocalApi().contextMenu.show(items, position);
    if (action !== null) await activate(action);
  } catch {
    toastManager.add({ type: "error", title: "Could not complete the menu action" });
  }
}

export async function copyGitExplorerValue(value: string, label: string) {
  if (await writeTextToClipboard(value, label))
    toastManager.add({ type: "success", title: `Copied ${label}` });
}

export function gitExplorerMenuPosition(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
}) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX || bounds.left, y: event.clientY || bounds.bottom };
}
