import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowRightIcon,
  ChartNoAxesColumnIncreasingIcon,
  CheckIcon,
  ChevronRightIcon,
  CoinsIcon,
  FileTextIcon,
  LightbulbIcon,
  MessageCircleQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { EnvironmentId, InsightsReport, InsightsSnapshot } from "@t3tools/contracts";
import { INSIGHT_STATUS_LABELS } from "@t3tools/client-runtime/insights";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InsightsEvidence } from "./InsightsEvidence";

const OUTCOMES = [
  { key: "completed", label: "Completed", color: "text-success-foreground" },
  { key: "failed", label: "Failed", color: "text-destructive-foreground" },
  { key: "interrupted", label: "Interrupted", color: "text-warning-foreground" },
  { key: "active", label: "Active", color: "text-primary" },
] as const;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function InsightsDashboard({
  environmentId,
  report,
  snapshot,
  onOpenRecommendation,
  onOpenHistory,
  onSelectReport,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  snapshot: InsightsSnapshot;
  onOpenRecommendation: (id: string) => void;
  onOpenHistory: () => void;
  onSelectReport: (id: string) => void;
}) {
  const { metrics } = report;
  const recommendations = snapshot.recommendations
    .filter((r) => report.recommendationIds.includes(r.id))
    .toSorted((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const outcomes = OUTCOMES.map((entry) => ({ ...entry, value: metrics[entry.key] }));
  const counts = Object.entries(INSIGHT_STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    value: snapshot.recommendations.filter((r) => r.status === status).length,
  }));
  const recent = snapshot.reports
    .filter((r) => r.scopeKey === report.scopeKey && ["completed", "empty"].includes(r.status))
    .slice(0, 14)
    .toReversed();
  const maxRuns = Math.max(1, ...recent.map((r) => r.metrics.runs));
  const compactNumber = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Runs reviewed",
            value: metrics.runs,
            hint: "This review",
            icon: ActivityIcon,
            color: "text-primary bg-primary/8",
          },
          {
            label: "Tool failures",
            value: metrics.toolFailures,
            hint: "Reported by tools",
            icon: TriangleAlertIcon,
            color: "text-warning-foreground bg-warning/8",
          },
          {
            label: "Human requests",
            value: metrics.humanRequests,
            hint: "Questions & approvals",
            icon: MessageCircleQuestionIcon,
            color: "text-info-foreground bg-info/8",
          },
          {
            label: "Recorded tokens",
            value: metrics.runsWithTokenUsage ? compactNumber.format(metrics.tokens) : "N/A",
            hint: metrics.runsWithTokenUsage
              ? `${metrics.runsWithTokenUsage}/${metrics.runs} runs have usage`
              : "No usage recorded",
            icon: CoinsIcon,
            color: "text-muted-foreground bg-muted",
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
              <span className={`rounded-lg p-2 ${metric.color}`}>
                <metric.icon className="size-4" aria-hidden />
              </span>
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
              {metric.value}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Run outcomes</h3>
          <div className="mt-5 flex flex-wrap items-center justify-around gap-5">
            <div
              className="relative size-36 shrink-0"
              role="img"
              aria-label={outcomes
                .map((entry) => `${entry.value} ${entry.label.toLowerCase()}`)
                .join(", ")}
            >
              <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  strokeWidth="10"
                  className="stroke-muted"
                />
                {outcomes.map((entry, index) => (
                  <circle
                    key={entry.key}
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    strokeWidth="10"
                    pathLength="100"
                    stroke="currentColor"
                    className={entry.color}
                    strokeDasharray={`${(entry.value / Math.max(1, metrics.runs)) * 100} 100`}
                    strokeDashoffset={
                      (-outcomes.slice(0, index).reduce((total, item) => total + item.value, 0) /
                        Math.max(1, metrics.runs)) *
                      100
                    }
                  />
                ))}
              </svg>
              <div
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                aria-hidden
              >
                <span className="text-3xl font-semibold tabular-nums">{metrics.runs}</span>
                <span className="text-xs text-muted-foreground">sampled runs</span>
              </div>
            </div>
            <dl className="min-w-32 flex-1 space-y-3">
              {outcomes.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-6 text-sm">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <span className={`size-2 rounded-full bg-current ${entry.color}`} />
                    {entry.label}
                  </dt>
                  <dd className="font-medium tabular-nums">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
            {metrics.subagents} subagent runs · Completion does not imply verified success.
          </p>
        </section>

        <section className="flex flex-col rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Recommended changes</h3>
            <Badge variant="secondary">{report.recommendationIds.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">From this review</p>
          {recommendations.length ? (
            <div className="mt-3 divide-y divide-border">
              {recommendations.slice(0, 3).map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => onOpenRecommendation(r.id)}
                  className="group flex w-full items-center gap-3 rounded-lg py-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block line-clamp-2 text-sm font-medium group-hover:text-primary">
                      {r.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={r.priority === "high" ? "warning" : "secondary"}>
                        {r.priority}
                      </Badge>
                      {r.category} · {INSIGHT_STATUS_LABELS[r.status]}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
              {recommendations.length > 3 && (
                <p className="pt-3 text-xs text-muted-foreground">
                  {recommendations.length - 3} more in Recommendations
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <span className="mb-1 rounded-2xl bg-primary/8 p-3">
                <LightbulbIcon className="size-6 text-primary" aria-hidden />
              </span>
              <p className="text-sm font-medium">
                {report.status === "analyzing"
                  ? "Review in progress"
                  : report.recommendationIds.length
                    ? "Older recommendations"
                    : "No changes proposed"}
              </p>
              <p className="max-w-64 text-xs text-muted-foreground">
                {report.status === "analyzing"
                  ? "Recommendations will appear here."
                  : "Open the analysis for context and limitations."}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">What worked well</h3>
            <Badge variant="success">{report.wins.length}</Badge>
          </div>
          {report.wins.length ? (
            report.wins.map((win) => (
              <details key={win.text} className="group border-b border-border py-3 last:border-0">
                <summary className="flex cursor-pointer list-none items-start gap-3 rounded focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <CheckIcon
                    className="mt-0.5 size-4 shrink-0 text-success-foreground"
                    aria-hidden
                  />
                  <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-relaxed group-open:hidden">
                    {win.text}
                  </span>
                  <span className="hidden flex-1 text-sm font-medium group-open:block">
                    Finding details
                  </span>
                  <ChevronRightIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open:rotate-90"
                    aria-hidden
                  />
                </summary>
                <div className="mt-3 space-y-3 pl-7">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {win.text}
                  </p>
                  <InsightsEvidence
                    environmentId={environmentId}
                    evidence={report.evidence.filter((e) => win.evidenceIds.includes(e.id))}
                  />
                </div>
              </details>
            ))
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No supported findings yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Improvement tracking</h3>
            <Button size="compact" variant="ghost" onClick={onOpenHistory}>
              History
              <ArrowRightIcon />
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {snapshot.truncated ? "Latest 250 recommendations" : "Across all reviews"}
          </p>
          <div className="mt-4 space-y-3">
            {counts.map((entry) => (
              <div key={entry.status} className="flex items-center gap-3 text-xs">
                <span className="w-20 text-muted-foreground">{entry.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={`h-full rounded-full ${entry.status === "implemented" ? "bg-success" : entry.status === "dismissed" ? "bg-muted-foreground/40" : "bg-primary/70"}`}
                    style={{
                      width: `${(entry.value / Math.max(1, snapshot.recommendations.length)) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-6 text-right font-medium tabular-nums">{entry.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {recent.length > 1 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ChartNoAxesColumnIncreasingIcon className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Review activity</h3>
          </div>
          <div
            className="mt-5 flex h-24 items-end gap-2"
            aria-label="Runs sampled per review, oldest to newest"
          >
            {recent.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectReport(entry.id)}
                aria-label={`${new Date(entry.createdAt).toLocaleString()}: ${entry.metrics.runs} runs. Open review.`}
                aria-pressed={entry.id === report.id}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 rounded focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="text-xs tabular-nums text-muted-foreground">
                  {entry.metrics.runs}
                </span>
                <span
                  className={`w-full rounded-t ${entry.id === report.id ? "bg-primary" : "bg-primary/30 hover:bg-primary/50"}`}
                  style={{
                    height: `${(entry.metrics.runs / maxRuns) * 75}%`,
                    minHeight: entry.metrics.runs ? 3 : 0,
                  }}
                />
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{new Date(recent[0]!.createdAt).toLocaleDateString()}</span>
            <span>Runs sampled per review</span>
            <span>{new Date(recent[recent.length - 1]!.createdAt).toLocaleDateString()}</span>
          </div>
        </section>
      )}

      <details
        key={report.id}
        className="group rounded-xl border border-border bg-card"
        open={report.status === "failed" ? true : undefined}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Analysis & evidence</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Full report · {report.evidence.length} sources · {report.limitations.length}{" "}
              limitations
            </span>
          </span>
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
            aria-hidden
          />
        </summary>
        <div className="space-y-5 border-t border-border p-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {report.summary}
          </p>
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: report.threadId }}
            className="inline-block text-sm text-primary underline underline-offset-4"
          >
            Open analysis thread
          </Link>
          <InsightsEvidence environmentId={environmentId} evidence={report.evidence} />
          <section className="space-y-2 text-xs text-muted-foreground">
            <h4 className="font-medium text-foreground">Coverage & limitations</h4>
            <p>
              Sampled activity, including child runs. Token coverage: {metrics.runsWithTokenUsage}/
              {metrics.runs} runs. Failures and requests are signals to investigate, not quality
              scores. A run can appear in more than one review.
            </p>
            {report.hasMore && <p>More activity remains for the next review.</p>}
            <ul className="list-disc space-y-2 pl-4">
              {report.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}
