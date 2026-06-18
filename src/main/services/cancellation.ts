// Cancellation helpers shared across pipeline steps.
//
// Two flavors of abort errors flow through the codebase:
//   - DOMException AbortError — from fetch() and the agents SDK
//   - Error('cancelled')      — our own marker for sleep timers and manual checks
// `isCancellation` recognises both so per-paper failure paths can re-throw
// instead of recording a fake "failure".

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => { clearTimeout(timer); reject(new Error('cancelled')); },
      { once: true },
    );
  });
}

export function isCancellation(err: unknown): boolean {
  if (err instanceof Error && err.message === 'cancelled') return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return false;
}
