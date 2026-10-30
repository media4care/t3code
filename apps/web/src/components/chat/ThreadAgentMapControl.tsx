import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  agentMapMetadata,
  deriveThreadAgentMap,
  type ThreadAgentMapNode,
} from "@t3tools/client-runtime/state/thread-agent-map";
import type { ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, NetworkIcon } from "lucide-react";
import { useState } from "react";
import {
  environmentThreadDetails,
  environmentThreadShells,
  useThreadFamily,
} from "../../state/threads";
import { useQuietThreadProjection } from "../../state/entities";
import { useEnvironment, useEnvironmentProviders } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { AgentMapStatus, ThreadAgentMap } from "./ThreadAgentMap";
import { AgentElapsed } from "./AgentElapsed";

export function ThreadAgentMapControl({ threadRef }: { threadRef: ScopedThreadRef }) {
  const subagents = useAtomValue(
    environmentThreadDetails.threadAtom(threadRef),
    (thread) => thread?.projection.subagents,
  );
  const [open, setOpen] = useState(false);
  if (!subagents?.length) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Open agent map">
        <NetworkIcon />
        Agents
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup className="w-full max-w-4xl">
          <div className="px-6 pt-6 pb-3">
            <SheetTitle>Agents</SheetTitle>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
            {open ? <AgentMapContent threadRef={threadRef} onClose={() => setOpen(false)} /> : null}
          </div>
        </SheetPopup>
      </Sheet>
    </>
  );
}

function AgentMapContent({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  useThreadFamily(threadRef.environmentId, threadRef.threadId);
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const threads = useAtomValue(
    environmentThreadShells.environmentThreadsAtom(threadRef.environmentId),
  );
  const providers = useEnvironmentProviders();
  const nodes = deriveThreadAgentMap({
    ...threadRef,
    subagents: projection?.subagents ?? [],
    threads,
  });
  const providerFor = (node: ThreadAgentMapNode) =>
    providers
      .get(
        node.source?.remoteChild?.environmentId ??
          node.target?.environmentId ??
          threadRef.environmentId,
      )
      ?.find(
        (provider) =>
          provider.instanceId ===
          (node.source?.providerInstanceId ?? node.thread?.providerInstanceId),
      );
  return (
    <ThreadAgentMap
      title={projection?.thread.title ?? "Thread"}
      nodes={nodes}
      providerFor={providerFor}
      renderInspector={(node) => (
        <AgentMapInspector
          key={node.id}
          node={node}
          threadRef={threadRef}
          provider={providerFor(node)}
          onClose={onClose}
        />
      )}
    />
  );
}

function AgentMapInspector(props: {
  node: ThreadAgentMapNode;
  threadRef: ScopedThreadRef;
  provider: ServerProvider | undefined;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"output" | "prompt" | "details">("output");
  const owner = useQuietThreadProjection(
    props.node.source === null
      ? scopeThreadRef(props.threadRef.environmentId, props.node.ownerThreadId)
      : null,
  )?.projection;
  const environment = useEnvironment(props.node.target?.environmentId ?? null);
  const navigate = useNavigate();
  const node = owner
    ? (deriveThreadAgentMap({
        environmentId: props.threadRef.environmentId,
        threadId: owner.thread.id,
        subagents: owner.subagents,
        threads: props.node.thread ? [props.node.thread] : [],
      }).find(
        (candidate) =>
          candidate.target !== null &&
          props.node.target !== null &&
          candidate.target.threadId === props.node.target.threadId &&
          candidate.target.environmentId === props.node.target.environmentId,
      ) ?? props.node)
    : props.node;
  const metadata = agentMapMetadata(node, props.provider);
  const output =
    node.agent.status === "failed"
      ? (node.agent.error ?? node.agent.result)
      : (node.agent.result ?? node.agent.progress);
  const canOpen = node.target !== null && environment !== null;
  return (
    <section
      aria-label="Selected agent"
      className="rounded-2xl border border-border bg-linear-to-br from-foreground/3 to-card bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xs tracking-widest text-muted-foreground uppercase">
            {node.kind}
          </div>
          <h3 className="mt-1 break-words text-lg font-medium">{node.agent.title}</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canOpen}
          onClick={() => {
            if (!node.target || !canOpen) return;
            props.onClose();
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(node.target),
            });
          }}
        >
          <ExternalLinkIcon />
          Conversation
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <AgentMapStatus node={node} />
        <span>
          {metadata.provider} · {metadata.model}
        </span>
        {metadata.effort ? <span>· {metadata.effort} effort</span> : null}
        <AgentElapsed agent={node.agent} />
      </div>
      {node.target === null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This provider has not exposed a separate conversation.
        </p>
      ) : environment === null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Connect to {node.source?.remoteChild?.label ?? "the environment"} to open the
          conversation.
        </p>
      ) : null}
      <div
        className="mt-5 flex gap-4 border-b border-border"
        role="group"
        aria-label="Agent information"
      >
        {(["output", "prompt", "details"] as const).map((id) => (
          <button
            key={id}
            id={`agent-map-${id}`}
            aria-pressed={tab === id}
            aria-controls="agent-map-panel"
            type="button"
            onClick={() => setTab(id)}
            className={`cursor-pointer border-b-2 pb-2 text-xs capitalize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tab === id ? "border-info text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {id}
          </button>
        ))}
      </div>
      <div
        id="agent-map-panel"
        role="region"
        aria-labelledby={`agent-map-${tab}`}
        className="pt-4 text-sm"
      >
        {tab === "details" ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-words">{metadata.model}</dd>
            <dt className="text-muted-foreground">Effort</dt>
            <dd>{metadata.effort ?? "Not reported"}</dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd>
              {node.agent.startedAt
                ? new Date(node.agent.startedAt).toLocaleString()
                : "Not reported"}
            </dd>
            <dt className="text-muted-foreground">Completed</dt>
            <dd>
              {node.agent.completedAt
                ? new Date(node.agent.completedAt).toLocaleString()
                : "Not completed"}
            </dd>
            {node.agent.phaseTitle ? (
              <>
                <dt className="text-muted-foreground">Phase</dt>
                <dd>{node.agent.phaseTitle}</dd>
              </>
            ) : null}
            {node.agent.usage ? (
              <>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd>{node.agent.usage.totalTokens.toLocaleString()}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Workspace</dt>
            <dd className="break-all">
              {node.thread?.worktreePath ?? "Same as parent or not reported"}
            </dd>
          </dl>
        ) : (
          <div className="max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere leading-relaxed select-text">
            {tab === "prompt"
              ? node.prompt || "Assignment not reported."
              : output || "No output reported yet."}
          </div>
        )}
      </div>
    </section>
  );
}
