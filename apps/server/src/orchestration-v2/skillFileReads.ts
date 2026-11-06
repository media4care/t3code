const skillAtPath = (path: unknown) => {
  if (typeof path !== "string") return undefined;
  const name = /(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/.exec(path)?.[1];
  return name && name !== "." && name !== ".." ? name : undefined;
};

// Only literal commands are evidence: do not interpret scripts, substitutions or redirections.
function commandSegments(command: string) {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  const finishWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === "\\" && quote !== "'") {
      const next = command[++i];
      if (next === undefined) return [];
      if (quote === '"' && !/["\\$`\n]/.test(next)) word += "\\";
      if (next !== "\n") word += next;
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/[<>$`(){}]/.test(char)) {
      return [];
    } else if (char === "#" && !started) {
      while (i < command.length && command[i] !== "\n") i++;
      i--;
    } else if (/[;|&\n]/.test(char)) {
      if (char === "|" && command[i + 1] === "|") return [];
      if (char === "&" && command[++i] !== "&") return [];
      finishWord();
      segments.push(words);
      words = [];
    } else if (/\s/.test(char)) finishWord();
    else {
      word += char;
      started = true;
    }
  }
  if (quote) return [];
  finishWord();
  segments.push(words);
  return segments;
}

function commandSkillReads(command: string, depth = 0): string[] {
  if (depth > 3) return [];
  return commandSegments(command).flatMap(([executable, ...args]) => {
    const program = executable?.split("/").at(-1);
    if (
      program &&
      ["sh", "bash", "zsh", "dash"].includes(program) &&
      args.length === 2 &&
      /^-[a-z]*c$/.test(args[0]!)
    )
      return commandSkillReads(args[1]!, depth + 1);
    let files: string[];
    if (program === "cat") {
      if (args.some((arg) => arg.startsWith("-") && !/^(--|-[benstuvAET]+)$/.test(arg))) return [];
      files = args.filter((arg) => !arg.startsWith("-"));
    } else if (program === "head" || program === "tail") {
      files = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "-n" || arg === "-c") {
          if (!/^\d+$/.test(args[++i] ?? "")) return [];
        } else if (!arg.startsWith("-")) files.push(arg);
        else if (!/^(--|-[qv]|-\d+|-[nc]\d+)$/.test(arg)) return [];
      }
    } else if (program === "sed") {
      // Printing address ranges covers instruction reads without treating sed edits as loads.
      if (
        args[0] !== "-n" ||
        !/^(?:\d+|\$|\/[^/]+\/)(?:,(?:\d+|\$|\/[^/]+\/))?p$/.test(args[1] ?? "")
      )
        return [];
      files = args.slice(2);
      if (files.some((arg) => arg.startsWith("-"))) return [];
    } else return [];
    return files.flatMap((file) => {
      if (/[$`*?[\]{}]/.test(file)) return [];
      const skill = skillAtPath(file);
      return skill ? [skill] : [];
    });
  });
}

export function skillFileReads(type: string, toolName: string | null, input: unknown): string[] {
  if (type === "command_execution" && typeof input === "string") return commandSkillReads(input);
  if (!input || typeof input !== "object") return [];
  const fields = input as Record<string, unknown>;
  if (!toolName || !["Read", "read", "read_file", "view_file"].includes(toolName)) return [];
  const skill = skillAtPath(
    fields.file_path ?? fields.filePath ?? fields.path ?? fields.AbsolutePath,
  );
  return skill ? [skill] : [];
}
