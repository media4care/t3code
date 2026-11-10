import { Pressable, View } from "react-native";
import type { EnvironmentId, InsightDecision, InsightsReport } from "@t3tools/contracts";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
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
  const count = brief.decisions.length;
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <Text className="font-t3-semibold text-sm text-foreground">Decision brief</Text>
      <Text className="font-t3-medium text-base text-foreground">{brief.headline}</Text>
      <Text className="text-xs text-foreground-muted">
        From {report.metrics.runs} sampled runs
        {report.tasks ? ` in ${report.tasks.length} tasks` : ""}.
      </Text>
      {count > 0 ? (
        <Text className="border-t border-border-subtle pt-3 text-xs text-foreground-muted">
          {count === 1 ? "1 decision" : `${count} decisions`} behind this · check the evidence
          before acting
        </Text>
      ) : null}
      {brief.decisions.map((decision, index) => (
        <View
          key={decision.title}
          className="flex-row gap-3 rounded-xl border border-border-subtle p-3"
        >
          <View className="size-6 items-center justify-center rounded-full bg-subtle">
            <Text className="font-t3-semibold text-xs text-foreground">{index + 1}</Text>
          </View>
          <View className="flex-1 gap-2">
            <DecisionSummary decision={decision} onOpenRecommendation={onOpenRecommendation} />
            <InsightsEvidence
              environmentId={environmentId}
              evidence={report.evidence.filter((e) => decision.evidenceIds.includes(e.id))}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function DecisionSummary({
  decision,
  onOpenRecommendation,
}: {
  decision: InsightDecision;
  onOpenRecommendation: (id: string) => void;
}) {
  const body = (
    <View className="flex-1 gap-1">
      <Text className="text-xs text-primary">
        {decision.kind === "briefing" ? "Your briefs" : "Toolkit"}
      </Text>
      <Text className="font-t3-medium text-sm text-foreground">{decision.title}</Text>
      <Text className="text-sm text-foreground">{decision.action}</Text>
      <Text className="text-xs text-foreground-muted">{decision.why}</Text>
    </View>
  );
  const recommendationId = decision.recommendationId;
  if (!recommendationId) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the recommendation"
      onPress={() => onOpenRecommendation(recommendationId)}
      className="flex-row items-start gap-3"
    >
      {body}
      <SymbolView name="chevron.right" size={14} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}
