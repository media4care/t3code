import type { EnvironmentId, InsightDecision, InsightsReport } from "@t3tools/contracts";
import { ChevronRightIcon, CompassIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { InsightsEvidence } from "./InsightsEvidence";

export function InsightsDecisionBrief({
  environmentId,
  report,
  onOpenRecommendation,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  onOpenRecommendation: (id: string) => void;
}) {
  const { brief } = report;
  if (!brief) return null;
  const count = brief.decisions.length;
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <CompassIcon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Decision brief</h3>
      </div>
      <p className="mt-2 text-base font-medium">{brief.headline}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        From {report.metrics.runs} sampled runs
        {report.tasks ? ` in ${report.tasks.length} tasks` : ""}.
      </p>
      {count > 0 && (
        <>
          <p className="mt-4 border-t border-border pt-4 text-xs font-medium text-muted-foreground">
            {count === 1 ? "1 decision" : `${count} decisions`} behind this · check the evidence
            before acting
          </p>
          <ol className="mt-3 space-y-3">
            {brief.decisions.map((decision, index) => (
              <li key={decision.title} className="flex gap-3 rounded-lg border border-border p-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <DecisionSummary
                    decision={decision}
                    onOpenRecommendation={onOpenRecommendation}
                  />
                  <div className="mt-3">
                    <InsightsEvidence
                      environmentId={environmentId}
                      evidence={report.evidence.filter((e) => decision.evidenceIds.includes(e.id))}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function DecisionSummary({
  decision,
  onOpenRecommendation,
}: {
  decision: InsightDecision;
  onOpenRecommendation: (id: string) => void;
}) {
  const body = (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant={decision.kind === "briefing" ? "info" : "secondary"} size="sm">
          {decision.kind === "briefing" ? "Your briefs" : "Toolkit"}
        </Badge>
        <span className="text-sm font-medium group-hover:text-primary">{decision.title}</span>
      </span>
      <span className="mt-2 block text-sm">{decision.action}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{decision.why}</span>
    </span>
  );
  const recommendationId = decision.recommendationId;
  if (!recommendationId) return <div className="flex">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpenRecommendation(recommendationId)}
      className="group flex w-full items-start gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
    >
      {body}
      <span className="sr-only">Open recommendation</span>
      <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
