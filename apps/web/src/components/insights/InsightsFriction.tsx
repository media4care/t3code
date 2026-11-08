import { Link } from "@tanstack/react-router";
import type { EnvironmentId, InsightRecommendation, InsightsReport } from "@t3tools/contracts";
import { recurringInsightFriction } from "@t3tools/client-runtime/insights";
import { RepeatIcon } from "lucide-react";

export function InsightsFriction({
  environmentId,
  report,
  recommendations,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  recommendations: readonly InsightRecommendation[];
}) {
  if (!report.friction) return null;
  const clusters = recurringInsightFriction(report, recommendations);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <RepeatIcon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Recurring friction</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Tool failures that came back across tasks or within one, grouped by program, exit code and
        error.
      </p>
      {clusters.length ? (
        <ul className="mt-3 divide-y divide-border">
          {clusters.map((cluster) => (
            <li key={cluster.key} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{cluster.signature}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[
                    `${cluster.family} · exit ${cluster.exitCode ?? "unknown"}`,
                    `${cluster.failures} failures`,
                    cluster.tasks > 1
                      ? `${cluster.tasks} tasks`
                      : `${cluster.maxPerTask} times in one task`,
                  ].join(" · ")}
                </span>
                {cluster.recommendation && (
                  <span className="mt-0.5 block truncate text-xs text-primary">
                    Recommendation: {cluster.recommendation.title}
                  </span>
                )}
              </span>
              {cluster.example && (
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: cluster.example.environmentId ?? environmentId,
                    threadId: cluster.example.threadId,
                  }}
                  className="shrink-0 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Example
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">
          No tool failure recurred in this sample.
        </p>
      )}
    </section>
  );
}
