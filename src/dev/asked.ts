/** Whether `question` holds the fixed words of a prompt template, in order; its {placeholders} (which can open the text) match anything. */
export function hasFixedWords(question: string, template: string): boolean {
  const q = question.toLowerCase();
  const parts = template.toLowerCase().split(/\{\w+\}/).map((p) => p.trim()).filter(Boolean);
  let from = 0;
  return (
    parts.length > 0 &&
    parts.every((p) => {
      const at = q.indexOf(p, from);
      from = at + p.length;
      return at >= 0;
    })
  );
}
