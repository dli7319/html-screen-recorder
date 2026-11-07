/**
 * Keep the screen awake while a take is recording.
 *
 * A take can run for a long time with nobody touching the keyboard, and a
 * machine that sleeps mid-capture freezes the recording and loses whatever
 * had not been written yet. The Wake Lock API is exactly the tool for this:
 * it asks the platform to hold the display on for as long as this page says
 * so, with no permission prompt and no lasting effect once released.
 *
 * Everything here is best-effort by design. The API is absent in some
 * browsers and denied in some contexts, and a wake lock is never worth
 * disturbing a recording for: failures are swallowed and the app behaves
 * exactly as it did before the feature existed.
 *
 * The platform hands the lock back whenever the document hides (tab switch,
 * screen lock), so a take still recording when the user returns needs the
 * lock asked for again - `refresh()` exists for that, driven by
 * `visibilitychange`.
 */

/** The lock sentinel the platform hands back from `request()`. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** The `navigator.wakeLock` surface, for browsers that have it. */
export interface WakeLockManagerLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Owns one screen wake lock across a recording.
 *
 * The keeper remembers whether the screen *should* stay awake (`wanted`)
 * separately from whether a lock is currently held, because the two come
 * apart on their own: the platform reclaims the lock the moment the document
 * hides, while the recording it protected is still running.
 */
export class WakeLockKeeper {
  private held: WakeLockSentinelLike | null = null;
  private wanted = false;

  constructor(private manager: WakeLockManagerLike | null | undefined) {}

  /** True while a lock is believed to be held. */
  isHeld(): boolean {
    return this.held !== null && !this.held.released;
  }

  /**
   * Ask for the screen to stay awake. Idempotent, and never rejects: a
   * missing API or a denied request must not ripple into the capture path.
   */
  async acquire(): Promise<void> {
    this.wanted = true;
    await this.ensure();
  }

  /** Let the screen sleep again. Safe to call whether or not one is held. */
  async release(): Promise<void> {
    this.wanted = false;
    const held = this.held;
    this.held = null;
    if (held && !held.released) {
      try {
        await held.release();
      } catch {
        // Already gone - nothing to give back.
      }
    }
  }

  /**
   * Re-ask after the document becomes visible again, if the screen is still
   * supposed to stay awake. A no-op in every other state.
   */
  async refresh(): Promise<void> {
    await this.ensure();
  }

  private async ensure(): Promise<void> {
    if (!this.wanted || !this.manager) return;
    if (this.isHeld()) return;

    let sentinel: WakeLockSentinelLike;
    try {
      sentinel = await this.manager.request('screen');
    } catch {
      // Unsupported, denied, or transiently unavailable: the screen may
      // simply sleep as it did before this feature existed.
      return;
    }

    // The world may have moved during the await: the take may have ended, or
    // a lock may already be held. Either way this one is not wanted - give it
    // back rather than leak a lock nobody asked for.
    if (!this.wanted || this.isHeld()) {
      try {
        await sentinel.release();
      } catch {
        // Nothing to do.
      }
      return;
    }

    this.held = sentinel;
    sentinel.addEventListener('release', () => {
      // The platform reclaimed it (document hidden). Forget it so a later
      // refresh() asks for a new one instead of trusting a dead sentinel.
      if (this.held === sentinel) this.held = null;
    });
  }
}
