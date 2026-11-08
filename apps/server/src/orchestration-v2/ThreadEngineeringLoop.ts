import type { EngineeringLoopTicket, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const MAX_TICKETS = 10;
const MAX_STAGE_CHANGES = 40;
const MAX_WORKSHEET_BYTES = 1024 * 1024;
const STAGE_CHANGE = /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z) Stage: (.+)$/;
const WORKSHEET_PATH = /\.agent-work\/([^/"\\\s<>]+)\/engineering-loop\.md/g;

/** The agents-toolkit worksheet's `Stage:`/`Next:` fields and `- <UTC time> Stage: <stage>` lines. */
const parseLoopWorksheet = (ticket: string, text: string) => {
  const lines = text.split(/\r?\n/);
  const field = (name: string) =>
    lines
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? "";
  const stage = field("Stage");
  if (!stage) return null;
  const heading =
    lines
      .find((line) => line.startsWith("# "))
      ?.slice(2)
      .trim() ?? "";
  const title = heading.startsWith(ticket) ? heading.slice(ticket.length).trim() : heading;
  const stageChanges = lines.flatMap((line) => {
    const [, time, name] = STAGE_CHANGE.exec(line.trim()) ?? [];
    const at = time ? Date.parse(time) : Number.NaN;
    const changed = name?.trim().slice(0, 300);
    return changed && !Number.isNaN(at)
      ? [{ stage: changed, at: DateTime.formatIso(DateTime.makeUnsafe(at)) }]
      : [];
  });
  return {
    title: title.slice(0, 300),
    stage: stage.slice(0, 300),
    next: field("Next").slice(0, 600),
    stageChanges: stageChanges.slice(-MAX_STAGE_CHANGES),
  };
};

export class ThreadEngineeringLoopError extends Schema.TaggedError<ThreadEngineeringLoopError>()(
  "ThreadEngineeringLoopError",
  { cause: Schema.optional(Schema.Defect()) },
) {}

export class ThreadEngineeringLoop extends Context.Service<
  ThreadEngineeringLoop,
  {
    /**
     * Worksheets this thread wrote a `Stage:` into, read from its checkout as they are now,
     * most recently written first.
     */
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<EngineeringLoopTicket>, ThreadEngineeringLoopError>;
  }
>()("t3/orchestration-v2/ThreadEngineeringLoop") {}

export const layer = Layer.effect(
  ThreadEngineeringLoop,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readWorksheet = Effect.fn("ThreadEngineeringLoop.readWorksheet")(function* (
      checkout: string,
      ticket: string,
    ) {
      const file = path.join(checkout, ".agent-work", ticket, "engineering-loop.md");
      const info = yield* fs.stat(file).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "File") return null;
      if (info.value.size > MAX_WORKSHEET_BYTES) return null;
      const mtime = Option.getOrUndefined(info.value.mtime);
      const text = yield* fs.readFileString(file).pipe(Effect.option);
      const parsed = Option.isSome(text) ? parseLoopWorksheet(ticket, text.value) : null;
      if (!parsed || !mtime) return null;
      return { ticket, ...parsed, updatedAt: DateTime.formatIso(DateTime.makeUnsafe(mtime)) };
    });

    const list = Effect.fn("ThreadEngineeringLoop.list")(function* (threadId: ThreadId) {
      const checkout = yield* sql<{ readonly cwd: string | null }>`
        SELECT COALESCE(json_extract(t.payload_json, '$.worktreePath'), p.workspace_root) AS cwd
        FROM orchestration_v2_projection_threads t
        JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.thread_id = ${threadId} AND t.deleted_at IS NULL
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new ThreadEngineeringLoopError({ cause })),
      );
      const cwd = checkout[0]?.cwd;
      if (!cwd) return [];
      const writes = yield* sql<{ readonly around: string }>`
        SELECT substr(payload_json, MAX(1, instr(payload_json, '/engineering-loop.md') - 200), 220) AS around
        FROM orchestration_v2_projection_turn_items
        WHERE thread_id = ${threadId}
          AND type IN ('file_change', 'command_execution', 'dynamic_tool')
          AND instr(payload_json, '/engineering-loop.md') > 0 AND instr(payload_json, 'Stage: ') > 0
        ORDER BY updated_at DESC LIMIT 200
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new ThreadEngineeringLoopError({ cause })),
      );
      const tickets = new Set<string>();
      for (const row of writes) {
        const ticket = [...row.around.matchAll(WORKSHEET_PATH)].at(-1)?.[1];
        if (ticket && !ticket.startsWith(".") && ticket.length <= 300) tickets.add(ticket);
        if (tickets.size === MAX_TICKETS) break;
      }
      const worksheets = yield* Effect.forEach(tickets, (ticket) => readWorksheet(cwd, ticket));
      return worksheets
        .filter((worksheet) => worksheet !== null)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });

    return ThreadEngineeringLoop.of({ list });
  }),
);
