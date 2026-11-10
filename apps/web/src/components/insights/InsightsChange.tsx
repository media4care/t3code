import type { insightChange } from "@t3tools/client-runtime/insights";
import type { InsightRecommendation } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";

const MARKS = { add: "+", remove: "−", context: "" } as const;

/** A recommendation's change: its exact diff where it has one, else the prose describing it. */
export function InsightsChange({
  change,
  recommendation,
}: {
  change: ReturnType<typeof insightChange>;
  recommendation: Pick<InsightRecommendation, "suggestedChange" | "targetFile">;
}) {
  if (change === "loading")
    return <p className="text-sm text-muted-foreground">Loading the change…</p>;
  if (change === null)
    return (
      <div className="space-y-2">
        {recommendation.suggestedChange && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {recommendation.suggestedChange}
          </p>
        )}
        {recommendation.targetFile && (
          <p className="break-all font-mono text-xs text-muted-foreground">
            {recommendation.targetFile}
          </p>
        )}
      </div>
    );
  return (
    <div className="space-y-3">
      {change.map((file, position) => (
        // oxlint-disable-next-line react/no-array-index-key -- one file can have several edits
        <figure key={position} className="overflow-hidden rounded-lg border border-border">
          <figcaption className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <span className="min-w-0 break-all font-mono text-xs">{file.file}</span>
            {file.created && (
              <Badge variant="secondary" size="sm">
                New file
              </Badge>
            )}
          </figcaption>
          <div className="py-1 font-mono text-xs leading-5">
            {file.rows.map((row, line) => {
              const Row = row.kind === "add" ? "ins" : row.kind === "remove" ? "del" : "div";
              return (
                <Row
                  // oxlint-disable-next-line react/no-array-index-key -- lines repeat and hold no state
                  key={line}
                  className={cn(
                    "flex min-h-5 no-underline",
                    row.kind === "add" && "bg-diff-addition/10",
                    row.kind === "remove" && "bg-diff-deletion/10",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "w-6 shrink-0 select-none text-center",
                      row.kind === "add" && "text-diff-addition-foreground",
                      row.kind === "remove" && "text-diff-deletion-foreground",
                    )}
                  >
                    {MARKS[row.kind]}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words pr-3">{row.text}</span>
                </Row>
              );
            })}
          </div>
        </figure>
      ))}
    </div>
  );
}
