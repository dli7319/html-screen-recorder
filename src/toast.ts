/**
 * A single transient confirmation shown bottom-centre for a few seconds.
 *
 * Every take action used to fire silently: "Download all" kicked off N downloads,
 * "Remove" made a row vanish, "Clear" wiped the gallery - each with no trace that
 * it happened. This is the one shared way an action says "it worked" (or what it
 * did), so a click never leaves you wondering.
 *
 * It doubles as a live region (`role="status" aria-live="polite"` on the host in
 * index.html), so a screen reader hears the same confirmation everyone else sees.
 * One host element is reused and re-timed; a burst of actions shows the latest
 * message rather than stacking a pile of toasts.
 *
 * An optional action (e.g. Undo) turns a confirmation into a way to reverse the
 * thing it just reported. The handler is replaced on every show, so a stale
 * Undo can never fire from a previous toast.
 *
 * The auto-dismiss countdown only runs while the toast can actually be acted
 * on. The pointer resting on the pill, keyboard focus inside it, or the tab
 * sitting in the background all hold the clock where it is; the moment the
 * user comes back the toast resumes with the time it had left. Without that,
 * an Undo toast expired mid-reach (or while the user was reading another tab),
 * which is exactly when it matters. The pill still never takes pointer events
 * (see styles.css) so a confirmation never blocks the gallery - the hover
 * check is a window-level hit test against the pill's own rect, so holding the
 * clock never swallows a click on whatever sits beneath it.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

let timer: number | undefined;
/** When the armed timer would fire, if it were not being held. */
let deadline = 0;
/** Time left at the moment the countdown was held. */
let remaining = 0;
/** Whether the countdown is currently held (timer cleared, `remaining` kept). */
let held = false;
/** Pointer is over the pill (window-level hit test; the pill ignores events). */
let pointerOver = false;
/** Keyboard focus is inside the toast host. */
let focusWithin = false;
/** The host the hold listeners are attached to, while a toast is up. */
let watchedHost: HTMLElement | null = null;

/** True while the user cannot reasonably reach the toast right now. */
function holding(): boolean {
  return pointerOver || focusWithin || document.hidden;
}

/**
 * Start (or restart) the countdown for `ms`. If the user cannot act on the
 * toast right now the clock is held immediately and only starts running once
 * they come back to it.
 */
function arm(ms: number): void {
  window.clearTimeout(timer);
  remaining = ms;
  held = false;
  deadline = Date.now() + ms;
  timer = window.setTimeout(hideToast, ms);
  syncHold();
}

/** Hold or release the countdown to match the current holding() state. */
function syncHold(): void {
  if (holding()) {
    if (!held && timer !== undefined) {
      remaining = Math.max(0, deadline - Date.now());
      window.clearTimeout(timer);
      timer = undefined;
      held = true;
    }
  } else if (held) {
    held = false;
    deadline = Date.now() + remaining;
    timer = window.setTimeout(hideToast, remaining);
  }
}

function onPointerMove(e: Event): void {
  const { clientX, clientY } = e as PointerEvent;
  const host = document.getElementById('toastHost');
  if (!host) return;
  const r = host.getBoundingClientRect();
  pointerOver =
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom;
  syncHold();
}

function onFocusIn(): void {
  focusWithin = true;
  syncHold();
}

function onFocusOut(e: Event): void {
  const next = (e as FocusEvent).relatedTarget as Node | null;
  focusWithin = next ? (watchedHost?.contains(next) ?? false) : false;
  syncHold();
}

function onVisibilityChange(): void {
  syncHold();
}

/** Attach the hold listeners for the lifetime of one toast. Idempotent. */
function watch(host: HTMLElement): void {
  if (watchedHost === host) return;
  unwatch();
  watchedHost = host;
  window.addEventListener('pointermove', onPointerMove);
  host.addEventListener('focusin', onFocusIn);
  host.addEventListener('focusout', onFocusOut);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

/** Detach the hold listeners and drop any held state with them. */
function unwatch(): void {
  if (watchedHost) {
    watchedHost.removeEventListener('focusin', onFocusIn);
    watchedHost.removeEventListener('focusout', onFocusOut);
    watchedHost = null;
  }
  window.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  pointerOver = false;
  focusWithin = false;
}

/**
 * Show `message` bottom-centre, replacing any current one. With `action`, an
 * Undo-style button rides along and the toast lingers a little longer so it can
 * actually be reached.
 */
export function showToast(message: string, action?: ToastAction): void {
  const host = document.getElementById('toastHost');
  const text = document.getElementById('toastText');
  const btn = document.getElementById(
    'toastAction'
  ) as HTMLButtonElement | null;
  if (!host || !text) return;

  text.textContent = message;

  if (btn) {
    if (action) {
      btn.textContent = action.label;
      btn.classList.remove('hidden');
      btn.onclick = () => {
        action.onClick();
        hideToast();
      };
    } else {
      btn.classList.add('hidden');
      btn.onclick = null;
    }
  }

  host.classList.add('is-visible');

  watch(host);
  arm(action ? 5200 : 3200);
}

/** Drop the toast immediately (used on teardown/tests, not by actions). */
export function hideToast(): void {
  window.clearTimeout(timer);
  timer = undefined;
  held = false;
  remaining = 0;
  unwatch();
  const host = document.getElementById('toastHost');
  host?.classList.remove('is-visible');
  const btn = document.getElementById(
    'toastAction'
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.onclick = null;
    btn.classList.add('hidden');
  }
}
