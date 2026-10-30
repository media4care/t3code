import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Insights from "../../../insights/InsightsService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { InsightsToolkit } from "./tools.ts";

const failure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
const callerId = Effect.gen(function* () {
  const { caller } = yield* readCaller();
  if (!caller)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "This action needs a running thread.",
    });
  return caller.id;
});
const required = <A>(value: A | undefined) =>
  value === undefined
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The selected action needs its input.",
        }),
      )
    : Effect.succeed(value);

export const layer = McpToolAccess.toLayer(InsightsToolkit, {
  t3_insights_collect: McpToolAccess.writesEnvironment(() =>
    Effect.gen(function* () {
      const service = yield* Insights.InsightsService;
      return yield* service.collect(yield* callerId).pipe(Effect.mapError(failure));
    }),
  ),
  t3_insights_submit: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const service = yield* Insights.InsightsService;
      return yield* service.submit(yield* callerId, input).pipe(Effect.mapError(failure));
    }),
  ),
  t3_insights_record: McpToolAccess.writesThreads(
    () => [undefined],
    (input) =>
      Effect.gen(function* () {
        const service = yield* Insights.InsightsService;
        return yield* service.record(yield* callerId, input).pipe(Effect.mapError(failure));
      }),
  ),
  t3_insights: McpToolAccess.either(
    (input) => ["list", "report", "recommendation"].includes(input.action),
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const service = yield* Insights.InsightsService;
        if (input.action === "report")
          return yield* service.report(yield* required(input.id)).pipe(Effect.mapError(failure));
        if (input.action === "recommendation")
          return yield* service
            .recommendation(yield* required(input.id))
            .pipe(Effect.mapError(failure));
        return yield* service.snapshot().pipe(Effect.mapError(failure));
      }),
    ),
    McpToolAccess.writesEnvironment((input) =>
      Effect.gen(function* () {
        const service = yield* Insights.InsightsService;
        if (input.action === "configure")
          return yield* service
            .configure(yield* required(input.settings))
            .pipe(Effect.mapError(failure));
        if (input.action === "update")
          return yield* service
            .update(yield* required(input.update))
            .pipe(Effect.mapError(failure));
        if (input.action === "implement")
          return yield* service.implement(yield* required(input.id)).pipe(Effect.mapError(failure));
        return yield* service.runNow().pipe(Effect.mapError(failure));
      }),
    ),
  ),
});
