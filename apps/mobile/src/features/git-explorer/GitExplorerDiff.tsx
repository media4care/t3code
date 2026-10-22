import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { GitExplorerPatchResult } from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { resolveNativeReviewDiffView } from "../diffs/nativeReviewDiffSurface";
import { buildReviewParsedDiff } from "../review/reviewModel";
import {
  getCachedNativeReviewDiffData,
  NATIVE_REVIEW_DIFF_CONTENT_WIDTH,
} from "../review/nativeReviewDiffAdapter";
import { useNativeReviewDiffBridge } from "../review/useNativeReviewDiffBridge";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

const EMPTY_IDS: readonly string[] = [];

export function GitExplorerDiff(props: {
  readonly result: GitExplorerPatchResult;
  readonly scope: string;
}) {
  const [NativeDiff] = useState(() => resolveNativeReviewDiffView());
  const { nativeReviewDiffStyle } = useAppearanceCodeSurface();
  const { themeAppearance } = useAppearancePreferences();
  const parsed = useMemo(
    () => buildReviewParsedDiff(props.result.patch, props.scope),
    [props.result.patch, props.scope],
  );
  const data = useMemo(() => {
    const diffData = getCachedNativeReviewDiffData({ parsedDiff: parsed });
    // Single-file navigation owns the header; native review headers expose inactive review controls.
    return { ...diffData, rows: diffData.rows.filter((row) => row.kind !== "file") };
  }, [parsed]);
  const bridge = useNativeReviewDiffBridge({
    threadKey: null,
    sectionId: props.scope,
    diff: props.result.patch,
    data,
    collapsedFileIds: EMPTY_IDS,
    viewedFileIds: EMPTY_IDS,
    selectedRowIds: EMPTY_IDS,
    canHighlight: NativeDiff !== null && !props.result.binary,
  });

  if (props.result.binary)
    return (
      <EmptyState
        variant="plain"
        title="Binary file"
        detail="A text diff is not available for this file."
      />
    );
  if (parsed.kind === "empty")
    return (
      <EmptyState
        variant="plain"
        title={props.result.truncated ? "Diff is too large to preview" : "No text changes"}
        detail={
          props.result.truncated
            ? "This file exceeds the diff preview limit. Its change statistics remain available in the file list."
            : "This file has no textual changes in this comparison. It may have only been renamed or had its mode changed."
        }
      />
    );

  return (
    <View className="min-w-0 flex-1">
      {props.result.truncated ? (
        <View className="bg-warning px-4 py-2">
          <Text className="text-sm text-warning-foreground">
            This diff exceeds the preview limit.
          </Text>
        </View>
      ) : null}
      {NativeDiff && parsed.kind === "files" ? (
        <View className="flex-1" collapsable={false}>
          <NativeDiff
            style={StyleSheet.absoluteFill}
            appearanceScheme={themeAppearance}
            rowsJson={bridge.rowsJson}
            themeJson={bridge.themeJson}
            styleJson={bridge.styleJson}
            tokensPatchJson={bridge.tokensPatchJson}
            tokensResetKey={bridge.tokensResetKey}
            contentResetKey={props.scope}
            contentWidth={NATIVE_REVIEW_DIFF_CONTENT_WIDTH}
            rowHeight={nativeReviewDiffStyle.rowHeight}
            onDebug={bridge.onDebug}
          />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="p-4">
          {parsed.kind === "raw" ? (
            <Text className="mb-3 text-sm text-foreground-muted">{parsed.reason}</Text>
          ) : null}
          <Text selectable className="font-mono text-xs text-foreground">
            {props.result.patch}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
