import type { InsightFrictionCluster } from "@t3tools/contracts";

const SETUP_COMMAND =
  /^(?:cd|export|set|source|\.|unset|ulimit|true)\b|^[A-Za-z_][A-Za-z0-9_]*=\S*$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
const SUBCOMMAND_PROGRAMS = new Set([
  "git",
  "gh",
  "vp",
  "pnpm",
  "npm",
  "yarn",
  "bun",
  "xcrun",
  "docker",
]);
const SEARCH_FAMILIES = new Set(["rg", "grep", "git grep"]);
/** Search hits (`12:` or `file.ts:12:`) and source lines quote code, not a failure. */
const QUOTED_SOURCE = /^(?:[^\s:()]*[./][^\s:]*:)?\d+[:-]|[;{}]$/;
/** Exit-status footers repeat the code without saying what failed. */
const GENERIC_FOOTER =
  /^(?:error )?Command failed with exit code|^Exit code \d+$|^ELIFECYCLE|script failed \(code \d+\)$/i;
const DIAGNOSTIC =
  /error|fatal|not found|no such|no matches|denied|failed|cannot|can't|could not|invalid|unknown|exception|refused|timed out|not allowed/i;

/** The shell command a wrapper like `/bin/zsh -lc "…"` runs. */
const unwrap = (command: string) => {
  const wrapped = /^\S*\b(?:ba|z)?sh\s+-l?c\s+(["'])([\s\S]*)\1\s*$/.exec(command.trim());
  return wrapped ? wrapped[2]! : command.trim();
};

/** Program (plus subcommand where it names the action) of each step that is not setup. */
const commandSteps = (command: string) =>
  unwrap(command)
    .split(/&&|\|\||;|\||\n/)
    .map((step) => {
      let text = step.trim();
      while (ASSIGNMENT.test(text)) text = text.replace(ASSIGNMENT, "");
      return text;
    })
    .filter((step) => step && !step.startsWith("#") && !SETUP_COMMAND.test(step))
    .map((step) => {
      const [program = "", ...args] = step.split(/\s+/);
      const name = program.split("/").at(-1) ?? program;
      const action = args.find((arg) => !arg.startsWith("-"));
      return SUBCOMMAND_PROGRAMS.has(name) && action ? `${name} ${action}` : name;
    });

const normalize = (line: string) =>
  line
    .replace(/^(?:Error:\s*)+(?:[^:]{1,60} failed:\s*)?/, "")
    .replace(/[\w.~-]*\/[^\s"'`:)]+/g, "<path>")
    .replace(
      /\b[\w-]+(?:\.[\w-]+)*\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml|lock|sh|py|rs|go|swift|kt|java|css|html|txt|log|sqlite|plist)\b/g,
      "<path>",
    )
    .replace(/(["'`])[^"'`]{1,200}\1/g, "$1…$1")
    .replace(/\b[0-9a-f]{7,40}\b/gi, "<hash>")
    .replace(/={2,}/g, "==")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(Tests N failed)\b.*/, "$1")
    .slice(0, 160);

/** Tool errors often arrive as JSON; their `message` is the diagnostic. */
const diagnosticLine = (output: string) => {
  const message = [...output.matchAll(/\\?"message\\?":\s*\\?"((?:[^"\\]|\\.)*?)\\?"/g)].at(
    -1,
  )?.[1];
  if (message) return message;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast(
      (line) => DIAGNOSTIC.test(line) && !QUOTED_SOURCE.test(line) && !GENERIC_FOOTER.test(line),
    );
};

/**
 * Groups a failing tool call with others that failed the same way: by its program, exit code and
 * last diagnostic-looking output line. A compound command takes the program its diagnostic names
 * (`cat: …`), else "shell". Only a lone search that found nothing is harmless.
 */
export function frictionSignature(input: {
  readonly toolName: string | null;
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
}) {
  const steps = input.toolName ? [] : commandSteps(input.command);
  const diagnostic = diagnosticLine(input.output);
  const named = diagnostic?.match(/^([\w.-]+):/)?.[1];
  const family = (
    input.toolName
      ? input.toolName.replace(/^(?:mcp__[^_]+(?:-[^_]+)*__|[\w-]+\.)/, "")
      : steps.length === 1
        ? steps[0]!
        : named && steps.some((step) => step.split(" ")[0] === named)
          ? named
          : "shell"
  ).slice(0, 100);
  const stopped = diagnostic === undefined && (input.exitCode === 130 || input.exitCode === 143);
  const signature = diagnostic
    ? normalize(diagnostic)
    : stopped
      ? "stopped by a signal"
      : "(no error output)";
  return {
    key: `${family} · exit ${input.exitCode ?? "?"} · ${signature}`,
    family,
    exitCode: input.exitCode,
    signature,
    harmless:
      SEARCH_FAMILIES.has(family) &&
      steps.length === 1 &&
      input.exitCode === 1 &&
      diagnostic === undefined,
  };
}

const MAX_CLUSTERS = 40;

/** Clusters from several environments as one list, most failures first. */
export function mergeFrictionClusters(
  groups: ReadonlyArray<ReadonlyArray<InsightFrictionCluster> | undefined>,
): InsightFrictionCluster[] {
  const merged = new Map<string, InsightFrictionCluster>();
  for (const cluster of groups.flatMap((group) => group ?? [])) {
    const seen = merged.get(cluster.key);
    merged.set(
      cluster.key,
      seen
        ? {
            ...seen,
            failures: seen.failures + cluster.failures,
            tasks: seen.tasks + cluster.tasks,
            maxPerTask: Math.max(seen.maxPerTask, cluster.maxPerTask),
            evidenceIds: [...seen.evidenceIds, ...cluster.evidenceIds].slice(0, 3),
          }
        : cluster,
    );
  }
  return [...merged.values()]
    .sort((a, b) => b.failures - a.failures || b.tasks - a.tasks || a.key.localeCompare(b.key))
    .slice(0, MAX_CLUSTERS);
}
