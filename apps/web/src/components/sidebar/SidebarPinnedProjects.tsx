import { SquarePenIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SortableSidebarMarker } from "./SidebarListMarkers";

const SHELF_ROW = "shelf:pinned-projects";

/**
 * Pinned projects as a sidebar shelf. Like Working, a closed shelf still shows the row
 * you are on, here the projects the sidebar is filtered to.
 */
export const SidebarPinnedProjects = memo(function SidebarPinnedProjects(props: {
  projects: readonly SidebarProjectSnapshot[];
  scopedProjectKeys: readonly string[];
  className?: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (group: SidebarProjectSnapshot) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
  onContextMenu: (group: SidebarProjectSnapshot, position: { x: number; y: number }) => void;
}) {
  const visible = props.expanded
    ? props.projects
    : props.projects.filter((group) => props.scopedProjectKeys.includes(group.projectKey));
  return (
    <SortableSidebarMarker
      marker="pinned-projects"
      data-testid="sidebar-pinned-projects"
      className={cn("relative", props.className)}
    >
      <div className="mx-0.5">
        <CollapsibleSectionHeader
          data-sidebar-row={SHELF_ROW}
          onClick={props.onToggle}
          expanded={props.expanded}
          data-testid="sidebar-pinned-projects-shelf-toggle"
          accessory={<span className="font-normal tabular-nums">{props.projects.length}</span>}
        >
          Pinned projects
        </CollapsibleSectionHeader>
      </div>
      <ul role="presentation" className="flex flex-col gap-px">
        {visible.map((group) => {
          const rowId = `pinned-project:${group.projectKey}`;
          const isActive = props.scopedProjectKeys.includes(group.projectKey);
          return (
            <li key={group.projectKey} className="group/pinned-project relative list-none">
              <button
                type="button"
                data-sidebar-row={rowId}
                data-sidebar-parent={SHELF_ROW}
                aria-current={isActive ? "true" : undefined}
                onClick={() => props.onSelect(group)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onContextMenu(group, { x: event.clientX, y: event.clientY });
                }}
                className={cn(
                  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                    : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover",
                )}
              >
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{group.displayName}</span>
              </button>
              <span className="absolute inset-y-0 right-1 flex items-center opacity-0 focus-within:opacity-100 group-hover/pinned-project:opacity-100 pointer-coarse:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        data-sidebar-action-for={rowId}
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`New thread in ${group.displayName}`}
                        onClick={() => props.onNewThread(group)}
                      />
                    }
                  >
                    <SquarePenIcon aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup>New thread in {group.displayName}</TooltipPopup>
                </Tooltip>
              </span>
            </li>
          );
        })}
      </ul>
    </SortableSidebarMarker>
  );
});
