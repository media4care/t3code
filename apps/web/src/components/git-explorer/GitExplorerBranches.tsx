import { formatGitExplorerSync } from "@t3tools/client-runtime/git-explorer";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerStash,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitForkIcon,
  GlobeIcon,
  HardDriveIcon,
  TagIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { GitExplorerHint } from "./GitExplorerHint";

const ROW_CLASS =
  "relative flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm px-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-primary/8 pointer-coarse:h-7 max-sm:h-9";
const HEADING_CLASS =
  "flex h-6 shrink-0 items-center gap-1.5 px-2 text-2xs font-medium text-muted-foreground";

function BranchSync({ reference }: { reference: GitExplorerRef }) {
  if (reference.upstream === null) {
    return <span className="shrink-0 text-3xs text-muted-foreground">No upstream</span>;
  }
  if (reference.upstreamMissing) {
    return <span className="shrink-0 text-3xs text-warning-foreground">Missing upstream</span>;
  }
  if (reference.ahead === null || reference.behind === null) {
    return <span className="shrink-0 text-3xs text-muted-foreground">Unknown</span>;
  }
  if (reference.ahead === 0 && reference.behind === 0) {
    return <CheckIcon className="size-3 shrink-0 text-success-foreground" aria-hidden />;
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs leading-none tabular-nums">
      {reference.ahead > 0 ? (
        <span className="flex items-center text-primary">
          <ArrowUpIcon className="size-2.5" aria-hidden />
          {reference.ahead}
        </span>
      ) : null}
      {reference.behind > 0 ? (
        <span className="flex items-center text-warning-foreground">
          <ArrowDownIcon className="size-2.5" aria-hidden />
          {reference.behind}
        </span>
      ) : null}
    </span>
  );
}

function ReferenceRow({
  reference,
  label,
  current,
  selected,
  onSelect,
}: {
  reference: GitExplorerRef;
  label: string;
  current: boolean;
  selected: boolean;
  onSelect: (revision: string | null) => void;
}) {
  const description =
    reference.kind === "local"
      ? `${reference.shortName}${current ? " · checked out" : ""} · ${formatGitExplorerSync(reference)}${reference.upstream ? ` · ${reference.upstream}` : ""}`
      : `${reference.shortName} · ${reference.kind === "tag" ? "tag" : "remote-tracking branch"}`;
  const slash = label.lastIndexOf("/");
  return (
    <button
      type="button"
      className={ROW_CLASS}
      onClick={() => onSelect(reference.hash)}
      aria-current={selected ? "true" : undefined}
      aria-label={description}
    >
      {selected ? (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      ) : null}
      <span className="flex w-3 shrink-0 items-center justify-center" aria-hidden>
        {reference.kind === "tag" ? (
          <TagIcon className="size-3 text-info-foreground" />
        ) : current ? (
          <span className="flex size-2.5 items-center justify-center rounded-full ring-1 ring-primary/40 ring-inset">
            <span className="size-1.5 rounded-full bg-primary" />
          </span>
        ) : (
          <span className="size-1 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <GitExplorerHint className="min-w-0 flex-1 truncate" label={description}>
        {slash >= 0 ? (
          <span className="text-muted-foreground">{label.slice(0, slash + 1)}</span>
        ) : null}
        <span className={cn(current && "font-semibold text-primary")}>
          {label.slice(slash + 1)}
        </span>
      </GitExplorerHint>
      {reference.kind === "local" ? <BranchSync reference={reference} /> : null}
    </button>
  );
}

function StashRow({
  stash,
  selected,
  onSelect,
}: {
  stash: GitExplorerStash;
  selected: boolean;
  onSelect: (revision: string | null) => void;
}) {
  const description = `${stash.name} · ${stash.subject} · ${new Date(stash.createdAt).toLocaleString()}`;
  return (
    <button
      type="button"
      className={ROW_CLASS}
      onClick={() => onSelect(stash.hash)}
      aria-current={selected ? "true" : undefined}
      aria-label={description}
    >
      {selected ? (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      ) : null}
      <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <GitExplorerHint className="flex min-w-0 flex-1 items-center gap-1.5" label={description}>
        <span className="shrink-0 rounded-sm bg-accent px-1 font-mono text-3xs leading-4 text-muted-foreground">
          {stash.name.replace(/^stash@\{(\d+)\}$/, "@$1")}
        </span>
        <span className="min-w-0 truncate">{stash.subject}</span>
      </GitExplorerHint>
    </button>
  );
}

export function GitExplorerBranches({
  overview,
  selectedRevision,
  onSelect,
}: {
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null | undefined;
  onSelect: (revision: string | null) => void;
}) {
  const localRefs = overview.refs
    .filter((reference) => reference.kind === "local")
    .toSorted((a, b) =>
      a.shortName === overview.headBranch
        ? -1
        : b.shortName === overview.headBranch
          ? 1
          : a.shortName.localeCompare(b.shortName),
    );
  const tags = overview.refs
    .filter((reference) => reference.kind === "tag")
    .toSorted((a, b) => a.shortName.localeCompare(b.shortName));
  const remoteGroups = new Map<string, GitExplorerRef[]>();
  for (const reference of overview.refs) {
    if (reference.kind !== "remote") continue;
    const prefix = reference.shortName.split("/")[0] ?? reference.shortName;
    const refs = remoteGroups.get(prefix) ?? [];
    refs.push(reference);
    remoteGroups.set(prefix, refs);
  }

  return (
    <nav className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Repository references">
      <div className="flex shrink-0 gap-1 border-b border-border/60 p-1" aria-label="Workspace">
        {[
          {
            label: "History",
            revision: overview.headHash,
            active: selectedRevision !== null,
            Icon: GitForkIcon,
          },
          {
            label: "Changes",
            revision: null,
            active: selectedRevision === null,
            Icon: HardDriveIcon,
          },
        ].map(({ label, revision, active, Icon }) => (
          <button
            key={label}
            type="button"
            disabled={label === "History" && !overview.headHash}
            onClick={() => onSelect(revision)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:h-8 max-sm:h-9",
              active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1.5 py-2">
        <section aria-label="Local branches">
          <h2 className={HEADING_CLASS}>
            <GitBranchIcon className="size-3" aria-hidden />
            Local branches
            <span className="ml-auto font-mono text-3xs tabular-nums">{localRefs.length}</span>
          </h2>
          {localRefs.map((reference) => (
            <ReferenceRow
              key={reference.name}
              reference={reference}
              label={reference.shortName}
              current={reference.shortName === overview.headBranch}
              selected={selectedRevision === reference.hash}
              onSelect={onSelect}
            />
          ))}
          {localRefs.length === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No local branches</p>
          ) : null}
        </section>
        <section aria-label="Remote-tracking branches">
          <h2 className={HEADING_CLASS}>
            <GlobeIcon className="size-3" aria-hidden />
            Remotes
            <span className="ml-auto font-mono text-3xs tabular-nums">{remoteGroups.size}</span>
          </h2>
          {[...remoteGroups].map(([prefix, references]) => (
            <details key={prefix} open className="group/remote">
              <summary className="flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:h-7 max-sm:h-9">
                <ChevronDownIcon
                  className="size-3 shrink-0 -rotate-90 group-open/remote:rotate-0"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">{prefix}</span>
                <span className="font-mono text-3xs tabular-nums text-muted-foreground">
                  {references.length}
                </span>
              </summary>
              <div className="ml-3.5 border-l border-border/70 pl-1">
                {references.map((reference) => (
                  <ReferenceRow
                    key={reference.name}
                    reference={reference}
                    label={reference.shortName.slice(prefix.length + 1) || reference.shortName}
                    current={false}
                    selected={selectedRevision === reference.hash}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </details>
          ))}
          {remoteGroups.size === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No remote-tracking branches</p>
          ) : null}
        </section>
        <section aria-label="Tags">
          <h2 className={HEADING_CLASS}>
            <TagIcon className="size-3" aria-hidden />
            Tags
            <span className="ml-auto font-mono text-3xs tabular-nums">{tags.length}</span>
          </h2>
          {tags.map((reference) => (
            <ReferenceRow
              key={reference.name}
              reference={reference}
              label={reference.shortName}
              current={false}
              selected={selectedRevision === reference.hash}
              onSelect={onSelect}
            />
          ))}
          {tags.length === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No tags</p>
          ) : null}
        </section>
        <section aria-label="Stashes">
          <h2 className={HEADING_CLASS}>
            <ArchiveIcon className="size-3" aria-hidden />
            Stashes
            <span className="ml-auto font-mono text-3xs tabular-nums">
              {overview.stashes.length}
            </span>
          </h2>
          {overview.stashes.map((stash) => (
            <StashRow
              key={stash.name}
              stash={stash}
              selected={selectedRevision === stash.hash}
              onSelect={onSelect}
            />
          ))}
          {overview.stashes.length === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No stashes</p>
          ) : null}
        </section>
      </div>
    </nav>
  );
}
