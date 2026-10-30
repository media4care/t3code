import { AuthTerminalOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as Qa from "./QaService.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "qa",
  Effect.fnUntraced(function* (handlers) {
    const qa = yield* Qa.QaService;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    return handlers.handle(
      "importReport",
      Effect.fn("environment.qa.importReport")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthTerminalOperateScope);
        return yield* startup.enqueueCommand(qa.importReport(args.payload)).pipe(
          Effect.catch(
            Effect.fnUntraced(function* (cause) {
              if (cause._tag === "QaError" && cause.reason !== "storage")
                return yield* failEnvironmentInvalidRequest("invalid_command");
              return yield* failEnvironmentInternal("internal_error", cause);
            }),
          ),
        );
      }),
    );
  }),
);
