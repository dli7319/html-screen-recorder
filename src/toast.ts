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
 */

let timer: number | undefined;

/** Show `message` bottom-centre for a few seconds, replacing any current one. */
export function showToast(message: string): void {
  const host = document.getElementById('toastHost');
  const text = document.getElementById('toastText');
  if (!host || !text) return;

  text.textContent = message;
  host.classList.add('is-visible');

  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    host.classList.remove('is-visible');
  }, 3200);
}

/** Drop the toast immediately (used on teardown/tests, not by actions). */
export function hideToast(): void {
  window.clearTimeout(timer);
  timer = undefined;
  document.getElementById('toastHost')?.classList.remove('is-visible');
}
