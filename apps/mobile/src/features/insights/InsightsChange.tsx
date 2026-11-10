import type { insightChange } from "@t3tools/client-runtime/insights";
import type { InsightRecommendation } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { REVIEW_MONO_FONT_FAMILY } from "../review/reviewDiffRendering";

const MARKS = { add: "+", remove: "−", context: " " } as const;
const SPOKEN = { add: "Added: ", remove: "Removed: ", context: "" } as const;
const MONO = { fontFamily: REVIEW_MONO_FONT_FAMILY };

/** A recommendation's change: its exact diff where it has one, else the prose describing it. */
export function InsightsChange({
  change,
  recommendation,
}: {
  change: ReturnType<typeof insightChange>;
  recommendation: Pick<InsightRecommendation, "suggestedChange" | "targetFile">;
}) {
  if (change === "loading")
    return <Text className="text-sm text-foreground-muted">Loading the change…</Text>;
  if (change === null)
    return (
      <View className="gap-2">
        {recommendation.suggestedChange ? (
          <Text selectable className="text-sm text-foreground-muted">
            {recommendation.suggestedChange}
          </Text>
        ) : null}
        {recommendation.targetFile ? (
          <Text selectable style={MONO} className="text-xs text-foreground-muted">
            {recommendation.targetFile}
          </Text>
        ) : null}
      </View>
    );
  return (
    <View className="gap-3">
      {change.map((file, position) => (
        // oxlint-disable-next-line react/no-array-index-key -- one file can have several edits
        <View key={position} className="overflow-hidden rounded-xl border border-border-subtle">
          <View className="gap-1 border-b border-border-subtle bg-subtle px-3 py-2">
            <Text selectable style={MONO} className="text-xs text-foreground">
              {file.file}
            </Text>
            {file.created ? <Text className="text-xs text-foreground-muted">New file</Text> : null}
          </View>
          <View className="py-1">
            {file.rows.map((row, line) => (
              <View
                // oxlint-disable-next-line react/no-array-index-key -- lines repeat and hold no state
                key={line}
                accessible
                accessibilityLabel={`${SPOKEN[row.kind]}${row.text}`}
                className={cn(
                  "flex-row",
                  row.kind === "add" && "bg-adaptive-emerald-500-a12-a16",
                  row.kind === "remove" && "bg-adaptive-rose-500-a12-a16",
                )}
              >
                <Text
                  style={MONO}
                  className={cn(
                    "w-6 text-center text-xs",
                    row.kind === "add" && "text-adaptive-emerald-600-400",
                    row.kind === "remove" && "text-adaptive-rose-600-400",
                  )}
                >
                  {MARKS[row.kind]}
                </Text>
                <Text selectable style={MONO} className="flex-1 pr-3 text-xs text-foreground">
                  {row.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
