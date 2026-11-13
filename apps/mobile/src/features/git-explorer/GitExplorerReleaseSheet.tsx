import {
  describeGitExplorerRelease,
  describeGitExplorerReleaseChanges,
  describeGitExplorerReleaseVersion,
  describeGitFailure,
  formatGitExplorerReleaseElapsed,
  type GitExplorerReleaseProgress,
  gitExplorerReleaseStepLabels,
  gitExplorerReleaseStepState,
  gitExplorerReleaseText,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerReleasePlanResult } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { relativeTime } from "../../lib/time";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useVisibleSecondClock } from "../threads/use-visible-second-clock";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";
import type { GitExplorerReleaseRequest } from "./useGitExplorerRelease";

function Elapsed({ since }: { since: number }) {
  const now = useVisibleSecondClock(true);
  return (
    <Text className="text-xs text-foreground-muted tabular-nums">
      {formatGitExplorerReleaseElapsed(since, now)}
    </Text>
  );
}

function StepMarker({ state, index }: { state: "pending" | "active" | "done"; index: number }) {
  if (state === "done")
    return (
      <SymbolView
        name="checkmark.circle.fill"
        size={20}
        tintColorClassName="accent-primary-text"
        accessibilityLabel="Done"
      />
    );
  if (state === "active")
    return (
      <View style={{ width: 20, height: 20 }} className="items-center justify-center">
        <AppActivityIndicator size="small" accessibilityLabel="In progress" />
      </View>
    );
  return (
    <View
      style={{ width: 20, height: 20 }}
      className="items-center justify-center rounded-full border border-border-subtle"
    >
      <Text className="text-xs text-foreground-muted">{index + 1}</Text>
    </View>
  );
}

/** Reviews a release plan, then shows each step while the release runs. */
export function GitExplorerReleaseSheet(props: {
  params: GitExplorerParams;
  request: GitExplorerReleaseRequest;
  releasing: boolean;
  progress: GitExplorerReleaseProgress | null;
  onRelease: (plan: GitExplorerReleasePlanResult) => void;
  onClose: () => void;
}) {
  const surfaceStyle = useResolveClassNames("flex-1 bg-sheet-solid");
  // The sheet reviews what was clicked; later renders must not plan it again.
  const [{ request, params }] = useState(() => ({ request: props.request, params: props.params }));
  const readPlan = useAtomCommand(gitExplorerEnvironment.readReleasePlan, {
    reportFailure: false,
  });
  const [plan, setPlan] = useState<GitExplorerReleasePlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch origin and plan the release while the sheet is open.
  useEffect(() => {
    let active = true;
    const target = gitExplorerTarget(params);
    void readPlan({
      ...target,
      input: {
        ...target.input,
        channel: request.channel,
        sourceRef: request.reference.name,
        revision: request.reference.hash,
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
  }, [params, request, readPlan]);

  const production = request.channel === "production";
  const description = plan ? describeGitExplorerRelease(plan) : null;
  const changesHeading = plan ? describeGitExplorerReleaseChanges(plan) : null;
  const { progress, releasing } = props;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <SafeAreaProvider style={{ flex: 1 }}>
        <SafeAreaView style={surfaceStyle}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-xl font-t3-semibold text-foreground">
                Release to {production ? "production" : "beta"}
              </Text>
              <Text className="font-mono text-xs text-foreground-muted">
                {plan
                  ? [...(plan.merge ? [plan.source] : []), plan.releaseBranch, plan.tag].join(" → ")
                  : request.reference.shortName}
              </Text>
            </View>
            {planError ? (
              <Text accessibilityRole="alert" className="text-danger-foreground">
                {planError}
              </Text>
            ) : !plan || !description ? (
              <View className="flex-row items-center gap-2">
                <AppActivityIndicator size="small" />
                <Text className="text-foreground-muted">
                  Fetching release branches and tags from origin…
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center justify-between gap-3 rounded-lg border border-border-subtle px-4 py-3">
                  <View className="min-w-0 flex-1">
                    <Text className="font-mono text-xl font-t3-semibold text-foreground">
                      {plan.tag}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      {describeGitExplorerReleaseVersion(plan, (iso) => `${relativeTime(iso)} ago`)}
                    </Text>
                  </View>
                  <Text
                    className={`font-t3-medium text-xs ${production ? "text-danger-foreground" : "text-warning-foreground"}`}
                  >
                    {production ? "Production" : "Stage"}
                  </Text>
                </View>
                {plan.blocked ? (
                  <Text accessibilityRole="alert" className="text-warning-foreground">
                    {plan.blocked}
                  </Text>
                ) : (
                  <>
                    {plan.changes && changesHeading ? (
                      <View className="gap-1.5">
                        <Text className="font-t3-medium text-xs text-foreground-muted">
                          {changesHeading}
                        </Text>
                        <View className="gap-1 rounded-md bg-subtle-strong px-2.5 py-2">
                          {plan.changes.commits.map((commit) => (
                            <View key={commit.hash} className="flex-row gap-2.5">
                              <Text className="font-mono text-xs text-foreground-muted">
                                {commit.hash.slice(0, 7)}
                              </Text>
                              <Text numberOfLines={1} className="flex-1 text-xs text-foreground">
                                {commit.subject}
                              </Text>
                            </View>
                          ))}
                          {plan.changes.total > plan.changes.commits.length ? (
                            <Text className="text-xs text-foreground-muted">
                              +{plan.changes.total - plan.changes.commits.length} older
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                    <View className="gap-3">
                      {description.steps.map((step, index) => {
                        const state = gitExplorerReleaseStepState(progress, step.step);
                        return (
                          <View key={gitExplorerReleaseText(step.title)} className="flex-row gap-3">
                            <StepMarker state={state} index={index} />
                            <View className="min-w-0 flex-1 gap-1">
                              <View className="flex-row items-baseline justify-between gap-2">
                                <Text className="flex-1 text-foreground">
                                  {gitExplorerReleaseText(step.title)}
                                </Text>
                                {state === "active" && progress ? (
                                  <Elapsed since={progress.startedAt} />
                                ) : null}
                              </View>
                              {step.detail ? (
                                <Text className="text-xs text-foreground-muted">{step.detail}</Text>
                              ) : null}
                              {state === "active" && progress?.hook ? (
                                <Text className="text-xs text-foreground-muted">
                                  Running the local {progress.hook} hook
                                </Text>
                              ) : null}
                              {state === "active" && progress?.output ? (
                                <Text
                                  numberOfLines={1}
                                  className="rounded bg-subtle-strong px-1.5 py-0.5 font-mono text-xs text-foreground-muted"
                                >
                                  {progress.output}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
                {releasing ? (
                  <Text className="text-xs text-foreground-muted">
                    Closing this doesn't stop the release. You'll get an alert when it finishes.
                  </Text>
                ) : !plan.blocked && description.conflicts ? (
                  <Text className="text-xs text-foreground-muted">{description.conflicts}</Text>
                ) : null}
              </>
            )}
          </ScrollView>
          <View className="flex-row flex-wrap gap-2 p-4">
            <Button
              label={releasing || plan?.blocked || planError ? "Close" : "Cancel"}
              onPress={props.onClose}
            />
            <Button
              label={
                releasing
                  ? progress
                    ? gitExplorerReleaseStepLabels[progress.step]
                    : "Releasing…"
                  : plan
                    ? `Release ${plan.tag}`
                    : "Release"
              }
              tone={production ? "danger" : "primary"}
              loading={releasing}
              disabled={releasing || !plan || plan.blocked !== null}
              onPress={() => {
                if (plan && !plan.blocked) props.onRelease(plan);
              }}
            />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
