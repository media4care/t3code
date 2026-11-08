import { Link } from "@tanstack/react-router";
import type { EnvironmentId, InsightRecommendation, InsightsReport } from "@t3tools/contracts";
import { reviewedInsightThreads } from "@t3tools/client-runtime/insights";
import { MessagesSquareIcon } from "lucide-react";
import { useState } from "react";
import { useProjects } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const INITIAL_ROWS = 8;

export function InsightsReviewedThreads({
  environmentId,
  report,
  recommendations,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  recommendations: readonly InsightRecommendation[];
}) {
  const [expanded, setExpanded] = useState(false);
  const projects = useProjects();
  const threads = reviewedInsightThreads(report, recommendations);
  if (!threads.length) return null;
  const shown = expanded ? threads : threads.slice(0, INITIAL_ROWS);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessagesSquareIcon className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Threads sampled</h3>
        </div>
        <Badge variant="secondary">{threads.length}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        The threads whose runs this review sampled, most recent first.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {shown.map((thread) => {
          const threadEnvironmentId = thread.environmentId ?? environmentId;
          const project = projects.find(
            (entry) => entry.environmentId === threadEnvironmentId && entry.id === thread.projectId,
          )?.title;
          const machine = thread.environmentId
            ? report.linked?.find((entry) => entry.environmentId === thread.environmentId)?.label
            : undefined;
          return (
            <li key={`${threadEnvironmentId}/${thread.threadId}`}>
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: threadEnvironmentId, threadId: thread.threadId }}
                className="group flex items-center gap-3 rounded-md py-2.5 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm group-hover:text-primary">
                    {thread.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[
                      machine,
                      project,
                      `${thread.runs} ${thread.runs === 1 ? "run" : "runs"}`,
                      new Date(thread.lastActivityAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {thread.citedBy > 0 && (
                  <Badge variant="info" size="sm">
                    Cited by {thread.citedBy} {thread.citedBy === 1 ? "finding" : "findings"}
                  </Badge>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {threads.length > INITIAL_ROWS && (
        <Button size="compact" variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${threads.length}`}
        </Button>
      )}
    </section>
  );
}
