import type { GitExplorerRef } from "@t3tools/contracts";

// Sampled from SourceTree graph lines.
export const GIT_EXPLORER_COLORS = [
  {
    foreground: "text-[#0064ce]",
    marker: "bg-[#0064ce]",
    selected: "bg-[#0064ce]/16",
  },
  {
    foreground: "text-[#ffa700]",
    marker: "bg-[#ffa700]",
    selected: "bg-[#ffa700]/16",
  },
  {
    foreground: "text-[#007e58]",
    marker: "bg-[#007e58]",
    selected: "bg-[#007e58]/16",
  },
  {
    foreground: "text-[#50459c]",
    marker: "bg-[#50459c]",
    selected: "bg-[#50459c]/16",
  },
  {
    foreground: "text-[#009cb4]",
    marker: "bg-[#009cb4]",
    selected: "bg-[#009cb4]/16",
  },
  {
    foreground: "text-[#dd3b00]",
    marker: "bg-[#dd3b00]",
    selected: "bg-[#dd3b00]/16",
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
