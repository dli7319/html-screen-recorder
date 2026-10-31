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

/**
 * How many countdowns are ticking right now.
 *
 * Escape is shared between cancelling a countdown and dismissing an open
 * dialog, and one keypress was doing both - a press meant to close the
 * settings drawer (or the preview) silently killed the 3-2-1 along with it.
 * The dialogs ask {@link countdownRunning} before treating Escape as theirs,
 * so while a count is on, Escape cancels it and leaves the dialog for the
 * next press. Counted rather than flagged so a replaced or abandoned handle
 * can never leave the signal stuck on.
 */
let ticking = 0;

/**
 * True while a countdown is still counting down. False the moment it is done
 * or cancelled - including the synchronous "countdown off" case, which never
 * ticks at all.
 */
export function countdownRunning(): boolean {
  return ticking > 0;
}

export function runCountdown(options: CountdownOptions): CountdownHandle {
  const { seconds, onTick, onDone, onCancel } = options;

  let timerId: number | null = null;
  let finished = false;
  let cancelled = false;
  ticking += 1;

  /** Drop this countdown's claim on the running signal, exactly once. */
  const release = () => {
    ticking -= 1;
  };

  const finish = () => {
    if (finished || cancelled) return;
    finished = true;
    timerId = null;
    // Released before the callback so anything the callback triggers sees the
    // countdown as gone - `onDone` starts a capture, and Escape during that
    // setup must not think a count is still owning the key.
    release();
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
      release();
      onCancel?.();
    },
    isActive() {
      return !finished && !cancelled;
    },
  };
}
