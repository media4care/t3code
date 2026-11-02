import type { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { skillToolInvocationName } from "@t3tools/shared/toolActivity";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

const MAX_THREAD_SKILLS = 50;

export class ThreadSkillsError extends Schema.TaggedError<ThreadSkillsError>()(
  "ThreadSkillsError",
  { cause: Schema.optional(Schema.Defect()) },
) {}

export class ThreadSkills extends Context.Service<
  ThreadSkills,
  {
    /** Skills the thread's agent loaded through its provider's skill tool, in first-use order. */
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
        readonly skill: unknown;
        readonly name: unknown;
      }>`
        SELECT
          json_extract(item.payload_json, '$.toolName') AS tool_name,
          json_extract(item.payload_json, '$.input.skill') AS skill,
          json_extract(item.payload_json, '$.input.name') AS name
        FROM orchestration_v2_projection_turn_items AS item
        LEFT JOIN orchestration_v2_projection_runs AS run
          ON run.run_id = item.run_id
        WHERE ${scope}
          AND item.type = 'dynamic_tool'
          AND item.status <> 'failed'
          AND json_extract(item.payload_json, '$.toolName') IN ('Skill', 'skill')
        ORDER BY item.ordinal, item.turn_item_id
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.map((rows) => {
          const skills = new Set<string>();
          for (const row of rows) {
            const skill = skillToolInvocationName(row.tool_name, {
              skill: row.skill,
              name: row.name,
            });
            if (skill !== undefined) skills.add(skill);
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
