import { useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, InsightRecommendation, InsightsReport } from "@t3tools/contracts";
import { insightTaskMeasures, reviewedInsightThreads } from "@t3tools/client-runtime/insights";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useProjects } from "../../state/entities";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";

const INITIAL_ROWS = 8;

export function InsightsReviewedThreads({
  environmentId,
  report,
  recommendations,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  recommendations: readonly InsightRecommendation[];
}) {
  const [expanded, setExpanded] = useState(false);
  const projects = useProjects();
  const selectDetail = useSelectWorkspaceDetail();
  const threads = reviewedInsightThreads(report, recommendations);
  if (!threads.length) return null;
  const shown = expanded ? threads : threads.slice(0, INITIAL_ROWS);
  const byTask = report.tasks !== undefined;
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-t3-semibold text-sm text-foreground">
          {byTask ? "Tasks sampled" : "Threads sampled"}
        </Text>
        <Text className="text-xs text-foreground-muted">{threads.length}</Text>
      </View>
      <Text className="text-xs text-foreground-muted">
        {byTask
          ? "Each task is a thread with its subagent threads. Follow-ups count only messages you wrote."
          : "The threads whose runs this review sampled, most recent first."}
      </Text>
      {shown.map((thread) => {
        const threadEnvironmentId = thread.environmentId ?? environmentId;
        const project = projects.find(
          (entry) => entry.environmentId === threadEnvironmentId && entry.id === thread.projectId,
        )?.title;
        const machine = thread.environmentId
          ? report.linked?.find((entry) => entry.environmentId === thread.environmentId)?.label
          : undefined;
        const details = [
          machine,
          project,
          `${thread.runs} ${thread.runs === 1 ? "run" : "runs"}`,
          new Date(thread.lastActivityAt).toLocaleDateString(),
        ]
          .filter(Boolean)
          .join(" · ");
        const measures = thread.task
          ? [
              insightTaskMeasures(thread.task),
              thread.task.pullRequest && `PR ${thread.task.pullRequest}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : null;
        const cited =
          thread.citedBy > 0
            ? `Cited by ${thread.citedBy} ${thread.citedBy === 1 ? "finding" : "findings"}`
            : null;
        return (
          <Pressable
            key={`${threadEnvironmentId}/${thread.threadId}`}
            accessibilityRole="button"
            accessibilityLabel={`${thread.title}. ${details}.${measures ? ` ${measures}.` : ""}${cited ? ` ${cited}.` : ""} Open thread.`}
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: { environmentId: threadEnvironmentId, threadId: thread.threadId },
              })
            }
            className="gap-0.5 border-t border-border-subtle pt-3"
          >
            <Text numberOfLines={1} className="text-sm text-foreground">
              {thread.title}
            </Text>
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {details}
            </Text>
            {measures ? (
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {measures}
              </Text>
            ) : null}
            {cited ? <Text className="text-xs text-primary">{cited}</Text> : null}
          </Pressable>
        );
      })}
      {threads.length > INITIAL_ROWS && (
        <Button
          label={expanded ? "Show fewer" : `Show all ${threads.length}`}
          tone="text"
          onPress={() => setExpanded(!expanded)}
        />
      )}
    </View>
  );
}
