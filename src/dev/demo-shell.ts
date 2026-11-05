import { askAnswers, mockAsk, mockNotice, mockPart, type TerminalMessage } from "../platform/services";

/*
 * The Terminal tool in the demo: a small made-up PowerShell. No process runs; commands are looked up here.
 * `crest-notify` really talks to the notch, so notices, parts and questions can be tried from the prompt.
 */

const USER = "demo";
const HOME = `C:\\Users\\${USER}`;

/** Folders and the files in them; enough to look around in. */
const FS: Record<string, string[]> = {
  [HOME]: ["Desktop", "Documents", "Downloads", "Pictures", "projects"],
  [`${HOME}\\Documents`]: ["Budget-2027.xlsx", "Q3-Report.pdf", "notes.txt"],
  [`${HOME}\\Downloads`]: ["hero-banner.png", "installer.exe"],
  [`${HOME}\\Pictures`]: ["Screenshots", "dusk.png"],
  [`${HOME}\\projects`]: ["crest"],
  [`${HOME}\\projects\\crest`]: ["README.md", "package.json", "src"],
};
const FILES: Record<string, string> = {
  [`${HOME}\\Documents\\notes.txt`]: "Ship the demo.\nTry crest-notify from this prompt.",
  [`${HOME}\\projects\\crest\\README.md`]: "# Crest\nA notch for your PC.",
};

const C = { green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[90m", off: "\x1b[0m" };

const HELP = [
  `${C.cyan}Demo shell.${C.off} Nothing runs here; these commands work:`,
  "  help                      this list",
  "  ls, cd <dir>, pwd, cat <file>, echo <text>, date, whoami, clear",
  `  ${C.green}crest-notify${C.off} <title> [-b body]       a notice in the closed notch`,
  `  ${C.green}crest-notify part${C.off} <id> <text> [-p 40] a part in the closed row (--clear to remove)`,
  `  ${C.green}crest-notify ask${C.off} --title T --body B   a question; the answer is printed here`,
  `  ${C.green}crest-notify run${C.off} -- <command>         a pretend run with its result as a notice`,
  "Close the notch with Esc to see the results in the row.",
];

/** Words of a command line; double and single quotes group. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** The value after a flag, or after any of its aliases. */
const flag = (w: string[], ...names: string[]) => {
  const i = w.findIndex((x) => names.includes(x));
  return i >= 0 ? w[i + 1] : undefined;
};

export function createShell(out: (m: TerminalMessage) => void) {
  let cwd = HOME;
  let line = "";
  const history: string[] = [];
  let at = 0;
  let busy = false;
  let alive = true;
  const say = (s: string) => alive && out(new TextEncoder().encode(s).buffer as ArrayBuffer);
  const prompt = () => say(`${C.green}PS${C.off} ${cwd}> `);
  const print = (...rows: string[]) => say(rows.map((r) => `${r}\r\n`).join(""));
  const resolve = (p: string) => {
    if (/^[a-z]:/i.test(p)) return p.replace(/\//g, "\\").replace(/\\$/, "");
    let parts = cwd.split("\\");
    for (const seg of p.replace(/\//g, "\\").split("\\")) {
      if (seg === "..") parts = parts.length > 1 ? parts.slice(0, -1) : parts;
      else if (seg && seg !== ".") parts.push(seg);
    }
    return parts.join("\\") || "C:";
  };

  async function run(raw: string) {
    const w = words(raw.trim());
    const cmd = (w[0] ?? "").toLowerCase();
    switch (cmd) {
      case "":
        return;
      case "help":
        return print(...HELP);
      case "clear":
      case "cls":
        return say("\x1b[2J\x1b[3J\x1b[H");
      case "pwd":
        return print("", `${C.dim}Path${C.off}`, `${C.dim}----${C.off}`, cwd, "");
      case "whoami":
        return print(`pc\\${USER}`);
      case "date":
      case "get-date":
        return print(new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" }));
      case "echo":
        return print(w.slice(1).join(" "));
      case "ls":
      case "dir":
      case "get-childitem": {
        const dir = w[1] ? resolve(w[1]) : cwd;
        const names = FS[dir];
        if (!names) return print(`${C.red}ls: cannot find path '${dir}' because it does not exist.${C.off}`);
        return print(...names.map((n) => (FS[`${dir}\\${n}`] ? `${C.cyan}${n}\\${C.off}` : n)));
      }
      case "cd":
      case "set-location": {
        const dir = w[1] ? resolve(w[1]) : HOME;
        if (!FS[dir]) return print(`${C.red}cd: cannot find path '${dir}' because it does not exist.${C.off}`);
        cwd = dir;
        return;
      }
      case "cat":
      case "type":
      case "get-content": {
        const text = FILES[resolve(w[1] ?? "")];
        return text === undefined ? print(`${C.red}cat: cannot find '${w[1] ?? ""}'.${C.off}`) : print(...text.split("\n"));
      }
      case "exit":
        alive = false;
        return out({ exit: 0 });
      case "crest-notify":
        return notify(w.slice(1));
      default:
        return print(`${C.red}${w[0]}: the term is not recognized in this demo.${C.off} Type ${C.cyan}help${C.off}.`);
    }
  }

  async function notify(w: string[]) {
    if (w[0] === "part") {
      const id = w[1];
      if (!id) return print(`${C.red}usage: crest-notify part <id> <text> [-p 0-100] [-i icon] [-o tool]${C.off}`);
      if (w.includes("--clear")) return mockPart({ id, clear: true });
      const progress = flag(w, "-p");
      return mockPart({ id, text: w[2]?.startsWith("-") ? null : w[2], icon: flag(w, "-i") ?? "build", progress: progress === undefined ? null : Number(progress), open: flag(w, "-o") ?? null });
    }
    if (w[0] === "ask") {
      const title = flag(w, "--title") ?? "Run command?";
      const id = mockAsk({ title, body: flag(w, "--body") ?? "cargo test", appName: flag(w, "-s") ?? "Agent" });
      print(`${C.dim}Waiting for your click in the notch. Press Esc to see it.${C.off}`);
      busy = true;
      const choice = await new Promise<string | null>((r) => askAnswers.set(id, r));
      busy = false;
      return choice === null ? print(`${C.red}no choice${C.off}`) : print(choice);
    }
    if (w[0] === "run") {
      const cmd = w.slice(w.indexOf("--") + 1).join(" ") || "cargo test";
      busy = true;
      print(`${C.dim}running ${cmd} ...${C.off}`);
      await new Promise((r) => setTimeout(r, 1800));
      busy = false;
      print(`${C.green}done in 1.8 s, exit code 0${C.off}`);
      return void mockNotice({ appName: flag(w, "-s") ?? "crest-notify", title: `${cmd} finished`, body: "Exit code 0", exitCode: 0, durationMs: 1800, command: cmd });
    }
    const title = w[0];
    if (!title || title.startsWith("-")) return print(`${C.red}usage: crest-notify <title> [-b body] [-s source] [-p progress]${C.off}`);
    const progress = flag(w, "-p");
    mockNotice({ title, body: flag(w, "-b") ?? "", appName: flag(w, "-s") ?? "crest-notify", replace: flag(w, "-r") ?? null, progress: progress === undefined ? null : Number(progress) });
  }

  return {
    start() {
      print(`${C.cyan}Crest demo shell${C.off}. Type ${C.yellow}help${C.off}, or try:`, `${C.green}crest-notify "Build finished" -b "Tests passed"${C.off}`, "");
      prompt();
    },
    write(data: string) {
      if (busy || !alive) return;
      // Arrow keys arrive as escape sequences; up and down walk the history.
      if (data === "\x1b[A" || data === "\x1b[B") {
        if (!history.length) return;
        at = Math.max(0, Math.min(history.length, at + (data === "\x1b[A" ? -1 : 1)));
        say(`${"\b \b".repeat(line.length)}`);
        line = history[at] ?? "";
        return say(line);
      }
      if (data.startsWith("\x1b")) return;
      for (const ch of data) {
        if (ch === "\r") {
          const cmd = line;
          line = "";
          if (cmd.trim()) history.push(cmd);
          at = history.length;
          say("\r\n");
          void run(cmd).then(() => alive && !busy && prompt());
          if (busy) return;
        } else if (ch === "\x7f") {
          if (line) say("\b \b");
          line = line.slice(0, -1);
        } else if (ch === "\x03") {
          say(`^C\r\n`);
          line = "";
          prompt();
        } else if (ch >= " ") {
          line += ch;
          say(ch);
        }
      }
    },
    stop() {
      alive = false;
    },
  };
}
