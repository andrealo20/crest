/**
 * The Markdown of PRIVACY.md as HTML, so the site shows the same text as the repository.
 * shortcut: only what that file uses (## and ### headings, paragraphs, - lists, tables, **bold**, *italic*, `code`,
 * [links](url)); a new construct in it shows as plain text until it is added here.
 */

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline marks on text that is escaped first, so the file can never inject markup. Code spans keep their content as is. */
export function inline(text: string): string {
  return escape(text)
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${part.slice(1, -1)}</code>`;
      return part
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|#[^\s)]*)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    })
    .join("");
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function markdown(source: string): string {
  const out: string[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (!line.trim()) {
      i++;
    } else if (heading) {
      const n = heading[1].length;
      out.push(`<h${n}>${inline(heading[2])}</h${n}>`);
      i++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.startsWith("|") && /^\|[\s|:-]+\|$/.test(lines[i + 1]?.trim() ?? "")) {
      const head = cells(line).map((c) => `<th scope="col">${inline(c)}</th>`).join("");
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(`<tr>${cells(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
      out.push(`<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\|)/.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
