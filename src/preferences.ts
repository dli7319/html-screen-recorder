/**
 * On-device UI preferences that outlive a reload.
 *
 * Only the "record on share" behaviour is persisted today: it is a workflow
 * preference the user sets once and expects to keep, unlike the capture
 * settings which are re-choosable each session. localStorage is the right home
 * for a small durable flag - the takes themselves use IndexedDB because they
 * hold large blobs.
 */

const RECORD_ON_SHARE_KEY = 'html-screen-recorder:recordOnShare';

/**
 * Whether a share should start recording on its own.
 *
 * Defaults to ON: the whole point of sharing is to capture, so the second
 * "Record" click is friction most people do not want. A null entry (never set)
 * therefore reads true; only an explicit stored "false" turns it off.
 */
export function getRecordOnShare(): boolean {
  const raw = localStorage.getItem(RECORD_ON_SHARE_KEY);
  return raw === null ? true : raw === 'true';
}

export function setRecordOnShare(on: boolean): void {
  localStorage.setItem(RECORD_ON_SHARE_KEY, String(on));
}
