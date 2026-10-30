import { expect, it } from "vite-plus/test";
import { decide, workspacePackage, workspacePatterns } from "./workspaceChanges.cjs";

const packages = [
  { name: "@t3tools/contracts", dir: "packages/contracts", hasTest: true, deps: [] },
  {
    name: "@t3tools/client-runtime",
    dir: "packages/client-runtime",
    hasTest: true,
    deps: ["@t3tools/contracts"],
  },
  { name: "@t3tools/web", dir: "apps/web", hasTest: true, deps: ["@t3tools/client-runtime"] },
  { name: "@t3tools/mobile", dir: "apps/mobile", hasTest: true, deps: ["@t3tools/client-runtime"] },
  { name: "@t3tools/desktop", dir: "apps/desktop", hasTest: true, deps: ["@t3tools/web"] },
  { name: "@t3tools/provider-pi", dir: "packages/provider-pi", hasTest: true, deps: [] },
  { name: "t3", dir: "apps/server", hasTest: true, deps: ["@t3tools/contracts"] },
  { name: "@t3tools/evals", dir: "evals", hasTest: true, deps: [] },
  { name: "@t3tools/scripts", dir: "scripts", hasTest: true, deps: [] },
];

it("shares transitive package and test-only dependencies between CI and QA without treating web builds as server tests", () => {
  expect(decide(["packages/contracts/src/qa.ts"], packages, false).affected).toEqual(
    packages.map((pkg) => pkg.name).sort(),
  );
  expect(decide(["apps/server/src/qa/QaService.ts"], packages, false).affected).toEqual([
    "@t3tools/evals",
    "@t3tools/scripts",
    "t3",
  ]);
  expect(decide(["apps/web/src/a.ts"], packages, false).affected).toEqual([
    "@t3tools/desktop",
    "@t3tools/scripts",
    "@t3tools/web",
  ]);
  expect(
    workspacePackage(
      {
        name: "t3",
        dependencies: { "@t3tools/web": "workspace:*", "@t3tools/contracts": "workspace:*" },
      },
      "apps/server",
    ).deps,
  ).toEqual(["@t3tools/contracts"]);
});

it("preserves CI exceptions and falls back to all packages for unknown paths and manifests", () => {
  for (const files of [["package.json"], ["apps/web/package.json"], ["unknown.config"], null]) {
    expect(decide(files, packages, false).affected).toEqual(packages.map((pkg) => pkg.name).sort());
  }
  expect(decide(["docs/guide.md"], packages, false).affected).toEqual([]);
  expect(decide(["scripts/lib/config.ts"], packages, false).affected).toContain("t3");
  expect(decide(["native/libghostty-vt/a.c"], packages, false).affected).toContain("@t3tools/web");
  expect(decide(["packages/shared/src/HostProcess.ts"], packages, false).affected).toEqual(
    packages.map((pkg) => pkg.name).sort(),
  );
  expect(workspacePatterns('packages:\n  - apps/*\n  - "packages/*"\nother:\n  - ignored')).toEqual(
    ["apps/*", "packages/*"],
  );
  expect(decide(["docs/guide.md"], packages, false, false).affected).toEqual(
    packages.map((pkg) => pkg.name).sort(),
  );
});
