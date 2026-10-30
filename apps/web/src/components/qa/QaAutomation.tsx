import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { CalendarClockIcon, UploadIcon } from "lucide-react";
import type {
  EnvironmentId,
  ProjectId,
  QaScheduleConfiguration,
  QaSnapshot,
} from "@t3tools/contracts";
import {
  decodeQaCiReport,
  QA_CI_REPORT_EXAMPLE,
  qaDefaultSchedule,
  qaScheduleLabel,
  qaRunSource,
} from "@t3tools/client-runtime/qa";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { QaRunBadge } from "./QaDashboard";

export function QaAutomation({
  environmentId,
  projectId,
  snapshot,
  connected,
  onView,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  snapshot: QaSnapshot;
  connected: boolean;
  onView: (id: string) => void;
}) {
  const save = useAtomCommand(serverEnvironment.setQaSchedule);
  const importReport = useAtomCommand(serverEnvironment.importQaReport);
  const canSchedule = useAtomValue(serverEnvironment.setQaSchedule.permissionAtom(environmentId));
  const canImport = useAtomValue(serverEnvironment.importQaReport.permissionAtom(environmentId));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const schedule = snapshot.schedule;
  const scheduleTarget = schedule?.configuration.target;
  const configure = async (configuration: QaScheduleConfiguration | null) => {
    setBusy(true);
    const result = await save({ environmentId, input: { projectId, configuration } }).finally(() =>
      setBusy(false),
    );
    if (result._tag === "Success") setEditing(false);
  };
  const submitReport = async () => {
    let decoded;
    try {
      decoded = decodeQaCiReport(report);
    } catch {
      setMessage(
        "Use the CI report JSON format shown below, including a suite ID, revision, times, exit code, and JUnit XML.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await importReport({
      environmentId,
      input: { projectId, report: decoded },
    }).finally(() => setBusy(false));
    if (result._tag === "Success") {
      setReport("");
      setMessage("CI result saved.");
      onView(result.value.id);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        aria-label="QA schedule"
        className="min-w-0 rounded-xl border border-border bg-card p-5"
      >
        <div className="flex items-center gap-2">
          <CalendarClockIcon className="size-5 text-primary" />
          <h3 className="font-semibold">Recurring runs</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Runs on this environment while its server is online. Uses the selected branch and current
          working files.
        </p>
        {schedule ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="font-medium">
              {schedule.configuration.enabled ? "Enabled" : "Paused"} ·{" "}
              {qaScheduleLabel(schedule.configuration)}
            </p>
            <p>
              {scheduleTarget?.type === "suite"
                ? (snapshot.suites.find((suite) => suite.id === scheduleTarget.suiteId)?.name ??
                  "Removed suite")
                : scheduleTarget?.type === "all"
                  ? "All suites"
                  : "Affected suites"}{" "}
              · <span className="font-mono">{schedule.configuration.branch}</span>
            </p>
            <p className="text-muted-foreground">
              Next: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "Paused"}
            </p>
            <p className="text-muted-foreground">
              Last: {schedule.lastStatus}
              {schedule.lastRunAt ? ` · ${new Date(schedule.lastRunAt).toLocaleString()}` : ""}
            </p>
            {schedule.note ? <p role="status">{schedule.note}</p> : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No schedule yet. Run all suites daily, choose one suite, or check only affected suites.
          </p>
        )}
        {editing ? (
          <ScheduleEditor
            key={schedule?.revision ?? "new"}
            initial={schedule?.configuration ?? qaDefaultSchedule(snapshot.branch ?? "")}
            suites={snapshot.suites}
            disabled={busy || !connected || !canSchedule}
            onSave={configure}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!connected || !canSchedule || busy}
              onClick={() => setEditing(true)}
            >
              {schedule ? "Edit schedule" : "Add schedule"}
            </Button>
            {schedule ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!connected || !canSchedule || busy}
                  onClick={() => {
                    void configure({
                      ...schedule.configuration,
                      enabled: !schedule.configuration.enabled,
                    });
                  }}
                >
                  {schedule.configuration.enabled ? "Pause schedule" : "Resume schedule"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!connected || !canSchedule || busy}
                  onClick={() => {
                    void configure(null);
                  }}
                >
                  Remove schedule
                </Button>
              </>
            ) : null}
          </div>
        )}
        {schedule?.lastStatus === "running" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Pausing or removing the schedule leaves the active run running. Use Stop queued run to
            cancel it.
          </p>
        ) : null}
      </section>
      <section
        aria-label="CI results"
        className="min-w-0 rounded-xl border border-border bg-card p-5"
      >
        <div className="flex items-center gap-2">
          <UploadIcon className="size-5 text-info-foreground" />
          <h3 className="font-semibold">CI results</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Results from your CI runner, with its revision and environment. Local freshness is checked
          separately.
        </p>
        <div className="mt-3 space-y-3">
          {snapshot.latestCiRuns?.length ? (
            snapshot.latestCiRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center gap-2 border-b border-border pb-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{run.suite.name}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {qaRunSource(run)} · {run.branch} · {run.commit?.slice(0, 8)}
                    <br />
                    {new Date(run.finishedAt ?? run.startedAt).toLocaleString()}
                  </p>
                </div>
                <QaRunBadge run={run} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onView(run.id)}
                  aria-label={`View CI ${run.suite.name} run`}
                >
                  Details
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No imported results yet.</p>
          )}
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Import CI report</summary>
          <div className="mt-3 space-y-3">
            <Input
              type="file"
              accept=".json,application/json"
              aria-label="CI report file"
              disabled={!connected || !canImport || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                  setMessage("The report JSON file must be smaller than 8 MiB.");
                  return;
                }
                void file
                  .text()
                  .then(setReport)
                  .catch(() => setMessage("Could not read this report file."));
              }}
            />
            <Textarea
              aria-label="CI report JSON"
              placeholder="Paste report JSON or choose a file"
              value={report}
              maxLength={8 * 1024 * 1024}
              onChange={(event) => setReport(event.target.value)}
            />
            <Button
              size="sm"
              disabled={!connected || !canImport || busy || !report.trim()}
              onClick={() => {
                void submitReport();
              }}
            >
              Import result
            </Button>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Report format and CI endpoint
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                POST {"{projectId, report}"} to <code>/api/qa/import</code> using an environment
                bearer token with terminal:operate permission. Use a unique run ID per attempt and
                suite. JUnit XML is limited to 2 MiB.
              </p>
              <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-xs">
                {QA_CI_REPORT_EXAMPLE}
              </pre>
            </details>
          </div>
        </details>
        {message ? (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ScheduleEditor({
  initial,
  suites,
  disabled,
  onSave,
  onCancel,
}: {
  initial: QaScheduleConfiguration;
  suites: QaSnapshot["suites"];
  disabled: boolean;
  onSave: (value: QaScheduleConfiguration) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const target =
    value.target.type === "suite" ? `suite:${value.target.suiteId}` : value.target.type;
  const options = [
    { value: "all", label: "All suites" },
    { value: "affected", label: "Affected suites" },
    ...suites.map((suite) => ({ value: `suite:${suite.id}`, label: suite.name })),
  ];
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value);
      }}
    >
      <Select
        value={target}
        onValueChange={(target) => {
          if (target)
            setValue({
              ...value,
              target:
                target === "all" || target === "affected"
                  ? { type: target }
                  : { type: "suite", suiteId: target.slice(6) },
            });
        }}
      >
        <SelectTrigger aria-label="Scheduled suites">
          <SelectValue>
            {options.find((item) => item.value === target)?.label ?? "Select suites"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={value.timing.type}
        onValueChange={(type) => {
          if (type)
            setValue({
              ...value,
              timing:
                type === "interval"
                  ? { type, everyMs: 86_400_000 }
                  : { type: "fixed_time", timeOfDay: "09:00" },
            });
        }}
      >
        <SelectTrigger aria-label="Schedule frequency">
          <SelectValue>
            {value.timing.type === "interval" ? "Every N minutes" : "At a fixed time"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="fixed_time">At a fixed time</SelectItem>
          <SelectItem value="interval">Every N minutes</SelectItem>
        </SelectPopup>
      </Select>
      {value.timing.type === "fixed_time" ? (
        <>
          <label className="block space-y-1 text-xs">
            Time
            <Input
              type="time"
              required
              value={value.timing.timeOfDay}
              onChange={(event) => {
                if (value.timing.type === "fixed_time")
                  setValue({
                    ...value,
                    timing: { ...value.timing, timeOfDay: event.target.value },
                  });
              }}
            />
          </label>
          <fieldset className="flex flex-wrap gap-2 text-xs">
            <legend className="mb-1 text-muted-foreground">Days · none selected means daily</legend>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
              <label key={day} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={
                    value.timing.type === "fixed_time" &&
                    (value.timing.weekdays?.includes(index) ?? false)
                  }
                  onChange={(event) => {
                    if (value.timing.type === "fixed_time")
                      setValue({
                        ...value,
                        timing: {
                          ...value.timing,
                          weekdays: event.target.checked
                            ? [...(value.timing.weekdays ?? []), index]
                            : (value.timing.weekdays ?? []).filter((item) => item !== index),
                        },
                      });
                  }}
                />
                {day}
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <label className="block space-y-1 text-xs">
          Interval in minutes
          <Input
            type="number"
            min={1}
            step={1}
            required
            value={value.timing.everyMs / 60_000}
            onChange={(event) =>
              setValue({
                ...value,
                timing: { type: "interval", everyMs: Number(event.target.value) * 60_000 },
              })
            }
          />
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          Time zone
          <Input
            required
            value={value.timeZone}
            onChange={(event) => setValue({ ...value, timeZone: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs">
          Branch
          <Input
            required
            value={value.branch}
            placeholder="main"
            onChange={(event) => setValue({ ...value, branch: event.target.value })}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Other branches are skipped. Missed fixed times are skipped after 10 minutes; interval runs
        resume once. Pausing stops future runs.
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={disabled}>
          Save schedule
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
