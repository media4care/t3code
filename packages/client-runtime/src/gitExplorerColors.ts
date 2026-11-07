import type { GitExplorerRef } from "@t3tools/contracts";

// Sampled from SourceTree graph lines.
export const GIT_EXPLORER_COLORS = [
  {
    value: "#0064ce",
  },
  {
    value: "#ffa700",
  },
  {
    value: "#007e58",
  },
  {
    value: "#50459c",
  },
  {
    value: "#009cb4",
  },
  {
    value: "#dd3b00",
  },
] as const;

export function gitExplorerReferenceColors(refs: readonly GitExplorerRef[]) {
  const colors = new Map<string, number>();
  const branchColors = new Map<string, number>();
  const usage = GIT_EXPLORER_COLORS.map(() => 0);
  const rank = { local: 0, remote: 1, tag: 2 };
  for (const ref of [...refs].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name),
  )) {
    if (colors.has(ref.hash)) continue;
    const name =
      ref.kind === "remote" ? ref.shortName.slice(ref.shortName.indexOf("/") + 1) : ref.shortName;
    const identity = `${ref.kind === "tag" ? "tag" : "branch"}:${name}`;
    let color = branchColors.get(identity);
    if (color === undefined) {
      let hash = 0;
      for (const character of name) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
      const preferred = hash % GIT_EXPLORER_COLORS.length;
      color = preferred;
      for (let offset = 1; offset < GIT_EXPLORER_COLORS.length; offset++) {
        const candidate = (preferred + offset) % GIT_EXPLORER_COLORS.length;
        if (usage[candidate]! < usage[color]!) color = candidate;
      }
      branchColors.set(identity, color);
      usage[color] = usage[color]! + 1;
    }
    colors.set(ref.hash, color);
  }
  return colors;
}
