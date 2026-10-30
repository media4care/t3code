import { Link } from "@tanstack/react-router";
import type { EnvironmentId, InsightEvidence } from "@t3tools/contracts";

export function InsightsEvidence({
  environmentId,
  evidence,
}: {
  environmentId: EnvironmentId;
  evidence: readonly InsightEvidence[];
}) {
  if (!evidence.length) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">Evidence ({evidence.length})</summary>
      <div className="mt-3 space-y-3">
        {evidence.map((item) => (
          <div key={item.id} className="rounded-lg border border-border p-3">
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: item.threadId }}
              className="text-sm text-primary underline underline-offset-4"
            >
              {item.title}
            </Link>
            <p className="mt-1 break-all font-mono text-3xs text-muted-foreground">
              {item.kind} · {item.itemId ?? item.runId}
            </p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {item.text}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
