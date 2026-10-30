import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, InsightsReport, InsightsSnapshot } from "@t3tools/contracts";
import { INSIGHT_STATUS_LABELS } from "@t3tools/client-runtime/insights";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { InsightsEvidence } from "./InsightsEvidence";

const OUTCOMES = [
  { key: "completed", label: "Completed", color: "bg-primary" },
  { key: "failed", label: "Failed", color: "bg-danger-foreground" },
  { key: "interrupted", label: "Interrupted", color: "bg-warning-foreground" },
  { key: "active", label: "Active", color: "bg-foreground-muted" },
] as const;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function Disclosure({
  title,
  icon = "chevron.right",
  children,
  initiallyOpen = false,
}: {
  title: string;
  icon?: AppSymbolName;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="min-h-14 flex-row items-center gap-3 p-4"
      >
        <SymbolView name={icon} size={18} tintColorClassName="accent-primary-text" />
        <Text numberOfLines={2} className="flex-1 font-t3-medium text-sm text-foreground">
          {title}
        </Text>
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={14}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      {open && <View className="gap-4 border-t border-border-subtle p-4">{children}</View>}
    </View>
  );
}

export function InsightsDashboard({
  environmentId,
  report,
  snapshot,
  onOpenRecommendation,
  onOpenHistory,
  onSelectReport,
}: {
  environmentId: EnvironmentId;
  report: InsightsReport;
  snapshot: InsightsSnapshot;
  onOpenRecommendation: (id: string) => void;
  onOpenHistory: () => void;
  onSelectReport: (id: string) => void;
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const { metrics } = report;
  const recommendations = snapshot.recommendations
    .filter((r) => report.recommendationIds.includes(r.id))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const counts = Object.entries(INSIGHT_STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    value: snapshot.recommendations.filter((r) => r.status === status).length,
  }));
  const recent = snapshot.reports
    .filter((r) => r.scopeKey === report.scopeKey && ["completed", "empty"].includes(r.status))
    .slice(0, 14)
    .reverse();
  const maxRuns = Math.max(1, ...recent.map((r) => r.metrics.runs));
  const compact = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-3">
        {(
          [
            {
              label: "Runs reviewed",
              value: metrics.runs,
              hint: "This review",
              icon: "chart.bar.xaxis",
            },
            {
              label: "Tool failures",
              value: metrics.toolFailures,
              hint: "Reported by tools",
              icon: "exclamationmark.triangle",
            },
            {
              label: "Human requests",
              value: metrics.humanRequests,
              hint: "Questions & approvals",
              icon: "bubble.left",
            },
            {
              label: "Recorded tokens",
              value: metrics.runsWithTokenUsage ? compact.format(metrics.tokens) : "N/A",
              hint: metrics.runsWithTokenUsage
                ? `${metrics.runsWithTokenUsage}/${metrics.runs} runs have usage`
                : "No usage recorded",
              icon: "doc.text",
            },
          ] as const
        ).map((metric) => (
          <View
            key={metric.label}
            className="min-w-36 flex-1 gap-2 rounded-2xl border border-border-subtle bg-surface p-4"
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-xs text-foreground-muted">{metric.label}</Text>
              <SymbolView name={metric.icon} size={16} tintColorClassName="accent-primary-text" />
            </View>
            <Text className="font-t3-semibold text-3xl text-foreground">{metric.value}</Text>
            <Text className="text-xs text-foreground-muted">{metric.hint}</Text>
          </View>
        ))}
      </View>

      <View className="gap-4 rounded-2xl border border-border-subtle bg-surface p-4">
        <Text className="font-t3-semibold text-sm text-foreground">Run outcomes</Text>
        <View
          className="h-4 flex-row overflow-hidden rounded-full bg-subtle-strong"
          accessible
          accessibilityLabel={OUTCOMES.map(
            (entry) => `${metrics[entry.key]} ${entry.label.toLowerCase()}`,
          ).join(", ")}
        >
          {OUTCOMES.map((entry) => (
            <View
              key={entry.key}
              className={entry.color}
              style={{ width: `${(metrics[entry.key] / Math.max(1, metrics.runs)) * 100}%` }}
            />
          ))}
        </View>
        {OUTCOMES.map((entry) => (
          <View key={entry.key} className="flex-row items-center gap-2">
            <View className={`size-2 rounded-full ${entry.color}`} />
            <Text className="flex-1 text-sm text-foreground-muted">{entry.label}</Text>
            <Text className="font-t3-medium text-sm text-foreground">{metrics[entry.key]}</Text>
          </View>
        ))}
        <Text className="text-xs text-foreground-muted">
          {metrics.subagents} subagent runs · Completion is not verified success.
        </Text>
      </View>

      <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-t3-semibold text-sm text-foreground">Recommended changes</Text>
          <Text className="font-t3-medium text-sm text-primary-text">
            {report.recommendationIds.length}
          </Text>
        </View>
        <Text className="text-xs text-foreground-muted">From this review</Text>
        {recommendations.length ? (
          recommendations.slice(0, 3).map((rec) => (
            <Pressable
              key={rec.id}
              accessibilityRole="button"
              onPress={() => onOpenRecommendation(rec.id)}
              className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle py-3"
            >
              <View className="flex-1 gap-2">
                <Text numberOfLines={2} className="font-t3-medium text-sm text-foreground">
                  {rec.title}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {rec.priority.toUpperCase()} · {rec.category} ·{" "}
                  {INSIGHT_STATUS_LABELS[rec.status]}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={14}
                tintColorClassName="accent-foreground-muted"
              />
            </Pressable>
          ))
        ) : (
          <View className="items-center gap-2 py-5">
            <SymbolView name="lightbulb" size={28} tintColorClassName="accent-primary-text" />
            <Text className="font-t3-medium text-sm text-foreground">
              {report.status === "analyzing"
                ? "Review in progress"
                : report.recommendationIds.length
                  ? "Older recommendations"
                  : "No changes proposed"}
            </Text>
            <Text className="text-center text-xs text-foreground-muted">
              Open the analysis for context and limitations.
            </Text>
          </View>
        )}
        {recommendations.length > 3 && (
          <Text className="text-xs text-foreground-muted">
            {recommendations.length - 3} more in Recommendations
          </Text>
        )}
      </View>

      <View className="gap-3">
        <Text className="font-t3-semibold text-sm text-foreground">
          What worked well · {report.wins.length}
        </Text>
        {report.wins.length ? (
          report.wins.map((win) => (
            <Disclosure key={win.text} title={win.text} icon="checkmark.circle">
              <Text selectable className="text-sm text-foreground">
                {win.text}
              </Text>
              <InsightsEvidence
                environmentId={environmentId}
                evidence={report.evidence.filter((e) => win.evidenceIds.includes(e.id))}
              />
            </Disclosure>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">No supported findings yet.</Text>
        )}
      </View>

      <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-t3-semibold text-sm text-foreground">Improvement tracking</Text>
          <Button label="History" tone="text" onPress={onOpenHistory} />
        </View>
        <Text className="text-xs text-foreground-muted">
          {snapshot.truncated ? "Latest 250 recommendations" : "Across all reviews"}
        </Text>
        {counts.map((entry) => (
          <View key={entry.status} className="flex-row items-center gap-3">
            <Text className="w-20 text-xs text-foreground-muted">{entry.label}</Text>
            <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle-strong">
              <View
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${(entry.value / Math.max(1, snapshot.recommendations.length)) * 100}%`,
                }}
              />
            </View>
            <Text className="w-6 text-right font-t3-medium text-xs text-foreground">
              {entry.value}
            </Text>
          </View>
        ))}
      </View>

      {recent.length > 1 && (
        <View className="gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
          <Text className="font-t3-semibold text-sm text-foreground">Review activity</Text>
          <View className="h-24 flex-row items-end gap-2">
            {recent.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`${new Date(entry.createdAt).toLocaleDateString()}: ${entry.metrics.runs} runs. Open review.`}
                accessibilityState={{ selected: entry.id === report.id }}
                onPress={() => onSelectReport(entry.id)}
                className="h-full flex-1 justify-end gap-1"
              >
                <Text className="text-center text-xs text-foreground-muted">
                  {entry.metrics.runs}
                </Text>
                <View
                  className={`rounded-t ${entry.id === report.id ? "bg-primary" : "bg-primary/30"}`}
                  style={{ height: (entry.metrics.runs / maxRuns) * 70 }}
                />
              </Pressable>
            ))}
          </View>
          <Text className="text-xs text-foreground-muted">
            Runs sampled per review · Oldest to newest
          </Text>
        </View>
      )}

      <Disclosure
        key={report.id}
        title="Analysis & evidence"
        icon="doc.text"
        initiallyOpen={report.status === "failed"}
      >
        <Text selectable className="text-sm text-foreground">
          {report.summary}
        </Text>
        <Button
          label="Open analysis thread"
          tone="text"
          onPress={() =>
            selectDetail({ name: "Thread", params: { environmentId, threadId: report.threadId } })
          }
        />
        <InsightsEvidence environmentId={environmentId} evidence={report.evidence} />
        <Text className="font-t3-semibold text-sm text-foreground">Coverage & limitations</Text>
        <Text className="text-xs text-foreground-muted">
          Sampled activity, including child runs. Token coverage: {metrics.runsWithTokenUsage}/
          {metrics.runs} runs. Failures and requests are signals to investigate, not quality scores.
          A run can appear in more than one review.
        </Text>
        {report.hasMore && (
          <Text className="text-xs text-foreground-muted">
            More activity remains for the next review.
          </Text>
        )}
        {report.limitations.map((limitation) => (
          <Text key={limitation} className="text-xs text-foreground-muted">
            • {limitation}
          </Text>
        ))}
      </Disclosure>
    </View>
  );
}
