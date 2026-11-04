/**
 * Keep keyboard focus inside a modal while it is open.
 *
 * Both overlays (the take preview and the settings drawer) declare
 * `role="dialog"`, but without a trap the Tab key walks straight out behind the
 * scrim and into the page underneath - a screen-reader or keyboard user then
 * operates controls they cannot see. This wraps Tab from the last focusable
 * element back to the first (and Shift+Tab from the first to the last), so the
 * dialog is the only thing reachable until it closes.
 *
 * `extras` are tabbable hosts outside the dialog that must STAY reachable while
 * it is open - specifically the toast's Undo/View action, which lives in
 * `#toastHost` after the dialogs in the DOM. Without them the trap wrapped at
 * the dialog's own edge and the keyboard could never reach the only undo a
 * dialog-driven Remove offers: a destructive action whose reversal was
 * mouse-only. Extras join the focus cycle (the wrap boundary moves past them)
 * and count as inside, so focus never gets yanked away from them mid-reach.
 * Their own visibility rules apply - the toast action carries `hidden` when no
 * action is up, so it joins and leaves the cycle as toasts come and go.
 *
 * Focus *return* on close is each dialog's own job (they know their invoker);
 * this only handles the cycling while open. Returns the teardown.
 */

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      !el.classList.contains('hidden') &&
      el.getAttribute('aria-hidden') !== 'true'
  );
}

export function trapFocus(
  container: HTMLElement,
  extras: readonly (ParentNode | null)[] = []
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    // Re-read every press: the extras' visibility changes while the dialog is
    // open (a toast comes and goes), and the boundary must follow it.
    const extraItems = extras.flatMap((extra) =>
      extra ? focusable(extra) : []
    );
    const items = [...focusable(container), ...extraItems];
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // An extra counts as inside, or the escape hatch below would yank focus
    // back into the dialog the moment it was reached.
    const inside = active
      ? container.contains(active) || extraItems.includes(active)
      : false;

    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // On document, not the container: Tab can start from focus that has escaped
  // the dialog (a click on the page behind it), and only a document-level
  // listener catches that and pulls focus back in.
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
