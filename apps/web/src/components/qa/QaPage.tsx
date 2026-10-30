import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { ArrowLeftIcon, FlaskConicalIcon, PlayIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import type { EnvironmentId, ProjectId, QaRun } from "@t3tools/contracts";
import {
  QA_CONFIGURATION_EXAMPLE,
  qaStatusLabel,
  qaRunDuration,
  qaRunSummary,
} from "@t3tools/client-runtime/qa";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function QaPage() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<string | null>(null);
  const key = (project: (typeof projects)[number]) => `${project.environmentId}:${project.id}`;
  const project = projects.find((candidate) => key(candidate) === selection) ?? projects[0];
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
          <Select value={project ? key(project) : ""} onValueChange={setSelection}>
            <SelectTrigger aria-label="QA project">
              <SelectValue>{project?.title ?? "Select a project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((item) => (
                <SelectItem key={key(item)} value={key(item)}>
                  {item.title} ·{" "}
                  {environments.find((e) => e.environmentId === item.environmentId)?.label ??
                    "Environment"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="gap-6">
          {project ? (
            <ProjectQa
              key={key(project)}
              environmentId={project.environmentId}
              projectId={project.id}
              connected={environment?.connection.phase === "connected"}
              environmentLabel={environment?.label ?? "Environment"}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="text-xl font-semibold">Your test suites, in one place</h2>
              <p className="mt-2 text-muted-foreground">
                Add a project to see its QA suites and execution history.
              </p>
            </div>
          )}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}

function RunBadge({ run }: { run: QaRun | undefined }) {
  return (
    <Badge
      variant={
        run?.status === "passed"
          ? "success"
          : run?.status === "failed"
            ? "error"
            : run?.status === "running"
              ? "info"
              : "secondary"
      }
    >
      {qaStatusLabel(run)}
    </Badge>
  );
}

function ProjectQa({
  environmentId,
  projectId,
  connected,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  connected: boolean;
  environmentLabel: string;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaLive({ environmentId, input: { projectId } }),
  );
  const start = useAtomCommand(serverEnvironment.startQa);
  const cancel = useAtomCommand(serverEnvironment.cancelQa);
  const canRun = useAtomValue(serverEnvironment.startQa.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const snapshot = query.data;
  const running = snapshot?.latestRuns.find((run) => run.status === "running");
  const latest = new Map(snapshot?.latestRuns.map((run) => [run.suite.id, run]));
  const runSuite = async (suiteId: string) => {
    setBusy(true);
    const result = await start({ environmentId, input: { projectId, suiteId } });
    if (result._tag === "Success") setSelectedRun(result.value.id);
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
        <div>
          <h2 className="text-2xl font-semibold">Test suites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {environmentLabel}
            {!connected ? " · Offline" : ""}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {snapshot?.workspaceRoot}
          </p>
        </div>
        <Button variant="outline" disabled={!connected} onClick={query.refresh}>
          <RefreshCwIcon /> Refresh catalog
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
      {!snapshot && query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading QA…</p>
      ) : null}
      {snapshot && !snapshot.configurationError && snapshot.suites.length === 0 ? (
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
      <div className="grid gap-3">
        {snapshot?.suites.map((suite) => {
          const run = latest.get(suite.id);
          return (
            <section
              key={suite.id}
              aria-label={suite.name}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-semibold">{suite.name}</h3>
                  <RunBadge run={run} />
                </div>
                <div className="flex items-center gap-2">
                  {run ? (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedRun(run.id)}>
                      View run
                    </Button>
                  ) : null}
                  {run?.status === "running" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!connected || !canRun || busy}
                      onClick={() => {
                        void cancelRun(run.id);
                      }}
                    >
                      <SquareIcon /> Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!connected || !canRun || busy || !!running}
                      onClick={() => {
                        void runSuite(suite.id);
                      }}
                    >
                      <PlayIcon /> Run
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                {suite.cwd ? `${suite.cwd} › ` : ""}
                {suite.command}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {run
                  ? `Last run ${new Date(run.startedAt).toLocaleString()} · ${qaRunDuration(run)} · ${qaRunSummary(run)}`
                  : "This suite has not been run through QA yet."}
              </p>
              {run?.note ? <p className="mt-2 text-sm text-muted-foreground">{run.note}</p> : null}
            </section>
          );
        })}
      </div>
      {running ? (
        <p className="text-sm text-muted-foreground">
          One suite runs at a time in this project to avoid sharing a test database or device
          concurrently.
        </p>
      ) : null}
      {selectedRun ? (
        <RunDetails
          key={selectedRun}
          environmentId={environmentId}
          projectId={projectId}
          runId={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      ) : null}
      {snapshot && snapshot.recentRuns.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Recent runs{" "}
            <span className="text-sm font-normal text-muted-foreground">· Latest 50</span>
          </h2>
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
                    <td className="p-3">{run.suite.name}</td>
                    <td className="p-3">
                      <RunBadge run={run} />
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap p-3">{qaRunDuration(run)}</td>
                    <td className="p-3 font-mono text-xs">
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
        </section>
      ) : null}
    </>
  );
}

function RunDetails({
  environmentId,
  projectId,
  runId,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
  onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.qaDetails({ environmentId, input: { projectId, runId } }),
  );
  const data = query.data;
  return (
    <section aria-label="Run details" className="rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{data?.run.suite.name ?? "Run details"}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={query.refresh}>
            Refresh output
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {data ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <RunBadge run={data.run} />
            <span className="text-sm text-muted-foreground">
              {qaRunDuration(data.run)} · {qaRunSummary(data.run)}
            </span>
          </div>
          <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
            {data.run.cwd}
            <br />
            {data.run.suite.command}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.run.branch ?? "No branch recorded"} ·{" "}
            {data.run.commit ?? "No Git revision recorded"}
            {data.run.dirty ? " · Working directory had uncommitted changes" : ""}
            {data.run.exitCode !== null ? ` · Exit ${data.run.exitCode}` : ""}
          </p>
          {data.run.note ? <p className="mt-3 text-sm">{data.run.note}</p> : null}
          {data.outputTruncated ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Output truncated; showing the most recent output.
            </p>
          ) : null}
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs">
            {data.output ||
              (data.run.status === "running"
                ? "Waiting for output. Refresh to see progress."
                : "No output captured.")}
          </pre>
          {data.reportXml ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">Saved JUnit report</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs">
                {data.reportXml}
              </pre>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Loading run…</p>
      )}
    </section>
  );
}
