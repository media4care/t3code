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
  readonly toolName: string;
  readonly input: unknown;
  readonly status?: string;
  readonly thread?: ThreadId;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const payload = JSON.stringify({ toolName: input.toolName, input: input.input });
    yield* sql`
      INSERT INTO orchestration_v2_projection_turn_items
        (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
      VALUES (
        ${input.id}, ${input.thread ?? threadId}, ${input.runId}, ${input.ordinal},
        'dynamic_tool', ${input.status ?? "completed"}, '2026-01-01', ${payload}
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
    }),
  );
});
