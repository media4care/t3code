import type {
  EnvironmentId,
  InsightLoopTicket,
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

/** The linked environments a settings form shows: linked now, or still selected from before. */
export function insightsLinkedEnvironments(
  settings: InsightsSettings,
  linked: ReadonlyMap<EnvironmentId, string>,
): ReadonlyArray<{ environmentId: EnvironmentId; label: string; linked: boolean }> {
  const selected = (settings.linkedProjects ?? []).map((entry) => entry.environmentId);
  return [...new Set([...linked.keys(), ...selected])].map((environmentId) => ({
    environmentId,
    label: linked.get(environmentId) ?? environmentId,
    linked: linked.has(environmentId),
  }));
}

export function linkedInsightsProjectIds(
  settings: InsightsSettings,
  environmentId: EnvironmentId,
): ReadonlyArray<ProjectId> {
  return (
    settings.linkedProjects?.find((entry) => entry.environmentId === environmentId)?.projectIds ??
    []
  );
}

/** Settings with `projectId` in `environmentId` included or not; empty environments drop out. */
export function setLinkedInsightsProject(
  settings: InsightsSettings,
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
  included: boolean,
): InsightsSettings {
  const current = linkedInsightsProjectIds(settings, environmentId);
  const projectIds =
    projectId === null
      ? []
      : included
        ? [...new Set([...current, projectId])]
        : current.filter((id) => id !== projectId);
  const others = (settings.linkedProjects ?? []).filter(
    (entry) => entry.environmentId !== environmentId,
  );
  const linkedProjects = projectIds.length ? [...others, { environmentId, projectIds }] : others;
  const { linkedProjects: _previous, ...rest } = settings;
  return linkedProjects.length ? { ...rest, linkedProjects } : rest;
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

/** The agents-toolkit engineering loop's stages in order; Blocked, Aborted and Done sit beside them. */
export const ENGINEERING_LOOP_STAGES = [
  "Plan",
  "PoC",
  "Delivery plan",
  "Implementation",
  "Testing",
  "Review",
  "QA",
  "Human review",
] as const;

const DAY_MS = 86_400_000;

/** Tickets per stage and per-ticket rows, with ages measured when the report was gathered. */
export function engineeringLoopBoard(tickets: readonly InsightLoopTicket[], asOf: string) {
  const at = Date.parse(asOf);
  const days = (iso: string) => Math.max(0, Math.floor((at - Date.parse(iso)) / DAY_MS));
  const stages: readonly string[] = ENGINEERING_LOOP_STAGES;
  const rows = tickets.map((ticket) => {
    // A ticket can return to a stage after repairs; its time there starts at the latest entry.
    const entered = ticket.stageChanges.findLast((change) => change.stage === ticket.stage)?.at;
    return {
      ...ticket,
      position: stages.indexOf(ticket.stage),
      daysInStage: entered ? days(entered) : null,
      daysSinceUpdate: days(ticket.updatedAt),
    };
  });
  const count = (stage: string) => rows.filter((row) => row.stage === stage).length;
  return {
    stages: ENGINEERING_LOOP_STAGES.map((stage) => ({ stage, count: count(stage) })),
    elsewhere: [...new Set(rows.filter((row) => row.position < 0).map((row) => row.stage))].map(
      (stage) => ({ stage, count: count(stage) }),
    ),
    rows,
  };
}

export const loopDaysLabel = (days: number) =>
  days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
