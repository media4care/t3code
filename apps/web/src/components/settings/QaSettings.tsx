import { QaDeviceSource } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const SOURCES = {
  machine: "This machine",
  simlock: "Simlock on this machine",
} satisfies Record<QaDeviceSource, string>;

/** Which environment runs QA, and where its runs get devices. */
export function QaSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const sourceMixed = useScopedSettingsMixed(["qaDeviceSource"]);
  return (
    <SettingsSection id="qa" title="QA">
      <SettingsRow
        serverScoped
        settingKeys={["qaEnabled"]}
        {...searchableSetting("qa-run-here")}
        description="Run test suites and their schedules on this environment. Turn it off on the other machines that share your projects, so QA lists each project once, on the machine that tests it."
        control={
          <ScopedSwitch
            settingKeys={["qaEnabled"]}
            checked={settings.qaEnabled}
            onCheckedChange={(checked) => updateSettings({ qaEnabled: Boolean(checked) })}
            aria-label="Run QA here"
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["qaDeviceSource"]}
        {...searchableSetting("qa-devices")}
        description={
          <>
            Where suites that list <code>devices</code> get them. Simlock leases a fresh simulator
            or emulator from this machine’s Simlock worker for each run and returns it when the run
            ends. T3 Code never installs Simlock.
          </>
        }
        control={
          <Select
            value={sourceMixed ? null : settings.qaDeviceSource}
            onValueChange={(value) => {
              if (QaDeviceSource.literals.includes(value as QaDeviceSource))
                updateSettings({ qaDeviceSource: value as QaDeviceSource });
            }}
          >
            <SelectTrigger size="sm" aria-label="QA devices">
              <SelectValue>
                {(value: QaDeviceSource | null) => (value === null ? "Mixed" : SOURCES[value])}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {QaDeviceSource.literals.map((source) => (
                <SelectItem key={source} value={source}>
                  {SOURCES[source]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
