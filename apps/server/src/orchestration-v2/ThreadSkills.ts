import type { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { skillToolInvocationName } from "@t3tools/shared/toolActivity";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

import { skillFileReads } from "./skillFileReads.ts";

const MAX_THREAD_SKILLS = 50;

export class ThreadSkillsError extends Schema.TaggedError<ThreadSkillsError>()(
  "ThreadSkillsError",
  { cause: Schema.optional(Schema.Defect()) },
) {}

export class ThreadSkills extends Context.Service<
  ThreadSkills,
  {
    /** Detected skill loads through native tools or instruction reads, in first-use order. */
    readonly list: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<string>, ThreadSkillsError>;
    /** Skills one run loaded, in first-use order, including a run that was later rolled back. */
    readonly forRun: (runId: string) => Effect.Effect<ReadonlyArray<string>, ThreadSkillsError>;
  }
>()("t3/orchestration-v2/ThreadSkills") {}

export const layer = Layer.effect(
  ThreadSkills,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const loaded = (scope: Statement.Fragment) =>
      sql<{
        readonly tool_name: string | null;
        readonly type: string;
        readonly input_json: string;
      }>`
        SELECT
          json_extract(item.payload_json, '$.toolName') AS tool_name,
          item.type,
          COALESCE(item.payload_json -> '$.input', 'null') AS input_json
        FROM orchestration_v2_projection_turn_items AS item
        LEFT JOIN orchestration_v2_projection_runs AS run
          ON run.run_id = item.run_id
        WHERE ${scope}
          AND item.type IN ('dynamic_tool', 'command_execution')
          AND item.status = 'completed'
          AND COALESCE(json_extract(item.payload_json, '$.exitCode'), 0) = 0
          AND COALESCE(json_extract(item.payload_json, '$.outputIndicatesFailure'), 0) = 0
          AND (json_extract(item.payload_json, '$.toolName') IN ('Skill', 'skill')
            OR instr(json_extract(item.payload_json, '$.input'), 'SKILL.md') > 0)
        ORDER BY item.ordinal, item.turn_item_id
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.map((rows) => {
          const skills = new Set<string>();
          for (const row of rows) {
            const input: unknown = JSON.parse(row.input_json);
            const native = skillToolInvocationName(row.tool_name, input);
            const detected = native ? [native] : skillFileReads(row.type, row.tool_name, input);
            for (const skill of detected) {
              skills.add(skill);
              if (skills.size === MAX_THREAD_SKILLS) break;
            }
            if (skills.size === MAX_THREAD_SKILLS) break;
          }
          return [...skills];
        }),
        Effect.mapError((cause) => new ThreadSkillsError({ cause })),
      );

    const list = Effect.fn("ThreadSkills.list")((threadId: ThreadId) =>
      loaded(
        sql`item.thread_id = ${threadId} AND (run.status IS NULL OR run.status <> 'rolled_back')`,
      ),
    );
    const forRun = Effect.fn("ThreadSkills.forRun")((runId: string) =>
      loaded(sql`item.run_id = ${runId}`),
    );

    return ThreadSkills.of({ list, forRun });
  }),
);
