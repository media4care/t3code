import type { InsightLoopTicket, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

export const MAX_LOOP_TICKETS = 50;
const MAX_STAGE_CHANGES = 40;
const MAX_WORKSHEET_BYTES = 1024 * 1024;
/** Tickets in these stages leave the board once they fall outside the lookback window. */
const CLOSED_STAGES = new Set(["Done", "Aborted"]);
const STAGE_CHANGE = /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z) Stage: (.+)$/;

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

/**
 * Reads worksheets under each checkout's `.agent-work/<ticket>/engineering-loop.md`. Open tickets
 * stay regardless of age; closed ones only while updated since `since`. One ticket in several
 * checkouts keeps its most recently written worksheet.
 */
export const makeLoopWorksheetReader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return Effect.fn("InsightsService.readLoopWorksheets")(function* (
    checkouts: ReadonlyArray<{ readonly root: string; readonly projectId: ProjectId }>,
    since: string,
  ) {
    const tickets = new Map<string, Omit<InsightLoopTicket, "threadId"> & { root: string }>();
    for (const checkout of checkouts) {
      const directory = path.join(checkout.root, ".agent-work");
      const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
      for (const ticket of entries) {
        if (!ticket || ticket !== ticket.trim() || ticket.length > 300) continue;
        const file = path.join(directory, ticket, "engineering-loop.md");
        const info = yield* fs.stat(file).pipe(Effect.option);
        if (
          Option.isNone(info) ||
          info.value.type !== "File" ||
          info.value.size > MAX_WORKSHEET_BYTES
        )
          continue;
        const mtime = Option.getOrUndefined(info.value.mtime);
        const updatedAt = mtime && DateTime.formatIso(DateTime.makeUnsafe(mtime));
        const text = yield* fs.readFileString(file).pipe(Effect.option);
        const parsed = Option.isSome(text) ? parseLoopWorksheet(ticket, text.value) : null;
        if (!parsed || !updatedAt) continue;
        if (CLOSED_STAGES.has(parsed.stage) && updatedAt < since) continue;
        const previous = tickets.get(ticket);
        if (previous && previous.updatedAt >= updatedAt) continue;
        tickets.set(ticket, {
          ticket,
          ...parsed,
          updatedAt,
          projectId: checkout.projectId,
          root: checkout.root,
        });
      }
    }
    return [...tickets.values()]
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LOOP_TICKETS);
  });
});
