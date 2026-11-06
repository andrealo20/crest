/*
 * What the fake desktop (npm run dev, the try-it demo) answers for `claude agents --json`: four sessions with the
 * documented fields. The times are relative to now, so the rows always look recent.
 */
export function sampleAgentsText(): Promise<string> {
  const now = Date.now();
  const min = 60_000;
  const rows = [
    {
      cwd: "C:\\Users\\demo\\crest",
      kind: "interactive",
      startedAt: now - 47 * min,
      pid: 4120,
      status: "waiting",
      waitingFor: "permission prompt",
      sessionId: "3f1d6c52-8a47-4d0e-9b6a-1c2e5f7a9b30",
      name: "Tune the notch spring",
    },
    {
      cwd: "C:\\Users\\demo\\site",
      kind: "background",
      startedAt: now - 12 * min,
      id: "a1b2c3",
      state: "working",
      pid: 5521,
      status: "busy",
      sessionId: "7c0b9e11-2d34-4f58-8a61-0e9d3b4c5a72",
      name: "Update dependencies",
    },
    // No name yet: the row is called after the folder.
    { cwd: "C:\\Users\\demo\\docs", kind: "interactive", startedAt: now - 3 * min, pid: 6001, status: "idle", sessionId: "b2d94a07-5c13-4e86-a0f2-91c7d3e8b645" },
    {
      cwd: "C:\\Users\\demo\\notes",
      kind: "background",
      startedAt: now - 190 * min,
      id: "d4e5f6",
      state: "done",
      sessionId: "e8a31f60-9b27-4c5d-8e04-3a6b7c1d2f95",
      name: "Draft the release notes",
    },
  ];
  return new Promise((done) => setTimeout(() => done(JSON.stringify(rows)), 250));
}
