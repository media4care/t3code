import { useAtomValue } from "@effect/atom-react";
import type { ThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { Platform, ScrollView, View } from "react-native";
import { ScreenStack } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/ui/AndroidScreenHeader";
import { environmentThreadDetails } from "../../state/threads";
import { NativeStackScreenOptions, nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { NativeHeader, NativeScreen } from "../../native/ThemedScreenStack";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { ThreadAgentMap } from "./ThreadAgentMap";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

const EMPTY_TURN_SUBAGENTS_ATOM = Atom.make<ThreadTurnSubagents | null>(null).pipe(
  Atom.withLabel("mobile-thread-turn-subagents:empty"),
);
const EMPTY_THREAD_ATOM = Atom.make(null);

export function useThreadAgentCount(target: AgentsTarget | null): number {
  return useAtomValue(
    target === null ? EMPTY_THREAD_ATOM : environmentThreadDetails.threadAtom(target),
    (thread) => thread?.projection.subagents.length ?? 0,
  );
}

export function useThreadTurnSubagents(target: AgentsTarget | null): ThreadTurnSubagents | null {
  return useAtomValue(
    target === null
      ? EMPTY_TURN_SUBAGENTS_ATOM
      : environmentThreadDetails.turnSubagentsAtom(target),
  );
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const { layout } = useAdaptiveWorkspaceLayout();
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const insets = useSafeAreaInsets();
  const openChildThread = (child: { environmentId: EnvironmentId; threadId: ThreadId }) => {
    void Haptics.selectionAsync();
    if (
      openInspector(target, {
        type: "thread",
        environmentId: child.environmentId,
        threadId: child.threadId,
      })
    )
      return;
    // Replace this leaf sheet so the child enters the workspace stack expected by Home's Back button.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: child.environmentId,
        threadId: child.threadId,
      }),
    );
  };

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      // UIKit must inset content beneath the floating translucent iOS header.
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      <ThreadAgentMap target={target} onOpen={openChildThread} />
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    // Plain formSheets lack stack headers; host one in a nested native stack.
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <ScreenStack style={{ flex: 1 }}>
          <NativeScreen
            activityState={2}
            enabled
            isNativeStack
            screenId="thread-agents-sheet-native"
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            className="flex-1 bg-sheet"
          >
            {content}
            <NativeHeader
              backgroundColor="rgba(0,0,0,0)"
              tintColorClassName="accent-foreground"
              hideBackButton
              hideShadow={false}
              title="Agents"
              titleColorClassName="accent-foreground"
              titleFontSize={18}
              titleFontWeight="800"
              translucent
            />
          </NativeScreen>
        </ScreenStack>
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AndroidSheetHeader title="Agents" onBack={() => navigation.goBack()} />
      <ScreenContent insetHorizontal={layout.usesSplitView}>{content}</ScreenContent>
    </View>
  );
}
