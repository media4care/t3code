import type { InsightsMetrics } from "@t3tools/contracts";

export function emptyInsightsMetrics(): InsightsMetrics {
  return {
    runs: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
    active: 0,
    toolFailures: 0,
    humanRequests: 0,
    subagents: 0,
    tokens: 0,
    runsWithTokenUsage: 0,
    activeMilliseconds: 0,
  };
}

export function insightKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

export function evidenceExcerpt(text: string, limit = 2200): string {
  const redacted = text
    .replace(
      /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
      "[redacted credential]",
    )
    .replace(
      /((?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"'}]+/gi,
      "$1[redacted]",
    );
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit)}\n[excerpt truncated]`;
}
