/** Sends one patch at a time: while a send is in flight, newer patches merge into one that waits, so a drag ends on its last value. A failed send is dropped. */
export function lastWins<T extends object>(send: (patch: T) => Promise<unknown>): (patch: T) => void {
  let busy = false;
  let waiting: T | null = null;
  const run = () => {
    const patch = waiting;
    waiting = null;
    if (!patch) {
      busy = false;
      return;
    }
    send(patch).catch(() => {}).finally(run);
  };
  return (patch) => {
    waiting = waiting ? { ...waiting, ...patch } : patch;
    if (!busy) {
      busy = true;
      run();
    }
  };
}
