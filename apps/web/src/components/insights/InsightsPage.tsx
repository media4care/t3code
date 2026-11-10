import { InsightImplementationBadge } from "./InsightImplementationBadge";
import { InsightsChange } from "./InsightsChange";
import { InsightsDashboard } from "./InsightsDashboard";
import { InsightsEvidence } from "./InsightsEvidence";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ArrowLeftIcon, LightbulbIcon, RefreshCwIcon, Settings2Icon } from "lucide-react";
import {
  EnvironmentId,
  ProjectId,
  type InsightRecommendation,
  type InsightStatus,
  type InsightsSettings,
  type InsightsSnapshot,
} from "@t3tools/contracts";
import {
  actionableInsight,
  INSIGHT_IMPLEMENTATION_FILTERS,
  matchesInsightFilter,
  insightImplementationUrl,
  defaultInsightsSettings,
  insightChange,
  insightsApplyModelChoices,
  insightsLinkedEnvironments,
  insightsModelChoices,
  insightStartChange,
  linkedInsightsProjectIds,
  setInsightsApplyModel,
  setLinkedInsightsProject,
  INSIGHT_STATUS_LABELS,
  insightTrial,
  insightTrialSummary,
} from "@t3tools/client-runtime/insights";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  useEnvironmentProviders,
} from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useLinkedEnvironments } from "../../state/peerLinks";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

function Picker({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>{choices.find((item) => item.value === value)?.label ?? label}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function InsightsPage() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId = selected ?? primary ?? environments[0]?.environmentId ?? null;
  const back = useNavigateToMainApp();
  const connected =
    environments.find((environment) => environment.environmentId === environmentId)?.connection
      .phase === "connected";
  return (
    <SidebarInset className="h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to threads"
          onClick={() => {
            void back();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <LightbulbIcon className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Insights</h1>
        <div className="ml-auto">
          <Picker
            label="Environment"
            value={environmentId ?? ""}
            choices={environments.map((environment) => ({
              value: environment.environmentId,
              label: `${environment.label}${environment.connection.phase === "connected" ? "" : " · Offline"}`,
            }))}
            onChange={(id) => setSelected(EnvironmentId.make(id))}
          />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="gap-4">
          {environmentId ? (
            <EnvironmentInsights
              key={environmentId}
              environmentId={environmentId}
              connected={connected}
            />
          ) : (
            <Empty
              title="Connect an environment"
              text="Insights uses the threads and providers on your T3 server."
            />
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-8 py-12 text-center">
      <LightbulbIcon className="mx-auto mb-4 size-8 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function EnvironmentInsights({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const query = useEnvironmentQuery(serverEnvironment.insightsLive({ environmentId, input: {} }));
  const canOperate = useAtomValue(
    serverEnvironment.configureInsights.permissionAtom(environmentId),
  );
  const now = Date.parse(`${useNowMinute()}Z`);
  const [tab, setTab] = useState("review");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [recommendationFilter, setRecommendationFilter] = useState("active");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useAtomCommand(serverEnvironment.runInsights);
  const configure = useAtomCommand(serverEnvironment.configureInsights);
  const snapshot = query.data;
  const configured = snapshot?.settings;
  const active =
    snapshot?.reports.some((report) => report.status === "analyzing") ||
    Boolean(
      snapshot?.latestAnalysis &&
      ["preparing", "queued", "starting", "running", "waiting"].includes(
        snapshot.latestAnalysis.status,
      ),
    );
  const runNow = async () => {
    setBusy(true);
    const result = await run({ environmentId, input: {} });
    if (result._tag === "Success") {
      setSelectedReportId(null);
      setSelectedRecommendationId(null);
      setTab("review");
    }
    query.refresh();
    setBusy(false);
  };
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Workflow overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your agents at a glance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!connected}
                  onClick={query.refresh}
                  aria-label="Reload saved reports"
                />
              }
            >
              <RefreshCwIcon />
            </TooltipTrigger>
            <TooltipPopup>Reload saved reports</TooltipPopup>
          </Tooltip>
          <Button variant="outline" onClick={() => setSettingsOpen(!settingsOpen)}>
            <Settings2Icon />
            Settings
          </Button>
          <Button
            disabled={!configured || !canOperate || !connected || busy || active}
            onClick={() => {
              void runNow();
            }}
          >
            <RefreshCwIcon />
            {busy || active ? "Refreshing insights…" : "Refresh insights"}
          </Button>
        </div>
      </div>
      {!connected && (
        <p role="status" className="rounded-lg border border-border p-4 text-sm">
          This environment is offline. Reconnect to load reports or run an analysis.
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      )}
      {query.isPending && !snapshot && <p role="status">Loading insights…</p>}
      {(settingsOpen || (snapshot && !configured)) && (
        <InsightsSettingsForm
          key={
            configured
              ? `${configured.projectId}:${configured.timeOfDay}:${configured.enabled}`
              : "new"
          }
          environmentId={environmentId}
          initial={configured ?? null}
          disabled={!canOperate || !connected}
          onSaved={() => {
            setSettingsOpen(false);
            query.refresh();
          }}
        />
      )}
      {configured && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="secondary">Astra · Max</Badge>
          <span>
            {snapshot?.schedule?.enabled
              ? `Daily at ${configured.timeOfDay} · server local time`
              : "Daily analysis paused"}
          </span>
          {snapshot?.schedule?.nextRunAt && (
            <span>Next: {new Date(snapshot.schedule.nextRunAt).toLocaleString()}</span>
          )}
          <Button
            size="compact"
            variant="ghost"
            disabled={!canOperate || !connected}
            onClick={() => {
              void configure({
                environmentId,
                input: { ...configured, enabled: !snapshot?.schedule?.enabled },
              });
            }}
          >
            {snapshot?.schedule?.enabled ? "Pause" : "Resume"}
          </Button>
          {snapshot?.schedule?.lastRunError && (
            <span role="alert">{snapshot.schedule.lastRunError}</span>
          )}
        </div>
      )}
      {snapshot?.latestAnalysis && (active || snapshot.latestAnalysis.status === "failed") && (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId: snapshot.latestAnalysis.threadId }}
          className="text-sm text-primary hover:underline"
        >
          Latest analyst thread · {snapshot.latestAnalysis.status}
        </Link>
      )}
      {snapshot && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Insights views">
            {[
              { value: "review", label: "Dashboard" },
              {
                value: "recommendations",
                label: `Recommendations (${snapshot.recommendations.filter((r) => actionableInsight(r, now)).length})`,
              },
              { value: "history", label: "Implementation" },
            ].map((entry) => (
              <Button
                role="tab"
                aria-selected={tab === entry.value}
                variant={tab === entry.value ? "secondary" : "ghost"}
                key={entry.value}
                onClick={() => {
                  setSelectedRecommendationId(null);
                  setRecommendationFilter(entry.value === "history" ? "all" : "active");
                  setTab(entry.value);
                }}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          {tab === "review" ? (
            <DailyReview
              environmentId={environmentId}
              snapshot={snapshot}
              selectedReportId={selectedReportId}
              onSelectReport={setSelectedReportId}
              onOpenRecommendation={(id) => {
                setSelectedRecommendationId(id);
                setTab("recommendations");
              }}
              onOpenHistory={(filter = "all") => {
                setSelectedRecommendationId(null);
                setRecommendationFilter(filter);
                setTab("history");
              }}
            />
          ) : (
            <Recommendations
              key={tab}
              environmentId={environmentId}
              snapshot={snapshot}
              history={tab === "history"}
              initialId={selectedRecommendationId}
              initialFilter={recommendationFilter}
              disabled={!canOperate || !connected}
            />
          )}
        </>
      )}
    </>
  );
}

function InsightsSettingsForm({
  environmentId,
  initial,
  disabled,
  onSaved,
}: {
  environmentId: EnvironmentId;
  initial: InsightsSettings | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const linked = useLinkedEnvironments(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const choices = insightsModelChoices(providers);
  const applyChoices = insightsApplyModelChoices(providers);
  const defaults =
    initial ?? (projects[0] ? defaultInsightsSettings(projects[0].id, providers) : null);
  const [draft, setDraft] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const save = useAtomCommand(serverEnvironment.configureInsights);
  const value = draft ?? defaults;
  if (!value)
    return (
      <Empty
        title="Astra and a project are needed"
        text="Enable your Codex provider with Astra and add a project in this environment. Insights uses Astra at max effort for its daily review."
      />
    );
  const update = (patch: Partial<InsightsSettings>) => setDraft({ ...value, ...patch });
  const submit = async () => {
    setBusy(true);
    const result = await save({ environmentId, input: value });
    if (result._tag === "Success") onSaved();
    setBusy(false);
  };
  return (
    <form
      className="space-y-5 rounded-xl border border-border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h3 className="font-semibold">Daily workflow review</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The selected provider analyzes excerpts from these projects. Each report links back to its
          evidence. A recommendation is applied only when you ask for it, as a pull request.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Analysis project">
          <Picker
            label="Analysis project"
            value={value.projectId}
            choices={projects.map((p) => ({ value: p.id, label: p.title }))}
            onChange={(id) => update({ projectId: ProjectId.make(id) })}
          />
        </Field>
        <Field label="Provider">
          <Picker
            label="Analysis provider"
            value={`${value.modelSelection.instanceId}/${value.modelSelection.model}`}
            choices={choices.map((choice) => ({ value: choice.key, label: choice.label }))}
            onChange={(key) => {
              const choice = choices.find((c) => c.key === key);
              if (choice) update({ modelSelection: choice.selection });
            }}
          />
        </Field>
        <Field label="Model for applying changes">
          <Picker
            label="Model for applying changes"
            value={
              value.implementationModelSelection
                ? `${value.implementationModelSelection.instanceId}/${value.implementationModelSelection.model}`
                : "default"
            }
            choices={applyChoices.map((choice) => ({ value: choice.key, label: choice.label }))}
            onChange={(key) => {
              const choice = applyChoices.find((c) => c.key === key);
              if (choice) setDraft(setInsightsApplyModel(value, choice.selection));
            }}
          />
        </Field>
        <Field label="Daily time (server local time)">
          <Input
            aria-label="Daily analysis time"
            type="time"
            value={value.timeOfDay}
            onChange={(event) => update({ timeOfDay: event.target.value })}
          />
        </Field>
        <Field label="Look back (days)">
          <Input
            aria-label="Lookback days"
            type="number"
            min={1}
            max={90}
            value={value.lookbackDays}
            onChange={(event) => update({ lookbackDays: Number(event.target.value) })}
          />
        </Field>
        <Field label="Maximum runs per analysis">
          <Input
            aria-label="Maximum runs"
            type="number"
            min={10}
            max={200}
            value={value.maxRuns}
            onChange={(event) => update({ maxRuns: Number(event.target.value) })}
          />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Projects to analyze</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.projectIds.length === 0}
            onChange={(event) =>
              update({ projectIds: event.target.checked ? [] : [value.projectId] })
            }
          />
          All projects in this environment
        </label>
        {projects.map((project) => (
          <label key={project.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.projectIds.length === 0 || value.projectIds.includes(project.id)}
              onChange={(event) => {
                const current = value.projectIds.length
                  ? value.projectIds
                  : projects.map((p) => p.id);
                const next = event.target.checked
                  ? [...new Set([...current, project.id])]
                  : current.filter((id) => id !== project.id);
                if (next.length) update({ projectIds: next });
              }}
            />
            {project.title}
          </label>
        ))}
      </fieldset>
      {insightsLinkedEnvironments(value, linked).map((environment) => {
        const selected = linkedInsightsProjectIds(value, environment.environmentId);
        const available = allProjects.filter(
          (project) => project.environmentId === environment.environmentId,
        );
        return (
          <fieldset key={environment.environmentId} className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Projects on {environment.label}</legend>
            {environment.linked && available.length > 0 ? (
              available.map((project) => (
                <label key={project.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(project.id)}
                    onChange={(event) =>
                      setDraft(
                        setLinkedInsightsProject(
                          value,
                          environment.environmentId,
                          project.id,
                          event.target.checked,
                        ),
                      )
                    }
                  />
                  {project.title}
                </label>
              ))
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {environment.linked
                    ? `Connect to ${environment.label} in this app to choose its projects.`
                    : "This environment is no longer linked."}
                  {selected.length > 0 && ` ${selected.length} selected.`}
                </span>
                {selected.length > 0 && (
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() =>
                      setDraft(
                        setLinkedInsightsProject(value, environment.environmentId, null, false),
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
      <p className="text-xs text-muted-foreground">
        The server must be running at the scheduled time. Missed activity remains available for the
        next analysis within the lookback window. Larger batches use more context; remaining work
        carries forward.
      </p>
      <Button type="submit" disabled={disabled || busy}>
        {busy ? "Saving…" : initial ? "Save settings" : "Enable daily insights"}
      </Button>
    </form>
  );
}

function Passage({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text}</p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function DailyReview({
  environmentId,
  snapshot,
  selectedReportId,
  onSelectReport,
  onOpenRecommendation,
  onOpenHistory,
}: {
  environmentId: EnvironmentId;
  snapshot: InsightsSnapshot;
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  onOpenRecommendation: (id: string) => void;
  onOpenHistory: (filter?: string) => void;
}) {
  const summary =
    snapshot.reports.find((report) => report.id === selectedReportId) ?? snapshot.reports[0];
  const detail = useEnvironmentQuery(
    summary ? serverEnvironment.insightReport({ environmentId, input: { id: summary.id } }) : null,
  );
  const loaded = detail.data;
  const report =
    loaded && summary && loaded.id === summary.id && loaded.status === summary.status
      ? loaded
      : summary;
  if (!report)
    return (
      <Empty
        title="Your first review starts here"
        text="Choose Refresh insights to analyze your agent workflows."
      />
    );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Review</span>
          <Picker
            label="Review date"
            value={report.id}
            choices={snapshot.reports.map((r) => ({
              value: r.id,
              label: new Date(r.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
            }))}
            onChange={onSelectReport}
          />
        </div>
        <div className="flex items-center gap-2">
          {report.hasMore && <Badge variant="warning">More activity to review</Badge>}
          <Badge variant={report.status === "failed" ? "error" : "secondary"}>
            {report.status === "completed"
              ? "Review complete"
              : report.status === "analyzing"
                ? "Analyzing"
                : report.status === "empty"
                  ? "No new activity"
                  : "Analysis failed"}
          </Badge>
        </div>
      </div>
      {detail.error && (
        <p role="alert" className="text-sm text-destructive">
          {detail.error}
        </p>
      )}
      <InsightsDashboard
        environmentId={environmentId}
        report={report}
        snapshot={snapshot}
        onOpenRecommendation={onOpenRecommendation}
        onOpenHistory={onOpenHistory}
        onSelectReport={onSelectReport}
      />
    </>
  );
}

function Recommendations({
  environmentId,
  snapshot,
  history,
  initialId,
  initialFilter,
  disabled,
}: {
  environmentId: EnvironmentId;
  snapshot: InsightsSnapshot;
  history: boolean;
  initialId: string | null;
  initialFilter: string;
  disabled: boolean;
}) {
  const now = Date.parse(`${useNowMinute()}Z`);
  const [filter, setFilter] = useState(initialId ? "all" : initialFilter);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const recommendations = snapshot.recommendations
    .filter(
      (r) =>
        matchesInsightFilter(r, filter, now) &&
        `${r.title} ${r.targetFile ?? ""} ${r.category}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .toSorted((a, b) => Number(b.id === initialId) - Number(a.id === initialId));
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-48 flex-1">
          <Input
            aria-label="Search recommendations"
            placeholder="Search recommendations, skills, files…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Picker
          label="Recommendation status"
          value={filter}
          choices={[
            { value: "active", label: "Actionable" },
            { value: "all", label: "All statuses" },
            ...INSIGHT_IMPLEMENTATION_FILTERS,
            ...Object.entries(INSIGHT_STATUS_LABELS)
              .filter(([value]) => value !== "implemented")
              .map(([value, label]) => ({ value, label })),
          ]}
          onChange={setFilter}
        />
      </div>
      {snapshot.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the 250 most recently updated recommendations.
        </p>
      )}
      {recommendations.length === 0 ? (
        <Empty
          title={history ? "Track the changes you make" : "No recommendations here"}
          text={
            history
              ? "Mark a recommendation implemented and record its commit or change reference. Future reviews will assess whether it helped."
              : "Recommendations appear when the evidence supports a useful change. Dismissed and deferred items remain available in the status filter."
          }
        />
      ) : (
        <div className="space-y-3">
          {recommendations.map((r) => (
            <article key={r.id} className="rounded-xl border border-border bg-card">
              <button
                type="button"
                className="w-full space-y-3 p-5 text-left"
                onClick={() => setSelected(selected === r.id ? null : r.id)}
                aria-expanded={selected === r.id}
              >
                <div className="flex flex-wrap gap-2">
                  <InsightImplementationBadge recommendation={r} />
                  <Badge variant="secondary">{r.priority}</Badge>
                  <Badge variant="outline">{r.category}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {INSIGHT_STATUS_LABELS[r.status]} · {r.confidence} confidence · seen in{" "}
                    {r.occurrences} {r.occurrences === 1 ? "report" : "reports"}
                  </span>
                </div>
                <h3 className="font-semibold">{r.title}</h3>
                {r.implementationRef && (
                  <p className="truncate text-xs text-muted-foreground">
                    Change: {r.implementationRef}
                  </p>
                )}
                {r.targetFile && (
                  <p className="truncate font-mono text-xs text-muted-foreground">{r.targetFile}</p>
                )}
              </button>
              {selected === r.id && (
                <RecommendationDetail
                  key={`${r.id}:${r.updatedAt}`}
                  environmentId={environmentId}
                  summary={r}
                  disabled={disabled}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

const weekFromNow = () => new Date(Date.now() + 7 * 86400000).toISOString();

function RecommendationDetail({
  environmentId,
  summary,
  disabled,
}: {
  environmentId: EnvironmentId;
  summary: InsightRecommendation;
  disabled: boolean;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.insightRecommendation({ environmentId, input: { id: summary.id } }),
  );
  const loaded = query.data;
  const recommendation = loaded && loaded.updatedAt === summary.updatedAt ? loaded : summary;
  const update = useAtomCommand(serverEnvironment.updateInsight);
  const implement = useAtomCommand(serverEnvironment.implementInsight);
  const navigate = useNavigate();
  const [note, setNote] = useState(recommendation.note);
  const [reference, setReference] = useState(recommendation.implementationRef ?? "");
  const implementationUrl = insightImplementationUrl(recommendation.implementationRef);
  const trial = insightTrial(recommendation);
  const closed = recommendation.status === "kept" || recommendation.status === "reverted";
  const change = insightChange(summary, loaded);
  const startChange = insightStartChange(change !== null);
  const incidents = recommendation.incidents ?? [];
  const [busy, setBusy] = useState(false);
  const act = async (status: InsightStatus) => {
    setBusy(true);
    await update({
      environmentId,
      input: {
        id: recommendation.id,
        status,
        note,
        implementationRef: reference || null,
        deferredUntil:
          status === "deferred"
            ? recommendation.status === "deferred"
              ? recommendation.deferredUntil
              : weekFromNow()
            : null,
      },
    });
    query.refresh();
    setBusy(false);
  };
  const start = async () => {
    setBusy(true);
    const result = await implement({ environmentId, input: { id: recommendation.id } });
    if (result._tag === "Success")
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
    setBusy(false);
  };
  return (
    <div className="space-y-5 border-t border-border p-5">
      {query.error && <p role="alert">{query.error}</p>}
      <Passage title="What happened" text={recommendation.observation} />
      <Passage title="What changes" text={recommendation.recommendation} />
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Proposed change</h4>
        <InsightsChange change={change} recommendation={recommendation} />
        {recommendation.implementationThreadId ? (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: recommendation.implementationThreadId }}
            className="inline-block text-sm text-primary underline underline-offset-4"
          >
            Open the thread making this change
          </Link>
        ) : (
          !trial &&
          recommendation.status !== "kept" &&
          change !== "loading" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={disabled || busy}
                onClick={() => {
                  void start();
                }}
              >
                {startChange.label}
              </Button>
              <p className="min-w-48 flex-1 text-xs text-muted-foreground">{startChange.hint}</p>
            </div>
          )
        )}
      </section>
      <Passage title="How we'll know it worked" text={recommendation.validation} />
      {recommendation.expectedImpact && (
        <Passage title="Expected impact" text={recommendation.expectedImpact} />
      )}
      <InsightsEvidence environmentId={environmentId} evidence={recommendation.evidence} />
      {incidents.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">
            Came back {incidents.length === 1 ? "once" : `${incidents.length} times`}
          </h4>
          <ul className="space-y-3">
            {incidents.toReversed().map((incident) => (
              <li key={incident.reportId} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {new Date(incident.at).toLocaleDateString()}
                </p>
                <p className="whitespace-pre-wrap text-sm">{incident.text}</p>
                <InsightsEvidence environmentId={environmentId} evidence={incident.evidence} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{trial ? "Trial" : "Implementation"}</h4>
            <InsightImplementationBadge recommendation={recommendation} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(trial
              ? ([
                  ["kept", "Keep"],
                  ["accepted", "Revise"],
                  ["reverted", "Mark reverted"],
                ] as const)
              : closed
                ? recommendation.status === "kept"
                  ? ([["implemented", "Reopen trial"]] as const)
                  : ([["open", "Reopen"]] as const)
                : ([["implemented", "Mark implemented"]] as const)
            ).map(([status, label]) => (
              <Button
                key={status}
                size="sm"
                variant={status === "kept" ? "default" : "outline"}
                disabled={disabled || busy}
                onClick={() => {
                  void act(status);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {trial
            ? `${trial.startedAt ? `On trial since ${new Date(trial.startedAt).toLocaleDateString()}. ` : ""}${insightTrialSummary(trial)}`
            : recommendation.status === "kept"
              ? "Kept after its trial. Reviews no longer assess it."
              : recommendation.status === "reverted"
                ? "Reverted after its trial. Reviews no longer assess it."
                : "Once the change is merged, mark it implemented. Later reviews then check whether it helped."}
        </p>
        {trial && (
          <div>
            <h5 className="text-xs font-medium">Criterion, as agreed when the trial started</h5>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {trial.criterion}
            </p>
          </div>
        )}
        {recommendation.implementationRef ? (
          implementationUrl ? (
            <a
              href={implementationUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="block break-all text-sm text-primary underline underline-offset-4"
            >
              {recommendation.implementationRef}
            </a>
          ) : (
            <p className="break-all font-mono text-xs">{recommendation.implementationRef}</p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">No change reference recorded.</p>
        )}
      </section>
      {recommendation.assessments.map((assessment) => (
        <div key={assessment.reportId} className="space-y-2 rounded-lg bg-muted p-4">
          <Badge variant="secondary">{assessment.outcome.replaceAll("_", " ")}</Badge>
          <p className="text-sm">{assessment.explanation}</p>
          <InsightsEvidence environmentId={environmentId} evidence={assessment.evidence} />
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Decision note">
          <Textarea
            aria-label="Decision note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              trial ? "Why keep, revise, or revert it?" : "Why accept, defer, or dismiss this?"
            }
          />
        </Field>
        <Field label="Implementation reference">
          <Input
            aria-label="Implementation reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Commit SHA, PR URL, or change reference"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            void act(recommendation.status);
          }}
        >
          Save note
        </Button>
        {(trial ? [] : (["accepted", "deferred", "dismissed", "open"] as const))
          .filter((status) => status !== recommendation.status && !(status === "open" && closed))
          .map((status) => (
            <Button
              key={status}
              variant="outline"
              disabled={disabled || busy}
              onClick={() => {
                void act(status);
              }}
            >
              {status === "open"
                ? "Reopen"
                : status === "deferred"
                  ? "Defer 7 days"
                  : status === "dismissed"
                    ? "Dismiss"
                    : "Accept"}
            </Button>
          ))}
      </div>
      {recommendation.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Decision history
          </summary>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {recommendation.history.toReversed().map((entry) => (
              <li key={`${entry.at}:${entry.status}:${entry.note}`}>
                {new Date(entry.at).toLocaleString()} · {INSIGHT_STATUS_LABELS[entry.status]}
                {entry.note ? ` · ${entry.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
