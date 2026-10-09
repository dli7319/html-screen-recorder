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
 * Focus *return* on close is each dialog's own job (they know their invoker);
 * this only handles the cycling while open. Returns the teardown.
 */

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      !el.classList.contains('hidden') &&
      el.getAttribute('aria-hidden') !== 'true'
  );
}

export function trapFocus(container: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = active ? container.contains(active) : false;

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
