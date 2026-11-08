import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as ThreadEngineeringLoop from "./ThreadEngineeringLoop.ts";

const database = NodeSqliteClient.layer({ filename: ":memory:" });
const layer = it.layer(
  Layer.mergeAll(
    database,
    NodeServices.layer,
    ThreadEngineeringLoop.layer.pipe(Layer.provide(Layer.merge(database, NodeServices.layer))),
  ),
);
const timestamp = "2026-11-01T10:00:00.000Z";

layer("ThreadEngineeringLoop", (it) => {
  it.effect("lists the worksheets each thread wrote a stage into, not ones it only read", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const sql = yield* SqlClient.SqlClient;
      const fs = yield* FileSystem.FileSystem;
      const temp = yield* fs.makeTempDirectoryScoped({ prefix: "t3-thread-loop-" });
      const root = `${temp}/app`;
      const worktree = `${temp}/worktree`;
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('project', 'App', ${root}, '[]', ${timestamp}, ${timestamp})`;
      for (const [id, payload] of [
        ["in-worktree", { worktreePath: worktree }],
        ["in-root", {}],
        ["outside", {}],
      ] as const)
        yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
          VALUES (${id}, 'project', ${id}, 'codex', 'full-access', 'default', ${timestamp}, ${timestamp}, ${JSON.stringify(payload)})`;
      const item = (id: string, thread: string, type: string, payload: unknown) =>
        sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
          VALUES (${id}, ${thread}, 'run', 1, ${type}, 'completed', ${timestamp}, ${JSON.stringify(payload)})`;
      yield* item("edit", "in-worktree", "file_change", {
        fileName: `${worktree}/.agent-work/NG-1/engineering-loop.md`,
        diffStr: "-Stage: Testing\n+Stage: Review",
      });
      yield* item("rewrite", "in-worktree", "command_execution", {
        input: "cat > .agent-work/NG-2/engineering-loop.md <<'EOF'\n# NG-2\nStage: QA\nEOF",
      });
      yield* item("read", "in-worktree", "command_execution", {
        input: "cat .agent-work/NG-3/engineering-loop.md",
        output: "Stage: Plan",
      });
      yield* item("root-edit", "in-root", "file_change", {
        fileName: `${root}/.agent-work/NG-1/engineering-loop.md`,
        diffStr: "+Stage: Plan",
      });
      const worksheet = Effect.fn("test.threadLoop.worksheet")(function* (
        checkout: string,
        ticket: string,
        text: string,
        modifiedAt: string,
      ) {
        const file = `${checkout}/.agent-work/${ticket}/engineering-loop.md`;
        yield* fs.makeDirectory(`${checkout}/.agent-work/${ticket}`, { recursive: true });
        yield* fs.writeFileString(file, text);
        const seconds = Date.parse(modifiedAt) / 1000;
        yield* fs.utimes(file, seconds, seconds);
      });
      yield* worksheet(
        worktree,
        "NG-1",
        "# NG-1 Staff see the inventory\n\nStage: Review\nNext: Close the repair review.\n\n## Timestamps\n- 2026-10-28T09:00:00Z Stage: Plan\n- 2026-10-29T14:30Z Stage: Implementation\n- yesterday Stage: QA\n",
        "2026-10-30T00:00:00.000Z",
      );
      yield* worksheet(worktree, "NG-2", "# NG-2\nStage: QA\n", "2026-10-31T00:00:00.000Z");
      yield* worksheet(worktree, "NG-3", "# NG-3\nStage: Plan\n", "2026-10-31T00:00:00.000Z");
      yield* worksheet(root, "NG-1", "# NG-1 Root copy\nStage: Plan\n", "2026-10-29T00:00:00.000Z");

      const loop = yield* ThreadEngineeringLoop.ThreadEngineeringLoop;
      assert.deepEqual(yield* loop.list(ThreadId.make("in-worktree")), [
        {
          ticket: "NG-2",
          title: "",
          stage: "QA",
          next: "",
          stageChanges: [],
          updatedAt: "2026-10-31T00:00:00.000Z",
        },
        {
          ticket: "NG-1",
          title: "Staff see the inventory",
          stage: "Review",
          next: "Close the repair review.",
          stageChanges: [
            { stage: "Plan", at: "2026-10-28T09:00:00.000Z" },
            { stage: "Implementation", at: "2026-10-29T14:30:00.000Z" },
          ],
          updatedAt: "2026-10-30T00:00:00.000Z",
        },
      ]);
      assert.deepEqual(
        (yield* loop.list(ThreadId.make("in-root"))).map((ticket) => ticket.title),
        ["Root copy"],
      );
      assert.deepEqual(yield* loop.list(ThreadId.make("outside")), []);
    }),
  );
});
