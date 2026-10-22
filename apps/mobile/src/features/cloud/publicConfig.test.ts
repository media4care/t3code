import { expect, it, vi } from "vite-plus/test";

import { resolveCloudPublicConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

it("ignores legacy telemetry credentials while preserving cloud connection configuration", () => {
  const extra = {
    clerk: { publishableKey: "pk_test_example", jwtTemplate: "relay" },
    relay: { url: "https://relay.example.test" },
    observability: {
      tracesUrl: "https://api.axiom.test/v1/traces",
      tracesDataset: "mobile-traces",
      tracesToken: "legacy-ingest-token",
    },
  };
  expect(resolveCloudPublicConfig(extra)).toEqual({
    clerk: extra.clerk,
    relay: { url: "https://relay.example.test" },
  });
});
