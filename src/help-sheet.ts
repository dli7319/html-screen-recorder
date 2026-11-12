import { trapFocus } from './focus-trap';
import { countdownRunning } from './countdown';
import { SHORTCUT_DOCS } from './shortcuts';

/**
 * The keyboard shortcuts cheat sheet.
 *
 * The recorder is keyboard-first (R / P / S / Shift+S) but the keys were only
 * discoverable from button tooltips - hover-only, and only for the buttons
 * that happened to carry one. This sheet is the reference: the header help
 * button opens it with the pointer, `?` opens it from the keyboard, and the
 * rows are rendered from SHORTCUT_DOCS so the sheet is literally built from
 * the same table the bindings are tested against - it cannot document a key
 * that does not exist or miss one that does.
 *
 * It is a modal dialog like the settings drawer: scrim, focus trap, Escape to
 * close, focus back on the invoker. Escape defers to a running countdown,
 * matching the drawer and the preview - one press must never do two things.
 *
 * State lives on <body> as `data-shortcuts`, the same shape as
 * `data-panel` / `data-preview`, so the shortcut layer's dialog gate can see
 * the sheet is open and keep Record/Screenshot from firing behind it.
 */
export class HelpSheet {
  private btn = document.getElementById('shortcutsBtn') as HTMLButtonElement;
  private scrim = document.getElementById('shortcutsScrim') as HTMLDivElement;
  private modal = document.getElementById('shortcutsModal') as HTMLDivElement;
  private closeBtn = document.getElementById(
    'closeShortcuts'
  ) as HTMLButtonElement;
  private rows = document.getElementById('shortcutRows') as HTMLDivElement;

  private releaseTrap: (() => void) | null = null;
  private invoker: HTMLElement;

  constructor() {
    this.invoker = this.btn;
    this.render();
  }

  /** Draw the sheet's rows from the one table of shortcuts. */
  private render() {
    for (const doc of SHORTCUT_DOCS) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      // The display string ('Shift+S') becomes one key cap per key.
      const keys = document.createElement('span');
      keys.className = 'shortcut-keys';
      for (const label of doc.keys.split('+')) {
        // The bare kbd element already carries the key-cap chip look (see the
        // `kbd` rule in styles.css), light and dark.
        const cap = document.createElement('kbd');
        cap.textContent = label;
        keys.append(cap);
      }

      const desc = document.createElement('span');
      desc.className = 'shortcut-desc';
      desc.textContent = doc.label;

      row.append(keys, desc);
      this.rows.append(row);
    }
  }

  bind() {
    this.btn.addEventListener('click', () => this.toggle(this.btn));
    this.closeBtn.addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      // Same deference as the settings drawer: while a countdown runs, Escape
      // is how it is cancelled, and a press meant for that must not also throw
      // the sheet away (or vice versa).
      if (e.key === 'Escape' && this.isOpen() && !countdownRunning()) {
        this.close();
      }
    });
  }

  isOpen(): boolean {
    return document.body.dataset.shortcuts === 'open';
  }

  open(source?: HTMLElement) {
    if (this.isOpen()) return;
    this.invoker = source ?? this.btn;
    document.body.dataset.shortcuts = 'open';
    this.modal.setAttribute('aria-hidden', 'false');
    this.btn.setAttribute('aria-expanded', 'true');
    this.releaseTrap?.();
    // The toast host joins the cycle so a take saved while the sheet is up
    // stays keyboard-reachable - the same affordance the drawer and the
    // preview give it.
    this.releaseTrap = trapFocus(this.modal, [
      document.getElementById('toastHost'),
    ]);
    this.closeBtn.focus();
  }

  close() {
    if (!this.isOpen()) return;
    document.body.dataset.shortcuts = 'closed';
    this.modal.setAttribute('aria-hidden', 'true');
    this.btn.setAttribute('aria-expanded', 'false');
    this.releaseTrap?.();
    this.releaseTrap = null;
    this.invoker.focus();
  }

  toggle(source?: HTMLElement) {
    if (this.isOpen()) this.close();
    else this.open(source);
  }
}
