import {
  agentMapMetadata,
  agentMapStatus,
  type ThreadAgentMapNode,
} from "@t3tools/client-runtime/state/thread-agent-map";
import { subagentDetailPreview } from "@t3tools/client-runtime/state/subagent-display";
import type { ServerProvider } from "@t3tools/contracts";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { AgentElapsed } from "./AgentElapsed";

export function AgentMapStatus({ node }: { node: ThreadAgentMapNode }) {
  const { label, tone } = agentMapStatus(node);
  const Icon =
    tone === "done"
      ? CheckIcon
      : tone === "waiting"
        ? MessageCircleQuestionIcon
        : tone === "failed"
          ? XIcon
          : CircleDashedIcon;
  return (
    <Badge
      variant={
        tone === "done"
          ? "success"
          : tone === "waiting"
            ? "warning"
            : tone === "failed"
              ? "error"
              : tone === "working"
                ? "info"
                : "secondary"
      }
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

export function ThreadAgentMap(props: {
  readonly title: string;
  readonly nodes: ReadonlyArray<ThreadAgentMapNode>;
  readonly providerFor: (node: ThreadAgentMapNode) => ServerProvider | undefined;
  readonly renderInspector: (node: ThreadAgentMapNode) => ReactNode;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  const selected =
    props.nodes.find((node) => node.id === selection) ??
    props.nodes.find((node) => agentMapStatus(node).tone === "waiting") ??
    props.nodes.find((node) => agentMapStatus(node).tone === "working") ??
    props.nodes[0];
  const children = new Map<string | null, ThreadAgentMapNode[]>();
  for (const node of props.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const rootCount = children.get(null)?.length ?? 0;
  const activePath = new Set<string>();
  const byId = new Map(props.nodes.map((node) => [node.id, node]));
  let ancestor = selected;
  while (ancestor && !activePath.has(ancestor.id)) {
    activePath.add(ancestor.id);
    ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
  }
  const patternId = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const lines = useRef<SVGSVGElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- connects measured card positions and observes the graph's responsive layout while it is mounted
  useEffect(() => {
    const container = canvas.current;
    const svg = lines.current;
    if (!container || !svg) return;
    const draw = () => {
      const bounds = container.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      const cards = new Map(
        Array.from(container.querySelectorAll<HTMLElement>("[data-agent-node]")).map((card) => [
          card.dataset.agentNode!,
          card.getBoundingClientRect(),
        ]),
      );
      const paths = [];
      for (const node of props.nodes) {
        const from = cards.get(node.parentId ?? "root");
        const to = cards.get(node.id);
        if (!from || !to) continue;
        const narrow = bounds.width < 560;
        const x1 = (narrow ? from.left + 12 : from.left + from.width / 2) - bounds.left;
        const y1 = from.bottom - bounds.top;
        const x2 = (narrow ? to.left : to.left + to.width / 2) - bounds.left;
        const y2 = (narrow ? to.top + 32 : to.top) - bounds.top;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute(
          "d",
          narrow
            ? `M ${x1} ${y1} V ${y2 - 8} Q ${x1} ${y2} ${x1 + 8} ${y2} H ${x2}`
            : `M ${x1} ${y1} C ${x1} ${y1 + 24}, ${x2} ${y2 - 24}, ${x2} ${y2}`,
        );
        path.setAttribute(
          "class",
          activePath.has(node.id)
            ? "fill-none stroke-info/70 stroke-[1.5]"
            : "fill-none stroke-border stroke-[1.5]",
        );
        paths.push(path);
      }
      svg.replaceChildren(...paths);
    };
    const release = observeResize(
      [container, ...container.querySelectorAll("[data-agent-node]")],
      draw,
    );
    draw();
    return release;
  });

  const renderGroup = (parentId: string | null): ReactNode => {
    const siblings = children.get(parentId) ?? [];
    const limit = limits[parentId ?? "root"] ?? 6;
    return (
      <>
        {siblings.slice(0, limit).map((node) => {
          const provider = props.providerFor(node);
          const metadata = agentMapMetadata(node, provider);
          const preview = subagentDetailPreview(node.agent);
          const descendants = children.get(node.id)?.length ?? 0;
          return (
            <div key={node.id} className="min-w-0">
              <button
                type="button"
                data-agent-node={node.id}
                aria-pressed={selected?.id === node.id}
                aria-label={`${node.agent.title}, ${agentMapStatus(node).label}`}
                onClick={() => setSelection(node.id)}
                className={cn(
                  "relative block w-full cursor-pointer rounded-2xl border border-border bg-linear-to-br from-foreground/3 to-card bg-card p-4 text-left outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                  selected?.id === node.id &&
                    "border-info/70 from-info/8 shadow-lg shadow-info/10 ring-2 ring-inset ring-info/10",
                )}
              >
                <span className="mb-3 flex min-w-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-foreground/5 bg-foreground/5">
                    {provider || node.source ? (
                      <ProviderInstanceIcon
                        driverKind={provider?.driver ?? node.source!.driver}
                        displayName={metadata.provider}
                        acpRegistryIconUrl={provider?.iconUrl}
                        iconClassName="size-4"
                      />
                    ) : (
                      <BotIcon className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{metadata.model}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {metadata.provider}
                    </span>
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    <AgentElapsed agent={node.agent} compact />
                  </span>
                </span>
                <span className="line-clamp-2 break-words text-sm font-medium">
                  {node.agent.title}
                </span>
                <span className="mt-1 block min-h-8 text-2xs leading-relaxed text-muted-foreground">
                  <span className="line-clamp-2 break-words">
                    {preview ?? "No update reported yet."}
                  </span>
                </span>
                <span className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <AgentMapStatus node={node} />
                  <span className="text-2xs text-muted-foreground">{node.kind}</span>
                </span>
                {node.source?.remoteChild ? (
                  <span className="mt-2 block truncate text-2xs text-muted-foreground">
                    on {node.source.remoteChild.label}
                  </span>
                ) : null}
              </button>
              {descendants > 0 ? (
                <div className="mt-2 flex justify-center">
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-expanded={!collapsed.has(node.id)}
                    onClick={() =>
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(node.id)) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                      })
                    }
                  >
                    <ChevronDownIcon
                      className={collapsed.has(node.id) ? "-rotate-90" : undefined}
                    />
                    {descendants} {descendants === 1 ? "child" : "children"}
                  </Button>
                </div>
              ) : null}
              {descendants > 0 && !collapsed.has(node.id) ? (
                <div className="mt-6 ml-4 flex flex-col gap-6 @min-[560px]/agent-map:ml-0">
                  {renderGroup(node.id)}
                </div>
              ) : null}
            </div>
          );
        })}
        {siblings.length > limit ? (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLimits({ ...limits, [parentId ?? "root"]: limit + 6 })}
            >
              Show {Math.min(6, siblings.length - limit)} more
            </Button>
          </div>
        ) : null}
      </>
    );
  };
  const counts = props.nodes.reduce(
    (total, node) => {
      const tone = agentMapStatus(node).tone;
      total[tone] = (total[tone] ?? 0) + 1;
      return total;
    },
    {} as Partial<Record<ReturnType<typeof agentMapStatus>["tone"], number>>,
  );
  return (
    <div className="@container/agent-map">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{props.nodes.length} agents</span>
        {counts.working ? (
          <span className="text-info-foreground">{counts.working} working</span>
        ) : null}
        {counts.waiting ? (
          <span className="text-warning-foreground">{counts.waiting} waiting</span>
        ) : null}
        {counts.done ? <span>{counts.done} done</span> : null}
        {counts.failed ? (
          <span className="text-destructive-foreground">{counts.failed} failed</span>
        ) : null}
      </div>
      <div ref={canvas} className="relative isolate py-6">
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-20 size-full text-border opacity-40"
        >
          <defs>
            <pattern id={patternId} width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
        <svg
          ref={lines}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 size-full overflow-visible"
        />
        <div
          data-agent-node="root"
          className="flex w-fit max-w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 @min-[560px]/agent-map:mx-auto"
        >
          <GitBranchIcon className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{props.title}</div>
            <div className="text-2xs text-muted-foreground">This thread</div>
          </div>
        </div>
        {props.nodes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No subagents launched in this thread.
          </p>
        ) : (
          <div
            className={cn(
              "mt-10 ml-7 grid grid-cols-1 items-start gap-6",
              rootCount === 1
                ? "@min-[560px]/agent-map:mx-auto @min-[560px]/agent-map:max-w-sm"
                : "@min-[560px]/agent-map:ml-0 @min-[560px]/agent-map:grid-cols-2",
              rootCount > 2 && "@min-[740px]/agent-map:grid-cols-3",
            )}
          >
            {renderGroup(null)}
          </div>
        )}
      </div>
      {selected ? props.renderInspector(selected) : null}
    </div>
  );
}
