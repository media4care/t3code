import type {
  InsightRecommendation,
  InsightsSettings,
  ProjectId,
  ServerProvider,
} from "@t3tools/contracts";

export function insightsModelChoices(providers: readonly ServerProvider[]) {
  return providers
    .filter((provider) => provider.driver === "codex" && provider.enabled)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.slug.includes("astra"))
        .map((model) => ({
          key: `${provider.instanceId}/${model.slug}`,
          label: `${provider.displayName ?? "Codex"} · ${model.name} · Max`,
          selection: {
            instanceId: provider.instanceId,
            model: model.slug,
            options: [{ id: "reasoningEffort", value: "max" }],
          },
        })),
    );
}

export function defaultInsightsSettings(
  projectId: ProjectId,
  providers: readonly ServerProvider[],
): InsightsSettings | null {
  const model = insightsModelChoices(providers)[0];
  return model
    ? {
        enabled: true,
        projectId,
        projectIds: [],
        modelSelection: model.selection,
        timeOfDay: "09:00",
        lookbackDays: 30,
        maxRuns: 60,
      }
    : null;
}

export const INSIGHT_STATUS_LABELS = {
  open: "Open",
  accepted: "Accepted",
  deferred: "Deferred",
  dismissed: "Dismissed",
  implemented: "Implemented",
} as const;

export function actionableInsight(
  recommendation: Pick<InsightRecommendation, "status" | "deferredUntil">,
  now: number,
) {
  return (
    recommendation.status === "open" ||
    recommendation.status === "accepted" ||
    (recommendation.status === "deferred" &&
      recommendation.deferredUntil !== null &&
      Date.parse(recommendation.deferredUntil) <= now)
  );
}

export const INSIGHT_IMPLEMENTATION_LABELS = {
  not_implemented: "Not implemented",
  started: "Started",
  implemented: "Implemented",
} as const;

export const INSIGHT_IMPLEMENTATION_FILTERS = Object.entries(INSIGHT_IMPLEMENTATION_LABELS).map(
  ([status, label]) => ({ value: `implementation:${status}`, label }),
);

export function insightImplementationStatus(
  recommendation: Pick<InsightRecommendation, "status" | "implementationThreadId">,
) {
  if (recommendation.status === "implemented") return "implemented";
  if (recommendation.status === "accepted" && recommendation.implementationThreadId)
    return "started";
  return "not_implemented";
}

export function matchesInsightFilter(
  recommendation: Pick<
    InsightRecommendation,
    "status" | "deferredUntil" | "implementationThreadId"
  >,
  filter: string,
  now: number,
) {
  if (filter === "all") return true;
  if (filter === "active") return actionableInsight(recommendation, now);
  if (filter.startsWith("implementation:")) {
    return insightImplementationStatus(recommendation) === filter.slice("implementation:".length);
  }
  return recommendation.status === filter;
}

export function insightImplementationUrl(reference: string | null) {
  if (!reference) return null;
  try {
    const url = new URL(reference);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
