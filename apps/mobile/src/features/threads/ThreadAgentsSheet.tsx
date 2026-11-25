import { useAtomValue } from "@effect/atom-react";
import type { ThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SheetHeader } from "../../components/ui/SheetHeader";
import { environmentThreadDetails } from "../../state/threads";
import { ScreenContent } from "../../components/ui/ScreenContent";
import type { SubagentThreadTarget } from "./threadAgentsPresentation";

import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { ThreadAgentMap } from "./ThreadAgentMap";
import { useOpenLinkedThreadRead } from "./useOpenLinkedThread";

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
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const openLinkedRead = useOpenLinkedThreadRead();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const openChildThread = (child: SubagentThreadTarget, title: string | null = null) => {
    void Haptics.selectionAsync();
    if (child.linked !== undefined) {
      openLinkedRead(child, child.linked, title, { source: target, replace: true });
      return;
    }
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
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      <ThreadAgentMap target={target} onOpen={openChildThread} />
    </ScrollView>
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Agents")} onClose={() => navigation.goBack()} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}
