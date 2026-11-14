import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import type { EnvironmentId, ProjectId, QaRun, QaRunStep } from "@t3tools/contracts";
import {
  QA_STEP_LABELS,
  QA_STEP_STATUS_LABELS,
  qaOutputTail,
  qaRunSteps,
  qaStepDuration,
} from "@t3tools/client-runtime/qa";
import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { Spinner } from "../ui/spinner";

/** A run in progress as the server streams it; null for a finished run or a server without steps. */
export function useQaLiveRun(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  run: QaRun | undefined,
) {
  const watching = run?.status === "running" && run.steps !== undefined;
  const query = useEnvironmentQuery(
    watching
      ? serverEnvironment.qaRun({ environmentId, input: { projectId, runId: run.id } })
      : null,
  );
  return watching ? query.data : null;
}

function StepIcon({ status }: { status: QaRunStep["status"] }) {
  switch (status) {
    case "done":
      return <CheckIcon aria-hidden className="size-4 text-success-foreground" />;
    case "running":
      return <Spinner size="md" aria-hidden />;
    case "failed":
      return <XIcon aria-hidden className="size-4 text-destructive-foreground" />;
    case "skipped":
      return <MinusIcon aria-hidden className="size-4 text-muted-foreground" />;
    case "pending":
      return null;
  }
}

/** Mounted only for the running step, so finished runs never subscribe to the clock. */
function RunningDuration({ step }: { step: QaRunStep }) {
  return <>{qaStepDuration(step, useNowSecond())}</>;
}

/** What a run does in order: done steps checked, the current one spinning, the rest still to come. */
export function QaRunSteps({ run }: { run: QaRun }) {
  const steps = qaRunSteps(run);
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Run steps" className="grid gap-1.5 text-sm">
      {steps.map((step) => (
        <li
          key={step.id}
          aria-label={`${QA_STEP_LABELS[step.id]}: ${QA_STEP_STATUS_LABELS[step.status]}`}
          aria-current={step.status === "running" ? "step" : undefined}
          className="flex items-center gap-2"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StepIcon status={step.status} />
          </span>
          <span
            className={cn(
              "min-w-0 truncate",
              (step.status === "pending" || step.status === "skipped") && "text-muted-foreground",
              step.status === "failed" && "text-destructive-foreground",
              step.status === "running" && "font-medium",
            )}
          >
            {QA_STEP_LABELS[step.id]}
          </span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {step.status === "skipped" ? (
              "Skipped"
            ) : step.status === "running" ? (
              <RunningDuration step={step} />
            ) : (
              qaStepDuration(step, 0)
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A reversed column keeps the scroll on the newest line as output arrives, without script. */
export function QaOutput({
  text,
  placeholder,
  size = "tall",
}: {
  text: string;
  placeholder: string;
  size?: "short" | "tall";
}) {
  return (
    <div
      role="log"
      aria-label="Run output"
      className={cn(
        "flex flex-col-reverse overflow-auto rounded-lg bg-muted p-3",
        size === "short" ? "max-h-56" : "max-h-96",
      )}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{text || placeholder}</pre>
    </div>
  );
}

/** The steps and newest output of a run in progress, for the card of its suite. */
export function QaRunActivity({
  environmentId,
  projectId,
  run,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  run: QaRun;
}) {
  const live = useQaLiveRun(environmentId, projectId, run);
  return (
    <div className="grid gap-3">
      <QaRunSteps run={live?.run ?? run} />
      <QaOutput
        size="short"
        text={qaOutputTail(live?.output ?? "")}
        placeholder="Waiting for output…"
      />
    </div>
  );
}
