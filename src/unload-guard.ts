/**
 * Warn before the page unloads while a capture is still in flight.
 *
 * A reload or tab close destroys a MediaRecorder mid-stream: no take has landed
 * yet, so the clip is simply gone. Takes that already made it into the store are
 * cached in IndexedDB and come back after a reload, so the guard only fires while
 * a capture is actually being recorded or written out - never to nag about a
 * gallery of already-saved takes.
 *
 * Returns a teardown that removes the listener, so tests (and any future
 * teardown path) can undo it.
 */
export function installUnloadGuard(isCapturing: () => boolean): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    if (!isCapturing()) return;
    // preventDefault() is what raises the browser's "leave site?" dialog.
    event.preventDefault();
    // Legacy Chrome reads returnValue rather than the cancelled flag.
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
