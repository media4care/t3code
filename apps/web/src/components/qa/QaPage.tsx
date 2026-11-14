import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { ArrowLeftIcon, FlaskConicalIcon, PlayIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  QA_CONFIGURATION_EXAMPLE,
  QA_FILTER_OPTIONS,
  QA_GROUP_OPTIONS,
  groupQaSuites,
  qaDashboard,
  qaProjects,
  qaRepositories,
  qaRunDuration,
  qaRunSummary,
  qaRunSource,
  QA_OFF_EVERYWHERE,
  QA_SHARED_RESULTS_NOTICE,
  type QaGrouping,
  type QaResultFilter,
} from "@t3tools/client-runtime/qa";
import { deviceEnvironment } from "../../state/device";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { QaRunBadge, QaSuiteGroup, QaSummary } from "./QaDashboard";
import { QaAutomation } from "./QaAutomation";
import { QaDevicePool, QaSimlockNote } from "./QaDevicePool";
import { QaCheckoutStatus, QaRefComparison, QaRefPicker } from "./QaRefs";
import { QaOutput, QaRunSteps, useQaLiveRun } from "./QaRunProgress";
import { QaTestList } from "./QaTestList";

export function QaPage() {
  const allProjects = useProjects();
  const { environments } = useEnvironments();
  const repositories = qaRepositories(qaProjects(allProjects, environments));
  const [selection, setSelection] = useState<string | null>(null);
  const repository =
    repositories.find((candidate) => candidate.key === selection) ?? repositories[0];
  const project = repository?.project;
  const environment = environments.find(
    (candidate) => candidate.environmentId === project?.environmentId,
  );
  const back = useNavigateToMainApp();
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
        <FlaskConicalIcon className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">QA</h1>
        <div className="ml-auto max-w-[60%]">
          <Select value={repository?.key ?? ""} onValueChange={setSelection}>
            <SelectTrigger aria-label="QA repository">
              <SelectValue>{repository?.title ?? "Select a repository"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {repositories.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.title} ·{" "}
                  {environments.find((e) => e.environmentId === item.project.environmentId)
                    ?.label ?? "Environment"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="gap-6">
          {repository && project ? (
            <ProjectQa
              key={repository.key}
              environmentId={project.environmentId}
              projectId={project.id}
              connected={environment?.connection.phase === "connected"}
              environmentLabel={environment?.label ?? "Environment"}
              simlock={environment?.serverConfig?.settings.qaDeviceSource === "simlock"}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="text-xl font-semibold">Your test suites, in one place</h2>
              <p className="mt-2 text-muted-foreground">
                {allProjects.length > 0
                  ? QA_OFF_EVERYWHERE
                  : "Add a project to see its QA suites and execution history."}
              </p>
            </div>
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}

function ProjectQa({
  environmentId,
  projectId,
  connected,
  environmentLabel,
  simlock,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  connected: boolean;
  environmentLabel: string;
  /** Runs lease their devices from this machine's Simlock instead of using its pool. */
  simlock: boolean;
}) {
  // Null shows the default branch, which only the server knows.
  const [ref, setRef] = useState<string | null>(null);
  const scope = { projectId, ...(ref ? { ref } : {}) };
  const query = useEnvironmentQuery(serverEnvironment.qaLive({ environmentId, input: scope }));
  const deleteCheckout = useAtomCommand(serverEnvironment.deleteQaCheckout);
  const canDeleteCheckout = useAtomValue(
    serverEnvironment.deleteQaCheckout.permissionAtom(environmentId),
  );
  const start = useAtomCommand(serverEnvironment.startQa);
  const startAffected = useAtomCommand(serverEnvironment.startAffectedQa);
  const cancelAffected = useAtomCommand(serverEnvironment.cancelAffectedQa);
  const cancel = useAtomCommand(serverEnvironment.cancelQa);
  const canRun = useAtomValue(serverEnvironment.startQa.permissionAtom(environmentId));
  const pool = useEnvironmentQuery(deviceEnvironment.pool({ environmentId, input: {} }));
  const setDevice = useAtomCommand(serverEnvironment.setQaDevice);
  const canSetDevice = useAtomValue(serverEnvironment.setQaDevice.permissionAtom(environmentId));
  const canRunAffected = useAtomValue(
    serverEnvironment.startAffectedQa.permissionAtom(environmentId),
  );
  const canStopAffected = useAtomValue(
    serverEnvironment.cancelAffectedQa.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<QaGrouping>("component");
  const [filter, setFilter] = useState<QaResultFilter>("all");
  const [search, setSearch] = useState("");
  const snapshot = query.data;
  const running = snapshot?.latestRuns.find((run) => run.status === "running");
  const { entries, counts } = qaDashboard(
    snapshot?.suites ?? [],
    snapshot?.latestRuns ?? [],
    snapshot?.freshness,
  );
  const affectedCount = snapshot?.freshness?.filter((item) => item.needsRun).length ?? 0;
  const groups = groupQaSuites(entries, grouping, search, filter);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const runSuite = async (suiteId: string) => {
    setBusy(true);
    await start({ environmentId, input: { ...scope, suiteId } });
    setBusy(false);
  };
  const cancelRun = async (runId: string) => {
    setBusy(true);
    await cancel({ environmentId, input: { projectId, runId } });
    setBusy(false);
  };
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">Test suites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {environmentLabel}
            {!connected ? " · Offline" : ""}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {snapshot?.workspaceRoot}
          </p>
          {snapshot?.ref && snapshot.checkout ? (
            <div className="mt-2">
              <QaCheckoutStatus
                gitRef={snapshot.ref}
                checkout={snapshot.checkout}
                canDelete={connected && canDeleteCheckout && !running && !snapshot.batchRunning}
                onDelete={() => {
                  void deleteCheckout({ environmentId, input: scope });
                }}
              />
            </div>
          ) : null}
        </div>
        {snapshot?.ref ? (
          <div className="w-56">
            <QaRefPicker
              value={snapshot.ref}
              refs={snapshot.refs ?? []}
              onChange={(next) => {
                setSelectedRun(null);
                setRef(next);
              }}
            />
          </div>
        ) : null}
        <Button
          variant="outline"
          aria-label="Refresh QA"
          disabled={!connected}
          onClick={query.refresh}
        >
          <RefreshCwIcon /> <span className="hidden sm:inline">Refresh QA</span>
        </Button>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : null}
      {snapshot?.configurationError ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {snapshot.configurationError}
        </p>
      ) : null}
      {snapshot?.sharedResults?.enabled ? (
        <p className="text-sm text-muted-foreground">{QA_SHARED_RESULTS_NOTICE}</p>
      ) : null}
      {snapshot?.sharedResults?.warning ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {snapshot.sharedResults.warning}
        </p>
      ) : null}
      {snapshot?.batchError ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          Queued run stopped: {snapshot.batchError}
        </p>
      ) : null}
      {!snapshot && query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading QA…</p>
      ) : null}
      {snapshot &&
      !snapshot.configurationError &&
      snapshot.checkout?.commit !== null &&
      snapshot.suites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6">
          <h3 className="text-lg font-semibold">Add your first suite</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Add a <code>qa.suites</code> section to this project’s <code>t3.json</code>, then
            refresh. Use the commands you already run for unit, integration, Playwright, or Maestro
            tests.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 text-xs">
            {QA_CONFIGURATION_EXAMPLE}
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Set <code>cwd</code> for a subdirectory. For test counts and a saved report, set{" "}
            <code>report: "junit"</code> and configure the command to write JUnit XML to{" "}
            <code>$T3_QA_REPORT_PATH</code>.
          </p>
        </div>
      ) : null}
      {counts.total > 0 ? <QaSummary counts={counts} filter={filter} onFilter={setFilter} /> : null}
      {snapshot?.ref && snapshot.refs ? (
        <QaRefComparison
          refs={snapshot.refs}
          selected={snapshot.ref}
          onSelect={(next) => {
            setSelectedRun(null);
            setRef(next);
          }}
        />
      ) : null}
      {snapshot &&
      snapshot.schedule !== undefined &&
      (counts.total > 0 || snapshot.schedule || snapshot.latestCiRuns?.length) ? (
        <QaAutomation
          environmentId={environmentId}
          projectId={projectId}
          gitRef={snapshot.ref ?? null}
          snapshot={snapshot}
          connected={connected}
          onView={setSelectedRun}
        />
      ) : null}
      {!connected ? null : simlock ? (
        <QaSimlockNote environmentId={environmentId} environmentLabel={environmentLabel} />
      ) : (
        <QaDevicePool environmentId={environmentId} environmentLabel={environmentLabel} />
      )}
      {snapshot?.freshness && counts.total > 0 ? (
        <section
          aria-label="Input freshness"
          className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
        >
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">
              {affectedCount} {affectedCount === 1 ? "suite needs" : "suites need"} a rerun
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Includes changed, expired, unknown, untested, and unsuccessful suites.
              {snapshot.checkedAt
                ? ` Checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}. Refresh after editing files.`
                : ""}
            </p>
            {snapshot.batchRunning ? (
              <p className="mt-2 text-sm">
                {snapshot.queuedSuiteIds?.length ?? 0} queued · Runs continue when you leave QA.
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter(filter === "affected" ? "all" : "affected")}
          >
            {filter === "affected" ? "Show all suites" : "Show affected"}
          </Button>
          {snapshot.batchRunning ? (
            <Button
              variant="outline"
              disabled={!connected || !canStopAffected || busy}
              onClick={() => {
                setBusy(true);
                void cancelAffected({ environmentId, input: scope }).finally(() => setBusy(false));
              }}
            >
              Stop queued run
            </Button>
          ) : (
            <Button
              disabled={!connected || !canRunAffected || busy || !!running || !affectedCount}
              onClick={() => {
                setBusy(true);
                void startAffected({ environmentId, input: scope }).finally(() => setBusy(false));
              }}
            >
              <PlayIcon /> Run affected suites ({affectedCount})
            </Button>
          )}
        </section>
      ) : null}
      {selectedRun ? (
        <RunDetails
          key={selectedRun}
          environmentId={environmentId}
          projectId={projectId}
          gitRef={ref}
          runId={selectedRun}
          supportsTests={snapshot?.testResultsAvailable ?? false}
          onClose={() => setSelectedRun(null)}
        />
      ) : null}
      {counts.total > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search suites"
                placeholder="Search suites, components, or test types…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="w-40">
              <Select
                value={grouping}
                onValueChange={(value) => {
                  if (value) setGrouping(value);
                }}
              >
                <SelectTrigger aria-label="Group suites by">
                  <SelectValue>
                    {QA_GROUP_OPTIONS.find((option) => option.value === grouping)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {QA_GROUP_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="w-44">
              <Select
                value={filter}
                onValueChange={(value) => {
                  if (value) setFilter(value);
                }}
              >
                <SelectTrigger aria-label="Filter suite results">
                  <SelectValue>
                    {QA_FILTER_OPTIONS.find((option) => option.value === filter)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {QA_FILTER_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground" role="status">
              {visibleCount} of {counts.total} suites
            </span>
          </div>
          <div className="grid gap-6">
            {groups.map((group) => (
              <QaSuiteGroup
                key={`${grouping}:${group.label}`}
                environmentId={environmentId}
                projectId={projectId}
                label={group.label}
                entries={group.entries}
                showComponent={grouping !== "component"}
                devices={{
                  projectId,
                  simlock,
                  pool: pool.data?.entries ?? null,
                  selections: snapshot?.deviceSelections ?? [],
                  canChoose: connected && canSetDevice,
                  onChoose: (suiteId, requirement, deviceKey) => {
                    void setDevice({
                      environmentId,
                      input: { ...scope, suiteId, requirement, deviceKey },
                    });
                  },
                }}
                canRun={connected && canRun && !busy && !running && !snapshot?.batchRunning}
                canCancel={connected && canRun && !busy}
                onRun={(suiteId) => {
                  void runSuite(suiteId);
                }}
                onCancel={(runId) => {
                  void cancelRun(runId);
                }}
                onView={setSelectedRun}
              />
            ))}
          </div>
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="font-medium">No suites match these filters</p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {snapshot && snapshot.recentRuns.length > 0 ? (
        <details>
          <summary className="mb-3 cursor-pointer text-sm font-semibold">
            Recent runs{" "}
            <span className="text-sm font-normal text-muted-foreground">· Latest 50</span>
          </summary>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-3">Suite</th>
                  <th className="p-3">Result</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Code at start</th>
                  <th className="p-3">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="p-3">
                      {run.suite.name}
                      <p className="text-xs text-muted-foreground">{qaRunSource(run)}</p>
                    </td>
                    <td className="p-3">
                      <QaRunBadge run={run} />
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap p-3">{qaRunDuration(run)}</td>
                    <td className="p-3 font-mono text-xs">
                      {run.ref ? `${run.ref} · ` : ""}
                      {run.commit?.slice(0, 8) ?? "Unknown"}
                      {run.dirty === true ? " + changes" : ""}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View ${run.suite.name} run`}
                        onClick={() => setSelectedRun(run.id)}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}

function RunDetails({
  environmentId,
  projectId,
  gitRef,
  runId,
  supportsTests,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  gitRef: string | null;
  runId: string;
  supportsTests: boolean;
  onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaDetails({
      environmentId,
      input: { projectId, runId, ...(gitRef ? { ref: gitRef } : {}) },
    }),
  );
  const data = query.data;
  // A run in progress is followed live; its saved details arrive once it ends.
  const live = useQaLiveRun(environmentId, projectId, data?.run);
  const run = live?.run ?? data?.run;
  const output = live ?? data;
  const running = run?.status === "running";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{run?.suite.name ?? "Run details"}</DialogTitle>
          {run ? (
            <div className="flex flex-wrap items-center gap-3">
              <QaRunBadge run={run} />
              <span className="text-sm text-muted-foreground">
                {qaRunDuration(run)} · {qaRunSummary(run)}
              </span>
            </div>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          {query.error ? <p role="alert">{query.error}</p> : null}
          {run && output ? (
            <>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{qaRunSource(run)}</p>
                {run.devices?.length ? (
                  <p className="text-sm">
                    On{" "}
                    {run.devices
                      .map(
                        (device) =>
                          `${device.name} (${device.physical ? "physical" : device.platform === "ios" ? "simulator" : "emulator"}, ${device.deviceId})`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
                {run.repositoryFile ? (
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {run.repositoryFile}
                  </p>
                ) : run.source?.type !== "ci" ? (
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {run.cwd}
                    <br />
                    {run.suite.command}
                  </p>
                ) : run.source.url ? (
                  <a
                    href={run.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary underline"
                  >
                    Open CI run
                  </a>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {run.ref ?? run.branch ?? "No branch recorded"} ·{" "}
                  {run.commit ?? "No Git revision recorded"}
                  {run.dirty ? " · Working directory had uncommitted changes" : ""}
                  {run.exitCode !== null ? ` · Exit ${run.exitCode}` : ""}
                </p>
              </div>
              <QaRunSteps run={run} />
              <details open={running || run.status === "failed" || run.status === "incomplete"}>
                <summary className="cursor-pointer text-sm font-medium">Run output</summary>
                <div className="mt-3 space-y-3">
                  {output.outputTruncated ? (
                    <p className="text-sm text-muted-foreground">
                      Output truncated; showing the most recent output.
                    </p>
                  ) : null}
                  <QaOutput
                    text={output.output}
                    placeholder={running ? "Waiting for output…" : "No output captured."}
                  />
                  {/* A server from before runs were streamed sends output only when asked. */}
                  {running && !live ? (
                    <Button variant="outline" size="sm" onClick={query.refresh}>
                      Refresh output
                    </Button>
                  ) : null}
                </div>
              </details>
              {run.note ? <p className="text-sm">{run.note}</p> : null}
              {supportsTests ? (
                <QaTestList
                  environmentId={environmentId}
                  projectId={projectId}
                  gitRef={gitRef}
                  runId={runId}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Update this environment’s server to view individual test results.
                </p>
              )}
              {data?.reportXml ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Saved JUnit report
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs">
                    {data.reportXml}
                  </pre>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading run…</p>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
