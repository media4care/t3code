import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(300));

/** An agents-toolkit worksheet, `.agent-work/<ticket>/engineering-loop.md`, as last written. */
export const EngineeringLoopTicket = Schema.Struct({
  ticket: ShortText,
  title: Schema.String.check(Schema.isMaxLength(300)),
  stage: ShortText,
  next: Schema.String.check(Schema.isMaxLength(600)),
  updatedAt: IsoDateTime,
  /** Timestamped stage changes in recorded order; empty for worksheets that predate them. */
  stageChanges: Schema.Array(Schema.Struct({ stage: ShortText, at: IsoDateTime })).check(
    Schema.isMaxLength(40),
  ),
});
export type EngineeringLoopTicket = typeof EngineeringLoopTicket.Type;
