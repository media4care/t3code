import { View } from "react-native";
import type { EnvironmentId, InsightsReport } from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { InsightsEvidence } from "./InsightsEvidence";

export function InsightsDecisionBrief({
  environmentId,
  report,
  onOpenRecommendation,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  onOpenRecommendation: (id: string) => void;
}) {
  const { brief } = report;
  if (!brief) return null;
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <Text className="font-t3-semibold text-sm text-foreground">Decision brief</Text>
      <Text className="font-t3-medium text-base text-foreground">{brief.headline}</Text>
      <Text className="text-xs text-foreground-muted">
        From {report.metrics.runs} sampled runs
        {report.tasks ? ` in ${report.tasks.length} tasks` : ""}. Check each decision's evidence
        before acting.
      </Text>
      {brief.decisions.map((decision) => (
        <View key={decision.title} className="gap-1 border-t border-border-subtle pt-3">
          <Text className="text-xs text-primary">
            {decision.kind === "briefing" ? "Your briefs" : "Toolkit"}
          </Text>
          <Text className="font-t3-medium text-sm text-foreground">{decision.title}</Text>
          <Text className="text-sm text-foreground">{decision.action}</Text>
          <Text className="text-xs text-foreground-muted">{decision.why}</Text>
          {decision.recommendationId ? (
            <Button
              label="Open recommendation"
              tone="text"
              onPress={() => onOpenRecommendation(decision.recommendationId!)}
            />
          ) : null}
          <InsightsEvidence
            environmentId={environmentId}
            evidence={report.evidence.filter((e) => decision.evidenceIds.includes(e.id))}
          />
        </View>
      ))}
    </View>
  );
}
