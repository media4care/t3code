import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as ThreadSkills from "./ThreadSkills.ts";

const database = NodeSqliteClient.layer({ filename: ":memory:" });
const layer = it.layer(Layer.merge(database, ThreadSkills.layer.pipe(Layer.provide(database))));

const threadId = ThreadId.make("thread-skills");

const insertRun = (runId: string, ordinal: number, status: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES (${runId}, ${threadId}, ${ordinal}, 'claudeAgent', ${status}, '2026-01-01', '{}')
    `;
  });

const insertTool = (input: {
  readonly id: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly toolName?: string;
  readonly type?: "dynamic_tool" | "command_execution";
  readonly exitCode?: number;
  readonly output?: string;
  readonly input: unknown;
  readonly status?: string;
  readonly thread?: ThreadId;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const payload = JSON.stringify({
      toolName: input.toolName,
      input: input.input,
      exitCode: input.exitCode,
      output: input.output,
    });
    yield* sql`
      INSERT INTO orchestration_v2_projection_turn_items
        (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
      VALUES (
        ${input.id}, ${input.thread ?? threadId}, ${input.runId}, ${input.ordinal},
        ${input.type ?? "dynamic_tool"}, ${input.status ?? "completed"}, '2026-01-01', ${payload}
      )
    `;
  });

layer("ThreadSkills", (it) => {
  it.effect("lists skills loaded by provider skill tools in first-use order", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* insertRun("run-a", 1, "completed");
      yield* insertRun("run-rolled-back", 2, "rolled_back");
      yield* insertTool({
        id: "claude-review",
        runId: "run-a",
        ordinal: 1,
        toolName: "Skill",
        input: { skill: "code-review", args: "--strict" },
      });
      yield* insertTool({
        id: "opencode-greet",
        runId: "run-a",
        ordinal: 2,
        toolName: "skill",
        input: { name: "greet" },
      });
      yield* insertTool({
        id: "claude-review-again",
        runId: "run-a",
        ordinal: 3,
        toolName: "Skill",
        input: { skill: "code-review" },
      });
      yield* insertTool({
        id: "other-tool",
        runId: "run-a",
        ordinal: 4,
        toolName: "Read",
        input: { skill: "not-a-skill" },
      });
      yield* insertTool({
        id: "unknown-skill",
        runId: "run-a",
        ordinal: 5,
        toolName: "Skill",
        input: { skill: "missing" },
        status: "failed",
      });
      yield* insertTool({
        id: "rolled-back-skill",
        runId: "run-rolled-back",
        ordinal: 6,
        toolName: "Skill",
        input: { skill: "rewound" },
      });
      yield* insertTool({
        id: "other-thread-skill",
        runId: "run-a",
        ordinal: 7,
        toolName: "Skill",
        input: { skill: "elsewhere" },
        thread: ThreadId.make("thread-other"),
      });

      const threadSkills = yield* ThreadSkills.ThreadSkills;
      assert.deepEqual(yield* threadSkills.list(threadId), ["code-review", "greet"]);
      assert.deepEqual(yield* threadSkills.forRun("run-rolled-back"), ["rewound"]);
    }),
  );

  it.effect("counts explicit skill reads once per run without counting mentions or writes", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* insertRun("reads", 3, "completed");
      yield* insertRun("reads-again", 4, "completed");
      const commands = [
        "cat .claude/skills/smart-review/SKILL.md | head -150",
        `/bin/zsh -lc "sed -n '1,180p' .agents/skills/engineering-loop/SKILL.md; cat .claude/skills/smart-review/SKILL.md"`,
        `head -n 80 '/workspace with spaces/skills/test-t3-app/SKILL.md'`,
        "tail -30 .agents/skills/smart-review/SKILL.md",
        // These mention paths without reading skill instructions.
        "echo 'cat .agents/skills/echo-only/SKILL.md'",
        "ls .agents/skills/list-only/SKILL.md",
        "rg --files .agents/skills/catalog-only/SKILL.md",
        "sed -i 's/a/b/' .agents/skills/edit-only/SKILL.md",
        "printf '%s' text > .agents/skills/write-only/SKILL.md",
        "cat <<'EOF'\ncat .agents/skills/heredoc-only/SKILL.md\nEOF",
        "cat .agent-work/GH-5803/engineering-loop.md",
        "cat .agents/skills/reference-only/references/guide.md",
        "cat README.md",
        "cat ./SKILL.md",
        "cat ../SKILL.md",
      ];
      for (const [ordinal, input] of commands.entries())
        yield* insertTool({
          id: `command-${ordinal}`,
          runId: "reads",
          ordinal,
          type: "command_execution",
          input,
          output: "Available: .agents/skills/output-only/SKILL.md",
        });
      yield* insertTool({
        id: "read-file",
        runId: "reads",
        ordinal: 20,
        toolName: "Read",
        input: { file_path: "/home/.agents/skills/native-data-fetching/SKILL.md" },
      });
      yield* insertTool({
        id: "read-windows",
        runId: "reads",
        ordinal: 21,
        toolName: "read_file",
        input: { path: "C:\\skills\\windows-skill\\SKILL.md" },
      });
      yield* insertTool({
        id: "native-duplicate",
        runId: "reads",
        ordinal: 22,
        toolName: "Skill",
        input: { skill: "smart-review" },
      });
      yield* insertTool({
        id: "failed-read",
        runId: "reads",
        ordinal: 23,
        toolName: "Read",
        input: { file_path: "/skills/failed/SKILL.md" },
        status: "failed",
      });
      yield* insertTool({
        id: "failed-command",
        runId: "reads",
        ordinal: 24,
        type: "command_execution",
        input: "cat /skills/nonzero/SKILL.md",
        exitCode: 1,
      });
      yield* insertTool({
        id: "pending-read",
        runId: "reads",
        ordinal: 25,
        toolName: "Read",
        input: { file_path: "/skills/pending/SKILL.md" },
        status: "running",
      });
      yield* insertTool({
        id: "write-file",
        runId: "reads",
        ordinal: 26,
        toolName: "Write",
        input: { file_path: "/skills/written/SKILL.md" },
      });
      yield* insertTool({
        id: "another-run",
        runId: "reads-again",
        ordinal: 27,
        type: "command_execution",
        input: "cat /skills/engineering-loop/SKILL.md",
      });
      const skills = yield* ThreadSkills.ThreadSkills;
      assert.deepEqual(yield* skills.forRun("reads"), [
        "smart-review",
        "engineering-loop",
        "test-t3-app",
        "native-data-fetching",
        "windows-skill",
      ]);
      assert.deepEqual(yield* skills.forRun("reads-again"), ["engineering-loop"]);
    }),
  );
});
