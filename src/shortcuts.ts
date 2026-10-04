/**
 * Keyboard shortcuts for the recorder. The mapping is deliberately pure so it
 * can be reasoned about and tested without a DOM, and the binding is a thin
 * wrapper around it.
 *
 *   R      start recording
 *   P      pause / resume
 *   S      stop recording
 *   Shift+S  capture a still frame
 *
 * Plain letters only - modifiers are ignored so browser and OS shortcuts keep
 * working - and nothing fires while the user is typing in a form control.
 */

export type ShortcutAction = 'record' | 'pause' | 'stop' | 'screenshot';

/** Targets where a bare letter must stay a letter, not a command. */
export function isTypingTarget(target: unknown): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // `isContentEditable` is the right signal in a browser, but it is absent in
  // some DOM implementations, so fall back to the attribute. Both spellings are
  // coerced to a real boolean - this must never return undefined.
  if (target.isContentEditable === true) return true;
  const editable = target.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

interface ShortcutEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target?: unknown;
}

/**
 * Map a key event to an action, or null when it is not a shortcut.
 *
 * Returns null for typing targets and for any chord with a modifier, so
 * Cmd/Ctrl/Alt combinations never trigger a recording.
 */
export function matchShortcut(event: ShortcutEvent): ShortcutAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;

  switch (event.key.toLowerCase()) {
    case 'r':
      return 'record';
    case 'p':
      return 'pause';
    case 's':
      // Shift+S is the still-capture chord; bare S stops the recording.
      return event.shiftKey ? 'screenshot' : 'stop';
    default:
      return null;
  }
}

export interface ShortcutHandlers {
  onRecord?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onScreenshot?: () => void;
}

/** Bind the shortcuts and return an unsubscribe function. */
export function bindShortcuts(handlers: ShortcutHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const action = matchShortcut(event);
    if (!action) return;

    // The letter must not also end up in a focused control.
    event.preventDefault();

    switch (action) {
      case 'record':
        handlers.onRecord?.();
        break;
      case 'pause':
        handlers.onPause?.();
        break;
      case 'stop':
        handlers.onStop?.();
        break;
      case 'screenshot':
        handlers.onScreenshot?.();
        break;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
