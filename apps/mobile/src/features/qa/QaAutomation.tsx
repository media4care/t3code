import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import {
  QaScheduleConfiguration,
  type EnvironmentId,
  type ProjectId,
  type QaSnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  decodeQaCiReport,
  QA_CI_REPORT_EXAMPLE,
  qaDefaultSchedule,
  qaScheduleLabel,
  qaRunSource,
  qaStatusLabel,
} from "@t3tools/client-runtime/qa";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const isScheduleConfiguration = Schema.is(QaScheduleConfiguration);

export function QaAutomation({
  environmentId,
  projectId,
  snapshot,
  connected,
  onView,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  snapshot: QaSnapshot;
  connected: boolean;
  onView: (id: string) => void;
}) {
  const save = useAtomCommand(serverEnvironment.setQaSchedule);
  const importReport = useAtomCommand(serverEnvironment.importQaReport);
  const canSchedule = useAtomValue(serverEnvironment.setQaSchedule.permissionAtom(environmentId));
  const canImport = useAtomValue(serverEnvironment.importQaReport.permissionAtom(environmentId));
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const schedule = snapshot.schedule;
  const target = schedule?.configuration.target;
  const configure = async (configuration: QaScheduleConfiguration | null) => {
    if (configuration && !isScheduleConfiguration(configuration)) {
      setMessage("Enter a valid time, time zone, branch, and interval of at least one minute.");
      return;
    }
    setBusy(true);
    const result = await save({ environmentId, input: { projectId, configuration } }).finally(() =>
      setBusy(false),
    );
    if (result._tag === "Success") {
      setEditing(false);
      setMessage(null);
    }
  };
  const submit = async () => {
    let decoded;
    try {
      decoded = decodeQaCiReport(report);
    } catch {
      setMessage(
        "Use the CI report JSON format below, including revision, times, exit code, and JUnit XML.",
      );
      return;
    }
    setBusy(true);
    const result = await importReport({
      environmentId,
      input: { projectId, report: decoded },
    }).finally(() => setBusy(false));
    if (result._tag === "Success") {
      setReport("");
      setMessage("CI result saved.");
      onView(result.value.id);
    }
  };
  return (
    <>
      <View className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
        <Text className="text-lg font-t3-semibold">Recurring runs</Text>
        <Text className="text-xs text-foreground-muted">
          Runs on this environment while its server is online, using the selected branch and current
          working files.
        </Text>
        {schedule ? (
          <>
            <Text>
              {schedule.configuration.enabled ? "Enabled" : "Paused"} ·{" "}
              {qaScheduleLabel(schedule.configuration)}
            </Text>
            <Text>
              {target?.type === "suite"
                ? (snapshot.suites.find((suite) => suite.id === target.suiteId)?.name ??
                  "Removed suite")
                : target?.type === "all"
                  ? "All suites"
                  : "Affected suites"}{" "}
              · {schedule.configuration.branch}
            </Text>
            <Text className="text-sm text-foreground-muted">
              Next: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "Paused"}
              {"\n"}Last: {schedule.lastStatus}
              {schedule.lastRunAt ? ` · ${new Date(schedule.lastRunAt).toLocaleString()}` : ""}
            </Text>
            {schedule.note ? <Text>{schedule.note}</Text> : null}
          </>
        ) : (
          <Text className="text-sm text-foreground-muted">No schedule yet.</Text>
        )}
        {editing ? (
          <ScheduleEditor
            key={schedule?.revision ?? "new"}
            initial={schedule?.configuration ?? qaDefaultSchedule(snapshot.branch ?? "")}
            suites={snapshot.suites}
            disabled={!connected || !canSchedule || busy}
            onSave={configure}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={schedule ? "Edit schedule" : "Add schedule"}
              disabled={!connected || !canSchedule || busy}
              onPress={() => setEditing(true)}
            />
            {schedule ? (
              <>
                <Button
                  label={schedule.configuration.enabled ? "Pause schedule" : "Resume schedule"}
                  disabled={!connected || !canSchedule || busy}
                  onPress={() => {
                    void configure({
                      ...schedule.configuration,
                      enabled: !schedule.configuration.enabled,
                    });
                  }}
                />
                <Button
                  label="Remove schedule"
                  tone="text"
                  disabled={!connected || !canSchedule || busy}
                  onPress={() => {
                    void configure(null);
                  }}
                />
              </>
            ) : null}
          </View>
        )}
        {schedule?.lastStatus === "running" ? (
          <Text className="text-xs text-foreground-muted">
            Pausing leaves the active run running. Use Stop queued run to cancel it.
          </Text>
        ) : null}
      </View>
      <View className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
        <Text className="text-lg font-t3-semibold">CI results</Text>
        <Text className="text-xs text-foreground-muted">
          Results from CI have their own revision and environment. Local freshness is checked
          separately.
        </Text>
        {snapshot.latestCiRuns?.length ? (
          snapshot.latestCiRuns.map((run) => (
            <Pressable
              key={run.id}
              accessibilityRole="button"
              accessibilityLabel={`View CI ${run.suite.name} run`}
              onPress={() => onView(run.id)}
              className="gap-1 rounded-xl border border-border-subtle p-3"
            >
              <Text className="font-t3-semibold">
                {run.suite.name} · {qaStatusLabel(run)}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {qaRunSource(run)} · {run.branch} · {run.commit?.slice(0, 8)}
                {"\n"}
                {new Date(run.finishedAt ?? run.startedAt).toLocaleString()}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">No imported results yet.</Text>
        )}
        <Button
          label={importing ? "Close import" : "Import CI report"}
          tone="text"
          onPress={() => setImporting(!importing)}
        />
        {importing ? (
          <>
            <TextInput
              accessibilityLabel="CI report JSON"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={8 * 1024 * 1024}
              value={report}
              onChangeText={setReport}
              placeholder="Paste report JSON"
              className="min-h-32 max-h-64 rounded-xl border border-border-subtle p-3 font-mono text-xs text-foreground"
            />
            <Button
              label="Import result"
              disabled={!connected || !canImport || busy || !report.trim()}
              onPress={() => {
                void submit();
              }}
            />
            <Text className="text-xs text-foreground-muted">
              CI can POST {"{projectId, report}"} to /api/qa/import using an environment bearer
              token with terminal:operate permission. Use a unique run ID per attempt and suite.
              JUnit XML is limited to 2 MiB.
            </Text>
            <Text selectable className="font-mono text-xs">
              {QA_CI_REPORT_EXAMPLE}
            </Text>
          </>
        ) : null}
      </View>
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </>
  );
}

function ScheduleEditor({
  initial,
  suites,
  disabled,
  onSave,
  onCancel,
}: {
  initial: QaScheduleConfiguration;
  suites: QaSnapshot["suites"];
  disabled: boolean;
  onSave: (value: QaScheduleConfiguration) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const options = [
    { id: "all", title: "All suites" },
    { id: "affected", title: "Affected suites" },
    ...suites.map((suite) => ({ id: `suite:${suite.id}`, title: suite.name })),
  ];
  const target =
    value.target.type === "suite" ? `suite:${value.target.suiteId}` : value.target.type;
  return (
    <View className="gap-3">
      <Menu
        actions={options.map((item) => ({ ...item, state: item.id === target ? "on" : "off" }))}
        onPressAction={({ nativeEvent }) => {
          const id = nativeEvent.event;
          setValue({
            ...value,
            target:
              id === "all" || id === "affected"
                ? { type: id }
                : { type: "suite", suiteId: id.slice(6) },
          });
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scheduled suites"
          className="min-h-11 justify-center rounded-xl border border-border-subtle px-3"
        >
          <Text>{options.find((item) => item.id === target)?.title ?? "Select suites"} ▾</Text>
        </Pressable>
      </Menu>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="At a fixed time"
          tone={value.timing.type === "fixed_time" ? "primary" : "text"}
          onPress={() => setValue({ ...value, timing: { type: "fixed_time", timeOfDay: "09:00" } })}
        />
        <Button
          label="Every N minutes"
          tone={value.timing.type === "interval" ? "primary" : "text"}
          onPress={() => setValue({ ...value, timing: { type: "interval", everyMs: 86_400_000 } })}
        />
      </View>
      {value.timing.type === "fixed_time" ? (
        <>
          <QaField
            label="Time (HH:MM)"
            value={value.timing.timeOfDay}
            onChange={(timeOfDay) => {
              if (value.timing.type === "fixed_time")
                setValue({ ...value, timing: { ...value.timing, timeOfDay } });
            }}
          />
          <Text className="text-xs text-foreground-muted">Days · none selected means daily</Text>
          <View className="flex-row flex-wrap gap-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
              <Pressable
                key={day}
                accessibilityRole="checkbox"
                accessibilityLabel={day}
                accessibilityState={{
                  checked:
                    value.timing.type === "fixed_time" &&
                    (value.timing.weekdays?.includes(index) ?? false),
                }}
                onPress={() => {
                  if (value.timing.type === "fixed_time")
                    setValue({
                      ...value,
                      timing: {
                        ...value.timing,
                        weekdays: value.timing.weekdays?.includes(index)
                          ? value.timing.weekdays.filter((item) => item !== index)
                          : [...(value.timing.weekdays ?? []), index],
                      },
                    });
                }}
                className="min-h-11 justify-center rounded-lg border border-border-subtle px-2"
              >
                <Text>
                  {value.timing.type === "fixed_time" && value.timing.weekdays?.includes(index)
                    ? "✓ "
                    : ""}
                  {day}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <QaField
          label="Interval in minutes"
          value={String(value.timing.everyMs / 60_000)}
          onChange={(minutes) =>
            setValue({ ...value, timing: { type: "interval", everyMs: Number(minutes) * 60_000 } })
          }
        />
      )}
      <QaField
        label="Time zone"
        value={value.timeZone}
        onChange={(timeZone) => setValue({ ...value, timeZone })}
      />
      <QaField
        label="Branch"
        value={value.branch}
        onChange={(branch) => setValue({ ...value, branch })}
      />
      <Text className="text-xs text-foreground-muted">
        Other branches are skipped. Fixed times missed by more than 10 minutes are skipped;
        intervals resume once.
      </Text>
      <View className="flex-row gap-2">
        <Button
          label="Save schedule"
          disabled={disabled}
          onPress={() => {
            void onSave(value);
          }}
        />
        <Button label="Cancel" tone="text" onPress={onCancel} />
      </View>
    </View>
  );
}

function QaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs text-foreground-muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-11 rounded-xl border border-border-subtle p-3 text-foreground"
      />
    </View>
  );
}
