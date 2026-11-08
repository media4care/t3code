import { assert, it } from "@effect/vitest";

import { frictionSignature, mergeFrictionClusters } from "./toolFriction.ts";

it("groups real tool failures by program, exit code and normalized diagnostic", () => {
  const cases = [
    [
      `/bin/zsh -lc "grep -n foo a.ts | head -30; echo ======; grep -n bar b.ts"`,
      "682: foo\n(eval):1: ===== not found",
      null,
      "shell · exit ? · (eval):N: == not found",
      false,
    ],
    [
      `/bin/zsh -lc "ls -la release; rg -n 'x' scripts/desktop* 2>/dev/null"`,
      "staple.log\nzsh:1: no matches found: scripts/desktop*\n",
      1,
      "shell · exit 1 · zsh:N: no matches found: <path>",
      false,
    ],
    [
      `/bin/zsh -lc "cd /Users/me/app && sed -n 1,40p src/missing.ts"`,
      "sed: src/missing.ts: No such file or directory",
      1,
      "sed · exit 1 · sed: <path>: No such file or directory",
      false,
    ],
    [
      "vp test run src/insights",
      " Test Files  1 failed (1)\n      Tests  2 failed | 7 passed (9)",
      1,
      "vp test · exit 1 · Tests N failed",
      false,
    ],
    [
      `/bin/zsh -lc "cd apps/web && rg -n 'useThing' src"`,
      "",
      1,
      "rg · exit 1 · (no error output)",
      true,
    ],
    ["rg -n useThing src | head", "", 1, "shell · exit 1 · (no error output)", false],
    [
      "FORCE_COLOR=0 vp run dev --home-dir .t3",
      "[dev-runner] ready\n",
      130,
      "vp run · exit 130 · stopped by a signal",
      false,
    ],
    [
      `/bin/zsh -lc "sed -n 1,20p src/a.ts; cat src/missing.ts"`,
      "export const a = 1;\ncat: src/missing.ts: No such file or directory",
      1,
      "cat · exit 1 · cat: <path>: No such file or directory",
      false,
    ],
    [
      `/bin/zsh -lc "rg -n showError src; yarn lint"`,
      '12:  showError(t("save.failed"));\nsrc/b.ts:4: if (error) {\nerror Command failed with exit code 1.',
      1,
      "shell · exit 1 · (no error output)",
      false,
    ],
  ] as const;
  for (const [command, output, exitCode, key, harmless] of cases)
    assert.deepInclude(frictionSignature({ toolName: null, command, output, exitCode }), {
      key,
      harmless,
    });
  assert.deepInclude(
    frictionSignature({
      toolName: "t3-code.preview_snapshot",
      command: '{"tabId":"tab_2"}',
      output:
        '{"error":{"_tag":"PreviewAutomationTimeoutError","message":"Preview automation snapshot timed out after 15000ms."}}',
      exitCode: null,
    }),
    { key: "preview_snapshot · exit ? · Preview automation snapshot timed out after Nms." },
  );
});

it("merges clusters from several environments", () => {
  const cluster = {
    key: "sed · exit 1 · missing",
    family: "sed",
    exitCode: 1,
    signature: "missing",
    harmless: false,
  };
  assert.deepEqual(
    mergeFrictionClusters([
      [{ ...cluster, failures: 2, tasks: 1, maxPerTask: 2, evidenceIds: ["a", "b"] }],
      [{ ...cluster, failures: 3, tasks: 2, maxPerTask: 1, evidenceIds: ["c", "d"] }],
    ]),
    [{ ...cluster, failures: 5, tasks: 3, maxPerTask: 2, evidenceIds: ["a", "b", "c"] }],
  );
});
