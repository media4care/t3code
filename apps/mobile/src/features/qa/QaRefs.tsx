import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { QaCheckout, QaRefSummary } from "@t3tools/contracts";
import { qaCheckoutLabel } from "@t3tools/client-runtime/qa";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";

const OTHER_REF = "\u0000other";

/** Picks the branch or tag QA shows and runs: one QA knows, or any other by name. */
export function QaRefMenu({
  value,
  refs,
  onChange,
}: {
  value: string;
  refs: ReadonlyArray<QaRefSummary>;
  onChange: (ref: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const known = refs.some((summary) => summary.ref === value)
    ? refs.map((summary) => summary.ref)
    : [value, ...refs.map((summary) => summary.ref)];
  const submit = () => {
    const ref = draft.trim();
    if (ref) onChange(ref);
    setTyping(false);
    setDraft("");
  };
  return (
    <>
      <ListFilterMenu
        label={value}
        accessibilityLabel="Branch or tag"
        actions={[
          ...known.map((ref) => ({
            id: ref,
            title: ref,
            ...(refs.find((summary) => summary.ref === ref)?.isDefault
              ? { subtitle: "Default branch" }
              : {}),
            state: ref === value ? ("on" as const) : ("off" as const),
          })),
          { id: OTHER_REF, title: "Other branch or tag…" },
        ]}
        onSelect={(id) => {
          if (id === OTHER_REF) setTyping(true);
          else onChange(id);
        }}
      />
      {typing ? (
        <View className="w-full flex-row items-center gap-2">
          <TextInput
            autoFocus
            accessibilityLabel="Branch or tag"
            placeholder="Branch or tag, such as v26.10"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            className="min-h-11 flex-1 rounded-xl border border-border-subtle p-3 text-foreground"
          />
          <Button label="Show" size="compact" disabled={!draft.trim()} onPress={submit} />
        </View>
      ) : null}
    </>
  );
}

/** Where QA's own checkout of the ref stands, and the way to remove it. */
export function QaCheckoutLine({
  gitRef,
  checkout,
  canDelete,
  onDelete,
}: {
  gitRef: string;
  checkout: QaCheckout;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <View className="gap-2">
      <Text
        accessibilityRole={checkout.state === "failed" ? "alert" : undefined}
        className={
          checkout.state === "failed" ? "text-sm text-danger" : "text-sm text-foreground-muted"
        }
      >
        {qaCheckoutLabel(gitRef, checkout)}
      </Text>
      {checkout.error ? (
        <Text selectable className="font-mono text-xs text-foreground-muted">
          {checkout.error}
        </Text>
      ) : null}
      {checkout.state === "ready" || checkout.state === "failed" ? (
        <Button
          label="Delete checkout"
          icon="trash"
          tone="text"
          size="compact"
          disabled={!canDelete}
          onPress={onDelete}
        />
      ) : null}
    </View>
  );
}

/** How each tested ref is doing, to switch to one; the web lists every suite side by side. */
export function QaRefComparison({
  refs,
  selected,
  onSelect,
}: {
  refs: ReadonlyArray<QaRefSummary>;
  selected: string;
  onSelect: (ref: string) => void;
}) {
  const tested = refs.filter((summary) => summary.results.length > 0);
  if (tested.length < 2) return null;
  return (
    <View className="gap-2">
      <Text className="text-lg font-t3-semibold">Branches and tags</Text>
      {tested.map(({ ref, results }) => {
        const failing = results.filter((result) => result.status !== "passed").length;
        return (
          <Pressable
            key={ref}
            accessibilityRole="button"
            accessibilityState={{ selected: ref === selected }}
            accessibilityLabel={`Show ${ref}`}
            onPress={() => onSelect(ref)}
            className={`gap-1 rounded-xl border p-4 ${ref === selected ? "border-primary" : "border-border-subtle"}`}
          >
            <Text className="font-mono font-t3-semibold">{ref}</Text>
            <Text className={failing ? "text-sm text-danger" : "text-sm text-foreground-muted"}>
              {results.length - failing} passed
              {failing ? ` · ${failing} not passing` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
