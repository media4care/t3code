import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import {
  QA_TEST_PAGE_SIZE,
  type EnvironmentId,
  type ProjectId,
  type QaTestCase,
} from "@t3tools/contracts";
import { QA_TEST_FILTERS, qaTestDuration, type QaTestFilter } from "@t3tools/client-runtime/qa";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";

const RESULTS = {
  passed: {
    label: "Passed",
    style: "bg-adaptive-emerald-500-a12-a16 text-adaptive-emerald-700-300",
  },
  failed: { label: "Failed", style: "bg-danger text-danger-foreground" },
  skipped: { label: "Skipped", style: "bg-warning text-warning-foreground" },
};

export function QaTestList({
  environmentId,
  projectId,
  runId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
}) {
  const [selection, setSelection] = useState({
    search: "",
    status: "all" as QaTestFilter,
    offset: 0,
  });
  const query = useEnvironmentQuery(
    serverEnvironment.qaTests({
      environmentId,
      input: {
        projectId,
        runId,
        search: selection.search,
        offset: selection.offset,
        ...(selection.status === "all" ? {} : { status: selection.status }),
      },
    }),
  );
  const data = query.data;
  return (
    <View className="gap-3">
      <Text className="text-lg font-t3-semibold">Tests</Text>
      <Text className="text-xs text-foreground-muted">Results from this run</Text>
      {query.error ? (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error}
        </Text>
      ) : null}
      {data?.unavailableReason ? (
        <Text className="text-sm text-foreground-muted">{data.unavailableReason}</Text>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search tests"
            placeholder="Search test names, files, or groups…"
            maxLength={200}
            value={selection.search}
            onChangeText={(search) => setSelection({ ...selection, search, offset: 0 })}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-11 rounded-xl border border-border-subtle p-3 text-foreground"
          />
          <Menu
            actions={QA_TEST_FILTERS.map((filter) => ({
              id: filter.value,
              title: filter.label,
              state: filter.value === selection.status ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => {
              const status = QA_TEST_FILTERS.find(
                (filter) => filter.value === nativeEvent.event,
              )?.value;
              if (status) setSelection({ ...selection, status, offset: 0 });
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter tests"
              className="min-h-11 justify-center rounded-xl border border-border-subtle px-3"
            >
              <Text>
                {QA_TEST_FILTERS.find((filter) => filter.value === selection.status)?.label} ▾
              </Text>
            </Pressable>
          </Menu>
          {query.isPending ? (
            <Text className="text-sm text-foreground-muted">Loading tests…</Text>
          ) : null}
          {data ? (
            <>
              <Text className="text-xs text-foreground-muted">
                {data.tests.length
                  ? `${data.offset + 1}–${data.offset + data.tests.length} of ${data.matched} tests`
                  : `0 of ${data.matched} tests`}
                {data.matched !== data.total ? ` · ${data.total} in report` : ""}
              </Text>
              {data.tests.length ? (
                data.tests.map((test) => <TestRow key={test.id} test={test} />)
              ) : (
                <Text className="text-sm text-foreground-muted">
                  {data.total
                    ? "No tests match these filters."
                    : "No individual tests were included in this report."}
                </Text>
              )}
              {selection.search || selection.status !== "all" ? (
                <Button
                  label="Clear test filters"
                  tone="text"
                  onPress={() => setSelection({ search: "", status: "all", offset: 0 })}
                />
              ) : null}
              {data.matched > QA_TEST_PAGE_SIZE || selection.offset > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Previous tests"
                    disabled={!selection.offset || query.isPending}
                    onPress={() =>
                      setSelection({
                        ...selection,
                        offset: Math.max(0, selection.offset - QA_TEST_PAGE_SIZE),
                      })
                    }
                  />
                  <Button
                    label="Next tests"
                    disabled={data.nextOffset === null || query.isPending}
                    onPress={() => {
                      if (data.nextOffset !== null)
                        setSelection({ ...selection, offset: data.nextOffset });
                    }}
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

function TestRow({ test }: { test: QaTestCase }) {
  const [expanded, setExpanded] = useState(false);
  const result = RESULTS[test.status];
  return (
    <View className="gap-2 rounded-xl border border-border-subtle p-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className={`rounded-md px-2 py-1 text-xs ${result.style}`}>{result.label}</Text>
        <Text className="text-xs text-foreground-muted">{qaTestDuration(test)}</Text>
      </View>
      <Text selectable className="font-t3-semibold">
        {test.name}
      </Text>
      {test.group ? <Text className="text-xs text-foreground-muted">{test.group}</Text> : null}
      {test.file && test.file !== test.group ? (
        <Text selectable className="font-mono text-xs text-foreground-muted">
          {test.file}
        </Text>
      ) : null}
      {test.details ? (
        <Button
          label={
            expanded ? "Hide details" : test.status === "failed" ? "Failure details" : "Skip reason"
          }
          tone="text"
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
      {expanded ? (
        <Text selectable className="font-mono text-xs">
          {test.details}
        </Text>
      ) : null}
      {test.truncated ? (
        <Text className="text-xs text-foreground-muted">
          Some fields were shortened. See the full saved report below.
        </Text>
      ) : null}
    </View>
  );
}
