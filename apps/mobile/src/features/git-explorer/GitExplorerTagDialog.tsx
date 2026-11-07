import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerOverviewResult } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Modal, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

export type GitExplorerTagRequest = {
  action: "create" | "push" | "delete";
  revision: string;
  name: string;
};

export function GitExplorerTagDialog(props: {
  params: GitExplorerParams;
  overview: GitExplorerOverviewResult;
  request: GitExplorerTagRequest;
  unavailable: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const surfaceStyle = useResolveClassNames("flex-1 bg-sheet-solid");
  const [captured] = useState(() => ({ overview: props.overview, request: props.request }));
  const target = gitExplorerTarget(props.params);
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const [name, setName] = useState(captured.request.name);
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const [created, setCreated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const remotes = captured.overview.remotes ?? [];
  const [remote, setRemote] = useState(remotes.includes("origin") ? "origin" : (remotes[0] ?? ""));
  const creating = captured.request.action === "create" && !created;
  const deleting = captured.request.action === "delete";
  const needsRemote = !deleting && (!creating || push);
  const submit = async () => {
    if (inFlight.current || props.unavailable || !name.trim() || (needsRemote && !remote)) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const execute = async (action: "create-tag" | "push-tag" | "delete-tag") => {
      const result = await run({
        ...target,
        input: {
          ...target.input,
          action,
          tagName: name.trim(),
          revision: captured.request.revision,
          expectedHead: captured.overview.headHash,
          expectedBranch: captured.overview.headBranch,
          ...(action === "create-tag" ? { message } : action === "push-tag" ? { remote } : {}),
        },
      });
      if (result._tag === "Success") return true;
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Refresh and try again.");
      }
      return false;
    };
    const work = async () => {
      if (creating) {
        if (!(await execute("create-tag"))) return;
        setCreated(true);
        if (!push) {
          props.onClose();
          return;
        }
      }
      if (await execute(deleting ? "delete-tag" : "push-tag")) props.onClose();
    };
    await work()
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "Refresh and try again.");
      })
      .finally(() => {
        inFlight.current = false;
        setPending(false);
        props.onRefresh();
      });
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!pending) props.onClose();
      }}
    >
      <SafeAreaProvider style={{ flex: 1 }}>
        <SafeAreaView style={surfaceStyle}>
          <KeyboardAvoidingView automaticOffset style={{ flex: 1 }} behavior="padding">
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text accessibilityRole="header" className="text-xl font-t3-semibold text-foreground">
                {deleting ? "Delete local tag" : creating ? "Add tag" : "Push tag"}
              </Text>
              <Text className="text-foreground-muted">
                {deleting
                  ? "Delete the local tag. A tag already pushed to a remote is kept there."
                  : `Commit ${captured.request.revision.slice(0, 12)}`}
              </Text>
              <TextInput
                accessibilityLabel="Tag name"
                placeholder="Tag name"
                autoCapitalize="none"
                autoCorrect={false}
                editable={creating && !pending}
                value={name}
                onChangeText={setName}
                maxLength={1024}
                className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
                placeholderTextColorClassName="accent-foreground-muted"
              />
              {creating ? (
                <>
                  <TextInput
                    accessibilityLabel="Annotation (optional)"
                    placeholder="Annotation (optional)"
                    editable={!pending}
                    value={message}
                    onChangeText={setMessage}
                    maxLength={10000}
                    className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
                    placeholderTextColorClassName="accent-foreground-muted"
                  />
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-foreground">Push tag to remote</Text>
                    <ThemedSwitch
                      accessibilityLabel="Push tag to remote"
                      value={push}
                      onValueChange={setPush}
                      disabled={pending || remotes.length === 0}
                    />
                  </View>
                </>
              ) : null}
              {needsRemote ? (
                <Menu
                  title="Remote"
                  accessibilityRole="button"
                  accessibilityLabel={`Remote: ${remote || "Choose a remote"}`}
                  actions={remotes.map((name) => ({
                    id: name,
                    title: name,
                    state: name === remote ? "on" : "off",
                    attributes: { disabled: pending },
                  }))}
                  onPressAction={({ nativeEvent }) => {
                    if (!pending) setRemote(nativeEvent.event);
                  }}
                >
                  <Button
                    label={remote || "Choose a remote"}
                    disabled={pending}
                    onPress={() => {}}
                  />
                </Menu>
              ) : null}
              {!deleting && remotes.length === 0 ? (
                <Text className="text-foreground-muted">Configure a Git remote to push tags.</Text>
              ) : null}
              {created && !pending ? (
                <Text accessibilityRole="alert" className="text-foreground">
                  Tag created locally. Retry the push, or close to keep it local.
                </Text>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" className="text-danger-foreground">
                  {error}
                </Text>
              ) : null}
            </ScrollView>
            <View className="flex-row flex-wrap gap-2 p-4">
              <Button
                label={created ? "Close" : "Cancel"}
                disabled={pending}
                onPress={props.onClose}
              />
              <Button
                label={
                  deleting
                    ? "Delete local tag"
                    : creating
                      ? push
                        ? "Add and push tag"
                        : "Add tag"
                      : "Push tag"
                }
                tone={deleting ? "danger" : "primary"}
                loading={pending}
                disabled={props.unavailable || !name.trim() || (needsRemote && !remote)}
                onPress={() => void submit()}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
