import {
  describeGitExplorerRelease,
  describeGitExplorerReleaseVersion,
  describeGitFailure,
  gitExplorerMergeConflictTask,
  gitExplorerReleaseText,
  type GitExplorerReleaseText,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerReleaseChannel,
  GitExplorerReleasePlanResult,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { useGitExplorerAction } from "./useGitExplorerAction";
import { useGitExplorerConflictAgent } from "./useGitExplorerConflictAgent";

export type GitExplorerReleaseRequest = {
  channel: GitExplorerReleaseChannel;
  reference: GitExplorerRef;
};

function ReleaseText({ text }: { text: GitExplorerReleaseText }) {
  const [part, ...rest] = text;
  if (part === undefined) return null;
  return (
    <>
      {typeof part === "string" ? (
        part
      ) : "branch" in part ? (
        <code className="rounded border px-1 font-mono text-xs">{part.branch}</code>
      ) : (
        <code className="rounded bg-primary/16 px-1 font-mono text-xs">{part.tag}</code>
      )}
      <ReleaseText text={rest} />
    </>
  );
}

export function GitExplorerReleaseAction(
  props: GitExplorerReleaseRequest & {
    environmentId: EnvironmentId;
    input: GitExplorerOverviewInput;
    overview: GitExplorerOverviewResult;
    refresh: () => void;
    onBusyChange: (busy: boolean) => void;
    onClose: () => void;
  },
) {
  const [overview] = useState(props.overview);
  const { channel, reference, environmentId, input } = props;
  // The plan reviews what was clicked; later refreshes of the scope must not change it.
  // A new request object plans again.
  const [planRequest, setPlanRequest] = useState(() => ({ input, channel, reference }));
  const readPlan = useAtomCommand(gitExplorerEnvironment.readReleasePlan, {
    reportFailure: false,
  });
  const [plan, setPlan] = useState<GitExplorerReleasePlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const launchAgent = useGitExplorerConflictAgent({ environmentId, scope: input });
  const { execute, pending, allowed, failureMessage } = useGitExplorerAction({
    ...props,
    overview,
    onSuccess: (result) => {
      if (result.conflictedPaths && plan)
        void launchAgent({
          ...gitExplorerMergeConflictTask({
            source: plan.source,
            branch: plan.releaseBranch,
            cwd: overview.selectedWorktreePath,
            conflictedPaths: result.conflictedPaths,
          }),
          branch: plan.releaseBranch,
        });
    },
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch origin and plan the release while the dialog is open.
  useEffect(() => {
    let active = true;
    void readPlan({
      environmentId,
      input: {
        ...planRequest.input,
        channel: planRequest.channel,
        sourceRef: planRequest.reference.name,
        revision: planRequest.reference.hash,
      },
    }).then((result) => {
      if (!active) return;
      if (result._tag === "Success") setPlan(result.value);
      else if (!isAtomCommandInterrupted(result))
        setPlanError(
          describeGitFailure(squashAtomCommandFailure(result), "Close this and try again."),
        );
    });
    return () => {
      active = false;
    };
  }, [planRequest, environmentId, readPlan]);

  const production = channel === "production";
  const description = plan ? describeGitExplorerRelease(plan) : null;
  const ready = allowed && !pending && plan !== null && plan.blocked === null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !plan) return;
            void execute({
              action: "release",
              mergeRef: reference.name,
              revision: reference.hash,
              releaseChannel: channel,
              tagName: plan.tag,
              releaseBase: plan.base,
            }).then((success) => {
              if (success) props.onClose();
              else {
                setPlan(null);
                setPlanRequest((request) => ({ ...request }));
              }
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Release to {production ? "production" : "beta"}</DialogTitle>
            <DialogDescription>
              {plan ? (
                <ReleaseText
                  text={[
                    ...(plan.merge ? [{ branch: plan.source }, " → "] : []),
                    { branch: plan.releaseBranch },
                    " → ",
                    { tag: plan.tag },
                  ]}
                />
              ) : (
                <ReleaseText text={[{ branch: reference.shortName }]} />
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 text-sm">
            {planError ? (
              <p role="alert" className="text-destructive">
                {planError}
              </p>
            ) : !plan || !description ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                Fetching release branches and tags from origin…
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xl font-semibold">{plan.tag}</div>
                    <div className="text-xs text-muted-foreground">
                      {describeGitExplorerReleaseVersion(plan, (iso) =>
                        formatRelativeTimeLabel(iso),
                      )}
                    </div>
                  </div>
                  <Badge variant={production ? "error" : "warning"}>
                    {production ? "Production" : "Stage"}
                  </Badge>
                </div>
                {plan.blocked ? (
                  <Alert variant="warning">
                    <AlertDescription>{plan.blocked}</AlertDescription>
                  </Alert>
                ) : (
                  <ol className="space-y-3">
                    {description.steps.map((step, index) => (
                      <li key={gitExplorerReleaseText(step.title)} className="flex gap-3">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div>
                            <ReleaseText text={step.title} />
                          </div>
                          {step.detail ? (
                            <div className="text-xs text-muted-foreground">{step.detail}</div>
                          ) : null}
                          {index === 0 && plan.merge && plan.merge.commits.length > 0 ? (
                            <ul className="space-y-0.5 rounded-md bg-foreground/4 px-2.5 py-2 text-xs">
                              {plan.merge.commits.map((commit) => (
                                <li key={commit.hash} className="flex gap-2.5">
                                  <span className="shrink-0 font-mono text-muted-foreground">
                                    {commit.hash.slice(0, 7)}
                                  </span>
                                  <span className="truncate">{commit.subject}</span>
                                </li>
                              ))}
                              {plan.merge.total > plan.merge.commits.length ? (
                                <li className="text-muted-foreground">
                                  +{plan.merge.total - plan.merge.commits.length} more
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {!plan.blocked && description.conflicts ? (
                  <p className="text-xs text-muted-foreground">{description.conflicts}</p>
                ) : null}
              </>
            )}
            {failureMessage ? (
              <p role="alert" className="text-destructive">
                {failureMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              {pending || plan?.blocked ? "Close" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant={production ? "destructive" : "default"}
              disabled={!ready}
            >
              {pending ? "Releasing…" : plan ? `Release ${plan.tag}` : "Release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
