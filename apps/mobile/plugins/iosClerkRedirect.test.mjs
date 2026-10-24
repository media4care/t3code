import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

function productionConfig(redirectUrl) {
  const output = NodeChildProcess.execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { createRequire } from 'node:module';
       const require = createRequire(import.meta.url);
       const { getConfig } = require('expo/config');
       console.log = () => {};
       const { exp } = getConfig(process.cwd());
       process.stdout.write(JSON.stringify({
         bundleIdentifier: exp.ios.bundleIdentifier,
         redirectUrl: exp.ios.infoPlist.ClerkOAuthRedirectUrl ?? null,
       }));`,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        APP_VARIANT: "production",
        T3CODE_IOS_PERSONAL_TEAM: "1",
        T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.t3code.local",
        T3CODE_IOS_CLERK_REDIRECT_URL: redirectUrl,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output);
}

it("uses an explicit OAuth callback without changing the isolated iOS app identity", () => {
  expect(productionConfig("com.t3tools.t3code://callback")).toEqual({
    bundleIdentifier: "com.example.t3code.local",
    redirectUrl: "com.t3tools.t3code://callback",
  });
});

it("keeps Clerk's bundle-based callback default when no override is configured", () => {
  expect(productionConfig("")).toEqual({
    bundleIdentifier: "com.example.t3code.local",
    redirectUrl: null,
  });
});

it("rejects a web URL that the native authentication session cannot capture", () => {
  expect(() => productionConfig("https://example.com/callback")).toThrow(
    "T3CODE_IOS_CLERK_REDIRECT_URL must be an absolute custom-scheme URL",
  );
});
