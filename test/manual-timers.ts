import type { Timers } from "@/lib/sync-engine";

/** A clock that only moves when the test says so, for driving the sync engine's triggers. */
export function manualTimers(): Timers & { advance: (ms: number) => void } {
  let now = 0;
  let nextHandle = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      pending.set(++nextHandle, { at: now + ms, callback });
      return nextHandle;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const [handle, next] = [...pending].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
        if (handle === undefined || !next || next.at > until) break;
        pending.delete(handle);
        now = next.at;
        next.callback();
      }
      now = until;
    },
  };
}
