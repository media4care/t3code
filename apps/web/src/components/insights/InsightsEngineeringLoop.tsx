import { Link } from "@tanstack/react-router";
import type { EnvironmentId, InsightLoopTicket } from "@t3tools/contracts";
import {
  ENGINEERING_LOOP_STAGES,
  engineeringLoopBoard,
  loopDaysLabel,
} from "@t3tools/client-runtime/insights";
import { RouteIcon } from "lucide-react";

export function InsightsEngineeringLoop({
  environmentId,
  tickets,
  asOf,
}: {
  environmentId: EnvironmentId;
  tickets: readonly InsightLoopTicket[];
  asOf: string;
}) {
  const board = engineeringLoopBoard(tickets, asOf);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RouteIcon className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Engineering loop</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {board.rows.length} {board.rows.length === 1 ? "ticket" : "tickets"} · as of this review
        </span>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-y-3 sm:grid-cols-8">
        {board.stages.map(({ stage, count }) => (
          <li
            key={stage}
            aria-label={`${stage}: ${count}`}
            className="flex flex-col items-center gap-1.5 text-center"
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${count ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
            >
              {count}
            </span>
            <span
              className={`text-2xs leading-tight ${count ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {stage}
            </span>
          </li>
        ))}
      </ol>
      {board.elsewhere.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {board.elsewhere.map((entry) => `${entry.stage} ${entry.count}`).join(" · ")}
        </p>
      )}
      <ul className="mt-4 divide-y divide-border border-t border-border">
        {board.rows.map((row) => {
          const position = row.stage === "Done" ? ENGINEERING_LOOP_STAGES.length : row.position;
          const name = (
            <>
              <span className="font-semibold">{row.ticket}</span> {row.title}
            </>
          );
          return (
            <li
              key={`${row.environmentId ?? ""}/${row.ticket}`}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">
                  {row.threadId ? (
                    <Link
                      to="/$environmentId/$threadId"
                      params={{
                        environmentId: row.environmentId ?? environmentId,
                        threadId: row.threadId,
                      }}
                      className="hover:text-primary hover:underline hover:underline-offset-4"
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </p>
                {row.next && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    Next: {row.next}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 sm:contents">
                <div className="w-32 shrink-0">
                  <div className="flex gap-0.5" aria-hidden>
                    {ENGINEERING_LOOP_STAGES.map((stage, index) => (
                      <span
                        key={stage}
                        className={`h-1.5 flex-1 rounded-full ${index < position ? "bg-primary/45" : index === position ? "bg-primary" : "bg-muted"}`}
                      />
                    ))}
                  </div>
                  <p
                    className={`mt-1 text-2xs ${row.position < 0 && row.stage !== "Done" ? "text-warning-foreground" : "text-muted-foreground"}`}
                  >
                    {row.stage}
                    {row.daysInStage !== null && ` · ${loopDaysLabel(row.daysInStage)}`}
                  </p>
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {row.daysSinceUpdate === 0
                    ? "today"
                    : `${loopDaysLabel(row.daysSinceUpdate)} ago`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        From each ticket's <code>.agent-work/&lt;ticket&gt;/engineering-loop.md</code> worksheet.
        Time in a stage needs the worksheet's timestamped stage lines.
      </p>
    </section>
  );
}
