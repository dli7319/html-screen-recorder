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
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

let timer: number | undefined;

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

  const duration = action ? 5200 : 3200;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    host.classList.remove('is-visible');
    if (btn) {
      btn.onclick = null;
      btn.classList.add('hidden');
    }
  }, duration);
}

/** Drop the toast immediately (used on teardown/tests, not by actions). */
export function hideToast(): void {
  window.clearTimeout(timer);
  timer = undefined;
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
