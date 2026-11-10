import type {
  EnvironmentId,
  InsightEdit,
  InsightRecommendation,
  InsightsReport,
  InsightTask,
  InsightsSettings,
  ModelSelection,
  ProjectId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";

import { resolveProviderInstanceDisplayName } from "./state/providerInstanceDisplay.ts";

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

/** Models a thread applying a recommendation can run on; `default` is the analysis model. */
export function insightsApplyModelChoices(providers: readonly ServerProvider[]) {
  return [
    { key: "default", label: "Analysis model at its default effort", selection: null },
    ...providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.instanceId}/${model.slug}`,
          label: `${resolveProviderInstanceDisplayName(provider)} · ${model.name}`,
          selection: { instanceId: provider.instanceId, model: model.slug },
        })),
      ),
  ];
}

export function setInsightsApplyModel(
  settings: InsightsSettings,
  selection: ModelSelection | null,
): InsightsSettings {
  const { implementationModelSelection: _previous, ...rest } = settings;
  return selection ? { ...rest, implementationModelSelection: selection } : rest;
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
  implemented: "On trial",
  kept: "Kept",
  reverted: "Reverted",
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

const editLines = (text: string) =>
  text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

/** An edit as diff rows: the lines both texts start and end with frame what changes between. */
function insightEditRows(edit: Pick<InsightEdit, "find" | "replace">) {
  const before = editLines(edit.find);
  const after = editLines(edit.replace);
  const shortest = Math.min(before.length, after.length);
  let head = 0;
  while (head < shortest && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < shortest - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
  const rows = (kind: "context" | "remove" | "add", lines: ReadonlyArray<string>) =>
    lines.map((text) => ({ kind, text }));
  return [
    ...rows("context", before.slice(0, head)),
    ...rows("remove", before.slice(head, before.length - tail)),
    ...rows("add", after.slice(head, after.length - tail)),
    ...rows("context", before.slice(before.length - tail)),
  ];
}

/**
 * A recommendation's exact change as diff rows per file. The list's copy carries no edit text, so
 * this is `"loading"` until the full record arrives, and null where prose describes the change.
 */
export function insightChange(
  summary: Pick<InsightRecommendation, "edits">,
  loaded: Pick<InsightRecommendation, "edits"> | null | undefined,
) {
  if (!loaded) return summary.edits ? ("loading" as const) : null;
  if (!loaded.edits?.length) return null;
  return loaded.edits.map((edit) => ({
    file: edit.file,
    created: edit.find === "",
    rows: insightEditRows(edit),
  }));
}

/** The control that starts a recommendation's change, and what it does. */
export const insightStartChange = (exact: boolean) =>
  exact
    ? {
        label: "Open a PR with this change",
        hint: "Starts a thread that applies exactly this edit and opens a pull request for you to review.",
      }
    : {
        label: "Have an agent make this change",
        hint: "Starts a thread that works out the edit from this description and opens a pull request for you to review.",
      };

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
  if (recommendation.status === "implemented" || recommendation.status === "kept")
    return "implemented";
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

/** When the current trial began, its frozen criterion, and how the reviews since assessed it. */
export function insightTrial(
  recommendation: Pick<
    InsightRecommendation,
    "status" | "history" | "assessments" | "trial" | "validation"
  >,
) {
  if (recommendation.status !== "implemented") return null;
  const startedAt =
    recommendation.trial?.startedAt ??
    recommendation.history.findLast(
      (entry, index, history) =>
        entry.status === "implemented" && history[index - 1]?.status !== "implemented",
    )?.at ??
    null;
  return {
    startedAt,
    criterion: recommendation.trial?.validation ?? recommendation.validation,
    assessments: recommendation.assessments.filter(
      (assessment) => startedAt !== null && assessment.createdAt > startedAt,
    ),
  };
}

/** What the reviews since a trial began have found, and what the user can do. */
export function insightTrialSummary(trial: NonNullable<ReturnType<typeof insightTrial>>) {
  const outcomes = trial.assessments.map((entry) => entry.outcome.replaceAll("_", " "));
  return `${
    outcomes.length ? `Reviews since: ${outcomes.join(", ")}.` : "No review has assessed it yet."
  } Keep it once the criterion is met, revise it, or mark it reverted after undoing the change.`;
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

/**
 * The threads a review sampled, from each run's evidence: most recent first, with how many of
 * the review's findings cite them. Recommendations carry their evidence ids even in a snapshot.
 */
/**
 * What a review sampled: one row per task (a root thread with its child threads) when the report
 * measured tasks, else one per thread, with how many findings cite its evidence.
 */
export function reviewedInsightThreads(
  report: Pick<InsightsReport, "evidence" | "wins" | "tasks">,
  recommendations: ReadonlyArray<Pick<InsightRecommendation, "evidenceIds">>,
) {
  const findings = [...report.wins, ...recommendations].map(
    (finding) => new Set(finding.evidenceIds),
  );
  const taskOf = new Map<string, InsightTask>();
  for (const task of report.tasks ?? [])
    for (const threadId of [task.rootThreadId, ...task.threadIds])
      taskOf.set(`${task.environmentId ?? ""}\n${threadId}`, task);
  const threads = new Map<
    string,
    {
      environmentId: EnvironmentId | null;
      threadId: ThreadId;
      projectId: ProjectId;
      title: string;
      runs: number;
      lastActivityAt: string;
      task: InsightTask | null;
      evidenceIds: string[];
    }
  >();
  for (const entry of report.evidence) {
    const task = taskOf.get(`${entry.environmentId ?? ""}\n${entry.threadId}`) ?? null;
    const key = `${entry.environmentId ?? ""}\n${task?.rootThreadId ?? entry.threadId}`;
    const thread = threads.get(key) ?? {
      environmentId: entry.environmentId ?? null,
      threadId: task?.rootThreadId ?? entry.threadId,
      projectId: task?.projectId ?? entry.projectId,
      title: task?.title ?? entry.title,
      runs: task?.runs ?? 0,
      lastActivityAt: task?.lastActivityAt ?? entry.occurredAt,
      task,
      evidenceIds: [],
    };
    thread.evidenceIds.push(entry.id);
    if (!task && entry.kind === "run") thread.runs++;
    if (!task && entry.occurredAt > thread.lastActivityAt) thread.lastActivityAt = entry.occurredAt;
    threads.set(key, thread);
  }
  return [...threads.values()]
    .map(({ evidenceIds, ...thread }) => ({
      ...thread,
      citedBy: findings.filter((ids) => evidenceIds.some((id) => ids.has(id))).length,
    }))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * Failures that keep coming back: across tasks, or repeated within one. Harmless ones and
 * failures that printed no error are left out; they have nothing to act on.
 */
export function recurringInsightFriction(
  report: Pick<InsightsReport, "evidence" | "friction">,
  recommendations: ReadonlyArray<Pick<InsightRecommendation, "id" | "title" | "evidenceIds">>,
) {
  return (report.friction ?? [])
    .filter(
      (cluster) =>
        !cluster.harmless &&
        cluster.signature !== "(no error output)" &&
        (cluster.tasks > 1 || cluster.maxPerTask > 1),
    )
    .slice(0, 6)
    .map((cluster) => {
      const example = report.evidence.find((entry) => entry.id === cluster.evidenceIds[0]);
      return {
        ...cluster,
        recommendation:
          recommendations.find((recommendation) =>
            recommendation.evidenceIds.some((id) => cluster.evidenceIds.includes(id)),
          ) ?? null,
        example: example
          ? { environmentId: example.environmentId ?? null, threadId: example.threadId }
          : null,
      };
    });
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** A task's measures in a line; failures already counted as harmless are left out. */
export const insightTaskMeasures = (task: InsightTask) =>
  [
    count(task.followUps, "follow-up", "follow-ups"),
    task.interrupts ? count(task.interrupts, "interrupt", "interrupts") : null,
    task.agentQuestions ? count(task.agentQuestions, "question", "questions") : null,
    count(task.failedTools - task.harmlessFailures, "failed tool", "failed tools"),
    task.latestRunStatus === "completed" ? null : `last run ${task.latestRunStatus}`,
  ]
    .filter(Boolean)
    .join(" · ");
