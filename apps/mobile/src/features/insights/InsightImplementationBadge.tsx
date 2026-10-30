import { View } from "react-native";
import type { InsightRecommendation } from "@t3tools/contracts";
import {
  INSIGHT_IMPLEMENTATION_LABELS,
  insightImplementationStatus,
} from "@t3tools/client-runtime/insights";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";

export function InsightImplementationBadge({
  recommendation,
}: {
  recommendation: InsightRecommendation;
}) {
  const status = insightImplementationStatus(recommendation);
  return (
    <View
      className={`flex-row items-center gap-1.5 self-start rounded-full px-2 py-1 ${status === "implemented" ? "bg-primary/10" : "bg-subtle-strong"}`}
    >
      <SymbolView
        name={
          status === "implemented"
            ? "checkmark.circle.fill"
            : status === "started"
              ? "hammer"
              : "circle"
        }
        size={14}
        tintColorClassName={
          status === "not_implemented" ? "accent-foreground-muted" : "accent-primary-text"
        }
      />
      <Text
        className={`font-t3-medium text-xs ${status === "not_implemented" ? "text-foreground-muted" : "text-primary-text"}`}
      >
        {INSIGHT_IMPLEMENTATION_LABELS[status]}
      </Text>
    </View>
  );
}
