import { Pressable, View } from "react-native";
import type { EnvironmentId, InsightRecommendation, InsightsReport } from "@t3tools/contracts";
import { recurringInsightFriction } from "@t3tools/client-runtime/insights";
import { AppText as Text } from "../../components/ui/AppText";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";

export function InsightsFriction({
  environmentId,
  report,
  recommendations,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  recommendations: readonly InsightRecommendation[];
}) {
  const selectDetail = useSelectWorkspaceDetail();
  if (!report.friction) return null;
  const clusters = recurringInsightFriction(report, recommendations);
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <Text className="font-t3-semibold text-sm text-foreground">Recurring friction</Text>
      <Text className="text-xs text-foreground-muted">
        Tool failures that came back across tasks or within one, grouped by program, exit code and
        error.
      </Text>
      {clusters.length ? (
        clusters.map((cluster) => {
          const details = [
            `${cluster.family} · exit ${cluster.exitCode ?? "unknown"}`,
            `${cluster.failures} failures`,
            cluster.tasks > 1
              ? `${cluster.tasks} tasks`
              : `${cluster.maxPerTask} times in one task`,
          ].join(" · ");
          const example = cluster.example;
          return (
            <Pressable
              key={cluster.key}
              disabled={!example}
              accessibilityRole={example ? "button" : undefined}
              accessibilityLabel={`${cluster.signature}. ${details}.${cluster.recommendation ? ` Recommendation: ${cluster.recommendation.title}.` : ""}${example ? " Open an example thread." : ""}`}
              onPress={() =>
                example &&
                selectDetail({
                  name: "Thread",
                  params: {
                    environmentId: example.environmentId ?? environmentId,
                    threadId: example.threadId,
                  },
                })
              }
              className="gap-0.5 border-t border-border-subtle pt-3"
            >
              <Text numberOfLines={2} className="font-mono text-xs text-foreground">
                {cluster.signature}
              </Text>
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {details}
              </Text>
              {cluster.recommendation ? (
                <Text numberOfLines={1} className="text-xs text-primary">
                  Recommendation: {cluster.recommendation.title}
                </Text>
              ) : null}
            </Pressable>
          );
        })
      ) : (
        <Text className="text-sm text-foreground-muted">
          No tool failure recurred in this sample.
        </Text>
      )}
    </View>
  );
}
