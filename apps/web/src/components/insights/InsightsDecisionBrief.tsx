import type { EnvironmentId, InsightsReport } from "@t3tools/contracts";
import { CompassIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <CompassIcon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Decision brief</h3>
      </div>
      <p className="mt-2 text-base font-medium">{brief.headline}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        From {report.metrics.runs} sampled runs
        {report.tasks ? ` in ${report.tasks.length} tasks` : ""}. Check each decision's evidence
        before acting.
      </p>
      {brief.decisions.length > 0 && (
        <ol className="mt-4 space-y-4">
          {brief.decisions.map((decision) => (
            <li key={decision.title} className="border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={decision.kind === "briefing" ? "info" : "secondary"} size="sm">
                  {decision.kind === "briefing" ? "Your briefs" : "Toolkit"}
                </Badge>
                <h4 className="text-sm font-medium">{decision.title}</h4>
              </div>
              <p className="mt-2 text-sm">{decision.action}</p>
              <p className="mt-1 text-xs text-muted-foreground">{decision.why}</p>
              {decision.recommendationId && (
                <div className="mt-2">
                  <Button
                    size="compact"
                    variant="outline"
                    onClick={() => onOpenRecommendation(decision.recommendationId!)}
                  >
                    Open recommendation
                  </Button>
                </div>
              )}
              <div className="mt-3">
                <InsightsEvidence
                  environmentId={environmentId}
                  evidence={report.evidence.filter((e) => decision.evidenceIds.includes(e.id))}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
