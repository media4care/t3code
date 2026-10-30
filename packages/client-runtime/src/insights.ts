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

export function actionableInsight(recommendation: InsightRecommendation, now: number) {
  return (
    recommendation.status === "open" ||
    recommendation.status === "accepted" ||
    (recommendation.status === "deferred" &&
      recommendation.deferredUntil !== null &&
      Date.parse(recommendation.deferredUntil) <= now)
  );
}
