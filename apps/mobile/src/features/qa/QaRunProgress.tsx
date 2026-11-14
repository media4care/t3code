import { useRef, type ComponentRef } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId, ProjectId, QaRun, QaRunStep } from "@t3tools/contracts";
import {
  QA_STEP_LABELS,
  QA_STEP_STATUS_LABELS,
  qaOutputTail,
  qaRunSteps,
  qaStepDuration,
} from "@t3tools/client-runtime/qa";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useVisibleSecondClock } from "../threads/use-visible-second-clock";

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

const ICONS = {
  done: { name: "checkmark", tint: "accent-adaptive-emerald-700-300" },
  failed: { name: "xmark", tint: "accent-danger-foreground" },
  skipped: { name: "minus", tint: "accent-foreground-muted" },
} satisfies Partial<Record<QaRunStep["status"], { name: AppSymbolName; tint: string }>>;

/** What a run does in order: done steps checked, the current one spinning, the rest still to come. */
export function QaRunSteps({ run }: { run: QaRun }) {
  const steps = qaRunSteps(run);
  const now = useVisibleSecondClock(run.status === "running");
  if (steps.length === 0) return null;
  return (
    <View accessibilityLabel="Run steps" className="gap-1.5">
      {steps.map((step) => (
        <View
          key={step.id}
          accessible
          accessibilityLabel={`${QA_STEP_LABELS[step.id]}: ${QA_STEP_STATUS_LABELS[step.status]}`}
          className="min-h-6 flex-row items-center gap-2"
        >
          <View className="w-5 items-center">
            {step.status === "running" ? (
              <AppActivityIndicator
                size="small"
                colorClassName="accent-update-foreground"
                style={{ transform: [{ scale: 0.75 }] }}
              />
            ) : step.status === "pending" ? null : (
              <SymbolView
                name={ICONS[step.status].name}
                size={14}
                tintColorClassName={ICONS[step.status].tint}
              />
            )}
          </View>
          <Text
            numberOfLines={1}
            className={`flex-1 text-sm ${
              step.status === "failed"
                ? "text-danger-foreground"
                : step.status === "pending" || step.status === "skipped"
                  ? "text-foreground-muted"
                  : step.status === "running"
                    ? "font-t3-semibold"
                    : ""
            }`}
          >
            {QA_STEP_LABELS[step.id]}
          </Text>
          <Text className="text-xs text-foreground-muted" style={{ fontVariant: ["tabular-nums"] }}>
            {step.status === "skipped" ? "Skipped" : qaStepDuration(step, now)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A run's output, kept on its newest line as it grows. */
export function QaOutput({ text, placeholder }: { text: string; placeholder: string }) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return (
    <View accessibilityLabel="Run output" className="max-h-80 rounded-lg bg-subtle p-3">
      <ScrollView
        ref={scroll}
        nestedScrollEnabled
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <Text selectable className="font-mono text-xs">
          {text || placeholder}
        </Text>
      </ScrollView>
    </View>
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
    <View className="gap-3">
      <QaRunSteps run={live?.run ?? run} />
      <View accessibilityLabel="Run output" className="rounded-lg bg-subtle p-3">
        <Text selectable className="font-mono text-xs">
          {qaOutputTail(live?.output ?? "", 8) || "Waiting for output…"}
        </Text>
      </View>
    </View>
  );
}
