import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web runtime relay telemetry policy", () => {
  it.each([
    {
      surface: "desktop opt-out",
      desktopBridge: { getRelayTelemetryEnabled: () => false },
    },
    {
      surface: "desktop enabled",
      desktopBridge: { getRelayTelemetryEnabled: () => true },
    },
    {
      surface: "ordinary browser",
      desktopBridge: undefined,
    },
  ])(
    "does not report relay spans for $surface with legacy ingest credentials",
    async ({ desktopBridge }) => {
      vi.resetModules();
      vi.stubEnv("T3CODE_TELEMETRY_ENABLED", "true");
      vi.stubEnv("T3CODE_OTEL_SDK_DISABLED", "false");
      vi.stubEnv("OTEL_SDK_DISABLED", "false");
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://telemetry.example.test/v1/traces");
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay-test");
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "test-token");
      vi.stubGlobal("window", { desktopBridge });
      const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchFn);
      // Load the runtime with legacy settings present to catch accidental exporter initialization.
      const { runtime: freshRuntime } = await import("./runtime");
      const { setDelegate } = await import("../observability/clientTracer");
      const userSpans: Array<string> = [];

      try {
        setDelegate(
          Tracer.make({
            span(options) {
              userSpans.push(options.name);
              return new Tracer.NativeSpan(options);
            },
          }),
        );
        expect(
          await freshRuntime.runPromise(
            Effect.succeed("relay operation completed").pipe(
              Effect.withSpan("relay.first-operation"),
            ),
          ),
        ).toBe("relay operation completed");
        await freshRuntime.runPromise(Effect.void.pipe(Effect.withSpan("user.work")));
        expect(userSpans).toEqual(["relay.first-operation", "user.work"]);
      } finally {
        setDelegate(null);
        // Disposing also flushes any accidentally installed exporter.
        await freshRuntime.dispose();
      }

      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});
