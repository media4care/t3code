import * as HostProcess from "@t3tools/shared/HostProcess";

process.env.GIT_CONFIG_GLOBAL =
  HostProcess.Platform.defaultValue() === "win32" ? "NUL" : "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

// Override inherited autocrlf, signing and init-branch settings through env so every git child gets stable fixtures.
const entries: ReadonlyArray<readonly [key: string, value: string]> = [
  ["core.autocrlf", "false"],
  ["core.filemode", "false"],
  ["core.longpaths", "true"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  ["init.defaultBranch", "main"],
];

const existing = Number(process.env.GIT_CONFIG_COUNT ?? "0");
process.env.GIT_CONFIG_COUNT = String(existing + entries.length);
entries.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${existing + index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${existing + index}`] = value;
});
