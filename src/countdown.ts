/**
 * The 3-2-1 that runs before a capture starts.
 *
 * Deliberately its own module rather than a couple of setTimeout calls in the
 * record handler: a countdown has a state machine (running, finished,
 * cancelled) and getting the transitions wrong is how you end up with a
 * recording that starts twice, or a stopwatch that ticks through the countdown
 * and reports the wrong length.
 */

export interface CountdownOptions {
  /** How many seconds to count. Zero or less starts immediately. */
  seconds: number;
  /** Called with the number still to go, starting at `seconds`. */
  onTick?: (remaining: number) => void;
  /** Called once the count has run out. */
  onDone: () => void;
  /** Called instead of `onDone` when cancelled. */
  onCancel?: () => void;
}

export interface CountdownHandle {
  /** Stop the countdown. Safe to call at any point, including after it ended. */
  cancel(): void;
  /** True while the countdown is still running. */
  isActive(): boolean;
}

export function runCountdown(options: CountdownOptions): CountdownHandle {
  const { seconds, onTick, onDone, onCancel } = options;

  let timerId: number | null = null;
  let finished = false;
  let cancelled = false;

  const finish = () => {
    if (finished || cancelled) return;
    finished = true;
    timerId = null;
    onDone();
  };

  const tick = (remaining: number) => {
    if (cancelled) return;

    if (remaining <= 0) {
      finish();
      return;
    }

    onTick?.(remaining);
    timerId = window.setTimeout(() => tick(remaining - 1), 1000);
  };

  // A non-positive count is the "countdown off" case, not an error: the caller
  // asked for zero seconds and should get its onDone straight away.
  if (seconds <= 0) {
    finish();
  } else {
    tick(seconds);
  }

  return {
    cancel() {
      // Idempotent, and a no-op once the countdown has already finished - a
      // stray cancel must never fire onCancel after onDone.
      if (finished || cancelled) return;
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      onCancel?.();
    },
    isActive() {
      return !finished && !cancelled;
    },
  };
}
