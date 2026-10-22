import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import { HttpServerRequest } from "effect/http";

import { traceAuthenticatedRelayRequest } from "./traceRelayRequest.ts";

const AUTHENTICATION = { startTime: 1_000n, endTime: 2_000n };

describe("authenticated relay request tracing", () => {
  it.effect("keeps the request and its local work in the configured tracer", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.Span> = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const request = HttpServerRequest.fromWeb(
        new Request("https://environment.example.test/api/orchestration/threads/thread-1", {
          headers: { traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
        }),
      );
      yield* traceAuthenticatedRelayRequest(
        Effect.void.pipe(
          Effect.withSpan("sql.execute"),
          Effect.withSpan("environment.orchestration.threadSnapshot"),
        ),
        AUTHENTICATION,
      ).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        Effect.withTracer(tracer),
      );
      expect(spans.map((span) => span.name)).toEqual([
        "environment.relay.request",
        "EnvironmentAuth.authenticateHttpRequest",
        "environment.orchestration.threadSnapshot",
        "sql.execute",
      ]);
      expect(spans.every((span) => span.traceId === "0123456789abcdef0123456789abcdef")).toBe(true);
      expect(Option.getOrUndefined(spans[1]!.parent)?.spanId).toBe(spans[0]!.spanId);
    }),
  );
});
