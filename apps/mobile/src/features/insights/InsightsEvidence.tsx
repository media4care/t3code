import { useState } from "react";
import { View } from "react-native";
import type { EnvironmentId, InsightEvidence } from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

export function InsightsEvidence({
  environmentId,
  evidence,
}: {
  environmentId: EnvironmentId;
  evidence: readonly InsightEvidence[];
}) {
  const [open, setOpen] = useState(false);
  const selectDetail = useSelectWorkspaceDetail();
  if (!evidence.length) return null;
  return (
    <View className="gap-3">
      <Button
        label={`${open ? "Hide" : "Show"} evidence (${evidence.length})`}
        tone="text"
        onPress={() => setOpen(!open)}
      />
      {open &&
        evidence.map((item) => (
          <View key={item.id} className="gap-2 rounded-xl border border-border-subtle p-3">
            <Button
              label={item.title}
              tone="text"
              onPress={() =>
                selectDetail({ name: "Thread", params: { environmentId, threadId: item.threadId } })
              }
            />
            <Text selectable className="text-xs text-foreground-muted">
              {item.kind} · {item.itemId ?? item.runId}
            </Text>
            <Text selectable className="text-xs text-foreground">
              {item.text}
            </Text>
          </View>
        ))}
    </View>
  );
}
