// Unknown paths run every job; recognized packages pull in their dependents.
// scripts/check-changed.ts shares these decisions so local checks match CI.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

const {
  workspacePatterns,
  workspacePackage,
  decide,
} = require("../../packages/shared/src/workspaceChanges.cjs");

function readWorkspace() {
  const patterns = workspacePatterns(
    fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  );

  const dirs = patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return fs.readdirSync(path.join(root, parent)).map((name) => `${parent}/${name}`);
  });

  const packages = [];
  for (const dir of dirs) {
    const manifestPath = path.join(root, dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    packages.push(workspacePackage(manifest, dir));
  }
  return packages;
}

function main() {
  const args = process.argv.slice(2);
  const pathsIndex = args.indexOf("--paths");
  const files =
    pathsIndex === -1
      ? null
      : fs
          .readFileSync(args[pathsIndex + 1], "utf8")
          .split("\n")
          .filter(Boolean);
  const { affected, outputs } = decide(files, readWorkspace(), args.includes("--full"));

  console.error(`Affected packages: ${affected.join(", ") || "none"}`);
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`);
}

module.exports = { readWorkspace, decide };

if (require.main === module) main();
