import {
  prepareGitExplorerBranchesDeletion,
  describeGitExplorerMerge,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  GitExplorerBranchStatus,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

export function GitExplorerBranchDeletion(props: {
  readonly references: readonly GitExplorerRef[];
  readonly overview: GitExplorerOverviewResult;
  readonly params: GitExplorerParams;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
  readonly unavailableReason: string | null;
}) {
  const [captured] = useState(() => ({
    target: gitExplorerTarget(props.params),
    snapshotId: props.overview.snapshotId,
    references: props.references,
  }));
  const readStatuses = useAtomCommand(gitExplorerEnvironment.readBranchStatuses, {
    reportFailure: false,
  });
  const deleteBranch = useAtomCommand(gitExplorerEnvironment.deleteBranch, {
    reportFailure: false,
  });
  const [statuses, setStatuses] = useState<GitExplorerBranchStatus[] | null>(null);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const safeReview = statuses
    ? prepareGitExplorerBranchesDeletion(captured.references, statuses)
    : null;
  const forceReview = statuses
    ? prepareGitExplorerBranchesDeletion(captured.references, statuses, true)
    : null;
  const review = force ? forceReview : safeReview;
  const forceCount = (forceReview?.eligible.length ?? 0) - (safeReview?.eligible.length ?? 0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const statuses: GitExplorerBranchStatus[] = [];
      for (let offset = 0; offset < captured.references.length; offset += 32) {
        const result = await readStatuses({
          ...captured.target,
          input: {
            ...captured.target.input,
            snapshotId: captured.snapshotId,
            branches: captured.references.slice(offset, offset + 32).map((ref) => ref.name),
          },
        });
        if (!active) return;
        if (result._tag !== "Success") {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Could not review branches.");
          return;
        }
        statuses.push(...result.value.branches);
      }
      if (active) setStatuses(statuses);
    };
    void load();
    return () => {
      active = false;
    };
  }, [captured, readStatuses]);
  const remove = async () => {
    if (!review || inFlight.current || props.unavailableReason !== null) return;
    inFlight.current = true;
    setPending(true);
    const completed = new Set(deleted);
    try {
      for (const entry of review.eligible) {
        if (completed.has(entry.reference.name)) continue;
        const result = await deleteBranch({
          ...captured.target,
          input: { ...captured.target.input, ...entry.deletion.input },
        });
        if (result._tag !== "Success") {
          const failure = isAtomCommandInterrupted(result)
            ? null
            : squashAtomCommandFailure(result);
          setError(
            `${completed.size} branches deleted. Deletion stopped: ${failure instanceof Error ? failure.message : "Refresh and review the remaining branches."}`,
          );
          return;
        }
        completed.add(entry.reference.name);
        setDeleted(new Set(completed));
      }
      props.onClose();
    } finally {
      inFlight.current = false;
      setPending(false);
      props.onRefresh();
    }
  };
  const remaining = review?.eligible.filter((entry) => !deleted.has(entry.reference.name)) ?? [];
  const statusesByName = new Map(statuses?.map((status) => [status.name, status]));
  const rows = [
    ...remaining.map(({ reference, deletion }) => ({
      reference,
      description: deletion.input.force
        ? "Force delete"
        : describeGitExplorerMerge(statusesByName.get(reference.name)),
    })),
    ...(review?.skipped.map(({ reference, reason }) => ({
      reference,
      description: `Keep: ${reason}`,
    })) ?? []),
  ];
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!pending) props.onClose();
      }}
    >
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-card">
          <FlatList
            data={rows}
            keyExtractor={({ reference }) => reference.name}
            ListHeaderComponent={
              <View className="gap-3 p-3">
                <Text accessibilityRole="header" className="font-t3-semibold text-foreground">
                  Delete selected branches
                </Text>
                <Text className="text-foreground-muted">
                  Review the local branches below. Remote branches and worktree files are unchanged.
                </Text>
                {error ? (
                  <Text accessibilityRole="alert" className="text-danger-foreground">
                    {error}
                  </Text>
                ) : null}
                {props.unavailableReason ? (
                  <Text className="text-foreground-muted">{props.unavailableReason}</Text>
                ) : null}
                {!review && !error ? (
                  <Text className="text-foreground-muted">Checking branches…</Text>
                ) : null}
                {forceCount > 0 ? (
                  <View className="gap-2">
                    <View className="flex-row items-center gap-2">
                      <Text className="flex-1 text-foreground">
                        Force delete unmerged or unverified branches ({forceCount})
                      </Text>
                      <ThemedSwitch
                        accessibilityLabel="Force delete unmerged or unverified branches"
                        value={force}
                        onValueChange={setForce}
                        disabled={pending || deleted.size > 0}
                      />
                    </View>
                    <Text className="text-foreground-muted">
                      This can lose commits that are not saved on another branch. Checked-out and
                      protected branches are kept.
                    </Text>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <View className="gap-1 px-3 py-2">
                <Text className="font-t3-medium text-foreground">{item.reference.shortName}</Text>
                <Text className="text-foreground-muted">{item.description}</Text>
              </View>
            )}
          />
          <View className="flex-row flex-wrap gap-2 p-3">
            <Button label="Cancel" disabled={pending} onPress={props.onClose} />
            <Button
              label={
                pending
                  ? `Deleting… (${deleted.size}/${review?.eligible.length ?? 0})`
                  : `${force ? "Force delete" : "Delete"} ${remaining.length} branches`
              }
              tone="danger"
              disabled={
                pending || !remaining.length || error !== null || props.unavailableReason !== null
              }
              onPress={() => void remove()}
            />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
