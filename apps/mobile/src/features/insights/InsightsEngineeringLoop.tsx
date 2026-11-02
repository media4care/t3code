import { Pressable, View } from "react-native";
import type { EnvironmentId, InsightLoopTicket } from "@t3tools/contracts";
import {
  ENGINEERING_LOOP_STAGES,
  engineeringLoopBoard,
  loopDaysLabel,
} from "@t3tools/client-runtime/insights";
import { AppText as Text } from "../../components/ui/AppText";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

export function InsightsEngineeringLoop({
  environmentId,
  tickets,
  asOf,
}: {
  environmentId: EnvironmentId;
  tickets: readonly InsightLoopTicket[];
  asOf: string;
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const board = engineeringLoopBoard(tickets, asOf);
  return (
    <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-t3-semibold text-sm text-foreground">Engineering loop</Text>
        <Text className="text-xs text-foreground-muted">
          {board.rows.length} {board.rows.length === 1 ? "ticket" : "tickets"}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-y-3">
        {board.stages.map(({ stage, count }) => (
          <View
            key={stage}
            accessible
            accessibilityLabel={`${stage}: ${count}`}
            className="w-1/4 items-center gap-1"
          >
            <View
              className={`size-7 items-center justify-center rounded-full border ${count ? "border-primary bg-primary" : "border-border-subtle"}`}
            >
              <Text
                className={`font-t3-semibold text-xs ${count ? "text-primary-foreground" : "text-foreground-muted"}`}
              >
                {count}
              </Text>
            </View>
            <Text
              numberOfLines={2}
              className={`text-center text-xs ${count ? "font-t3-medium text-foreground" : "text-foreground-muted"}`}
            >
              {stage}
            </Text>
          </View>
        ))}
      </View>
      {board.elsewhere.length > 0 && (
        <Text className="text-xs text-foreground-muted">
          {board.elsewhere.map((entry) => `${entry.stage} ${entry.count}`).join(" · ")}
        </Text>
      )}
      {board.rows.map((row) => {
        const position = row.stage === "Done" ? ENGINEERING_LOOP_STAGES.length : row.position;
        const { threadId } = row;
        const updated =
          row.daysSinceUpdate === 0 ? "today" : `${loopDaysLabel(row.daysSinceUpdate)} ago`;
        return (
          <Pressable
            key={`${row.environmentId ?? ""}/${row.ticket}`}
            accessibilityRole={threadId ? "button" : undefined}
            accessibilityLabel={`${row.ticket} ${row.title}: ${row.stage}${row.daysInStage !== null ? ` for ${loopDaysLabel(row.daysInStage)}` : ""}, updated ${updated}.${threadId ? " Open thread." : ""}`}
            disabled={!threadId}
            onPress={() =>
              threadId &&
              selectDetail({
                name: "Thread",
                params: { environmentId: row.environmentId ?? environmentId, threadId },
              })
            }
            className="gap-1.5 border-t border-border-subtle pt-3"
          >
            <Text className="text-sm text-foreground">
              <Text className="font-t3-semibold text-sm text-foreground">{row.ticket}</Text>{" "}
              {row.title}
            </Text>
            {row.next ? (
              <Text numberOfLines={2} className="text-xs text-foreground-muted">
                Next: {row.next}
              </Text>
            ) : null}
            <View className="flex-row gap-0.5">
              {ENGINEERING_LOOP_STAGES.map((stage, index) => (
                <View
                  key={stage}
                  className={`h-1.5 flex-1 rounded-full ${index < position ? "bg-primary/45" : index === position ? "bg-primary" : "bg-subtle-strong"}`}
                />
              ))}
            </View>
            <Text className="text-xs text-foreground-muted">
              {row.stage}
              {row.daysInStage !== null && ` · ${loopDaysLabel(row.daysInStage)}`} · updated{" "}
              {updated}
            </Text>
          </Pressable>
        );
      })}
      <Text className="text-xs text-foreground-muted">
        From each ticket's engineering-loop worksheet, as of this review.
      </Text>
    </View>
  );
}
