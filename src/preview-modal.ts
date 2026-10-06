import { Take, TakeStore } from './takes';
import { downloadBlob } from './screenshot';

/**
 * A take shown large: the clip playing, or the still at full size, with the
 * one action that matters from here - saving it.
 *
 * One modal, reused: opening again replaces the content rather than stacking
 * a second dialog. It watches the store because a take can vanish while it is
 * on screen (Remove, Clear) - a modal pointing at a revoked blob URL is worse
 * than no modal, so that is a close, not an error.
 *
 * Lifetime rules stay with the store: the media here borrows `take.url` and
 * `take.thumbnailUrl`, and closing detaches them from the element without
 * revoking anything.
 */
export class TakePreview {
  private scrim: HTMLElement;
  private modal: HTMLElement;
  private title: HTMLElement;
  private mediaSlot: HTMLElement;
  private downloadBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;

  /** Which take is on screen, if any. */
  private currentId: string | null = null;
  /** What had focus before open(), so closing puts the user back. */
  private opener: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private root: ParentNode,
    private store: TakeStore
  ) {
    this.scrim = this.require('#previewScrim');
    this.modal = this.require('#previewModal');
    this.title = this.require('#previewTitle');
    this.mediaSlot = this.require('#previewMedia');
    this.downloadBtn = this.require('#previewDownload') as HTMLButtonElement;
    this.closeBtn = this.require('#previewClose') as HTMLButtonElement;
  }

  private require(selector: string): HTMLElement {
    const el = this.root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Preview markup is missing ${selector}`);
    return el;
  }

  /** Wire the chrome. The document-level pieces are undone by unbind(). */
  bind() {
    this.unsubscribe?.();
    this.unsubscribe = this.store.onChange(this.onStoreChange);
    this.closeBtn.addEventListener('click', this.onCloseClick);
    this.scrim.addEventListener('click', this.onCloseClick);
    this.downloadBtn.addEventListener('click', this.onDownload);
    document.addEventListener('keydown', this.onKeyDown);
  }

  unbind() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.closeBtn.removeEventListener('click', this.onCloseClick);
    this.scrim.removeEventListener('click', this.onCloseClick);
    this.downloadBtn.removeEventListener('click', this.onDownload);
    document.removeEventListener('keydown', this.onKeyDown);
    this.close();
  }

  open(take: Take, opener?: HTMLElement) {
    // Replace, never stack: a second open() gets the same dialog with new
    // contents. Tearing down the old media first means only one <video> can
    // ever be attached.
    this.clearMedia();

    this.title.textContent = take.filename;
    this.modal.setAttribute('aria-label', take.filename);

    if (take.kind === 'recording') {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      // The thumbnail doubles as the poster: the dialog has something painted
      // the instant it opens, before the video's first frame is decoded.
      if (take.thumbnailUrl) video.poster = take.thumbnailUrl;
      video.src = take.url;
      this.mediaSlot.append(video);
    } else {
      const img = document.createElement('img');
      img.src = take.url;
      img.alt = take.filename;
      this.mediaSlot.append(img);
    }

    this.currentId = take.id;
    this.opener = opener ?? null;
    this.setOpen(true);
    this.closeBtn.focus();
  }

  close() {
    if (this.currentId === null) return;
    this.clearMedia();
    this.currentId = null;
    this.setOpen(false);
    // The opener may itself be gone - the row is rebuilt on every store
    // change - in which case this is a harmless no-op on a detached button.
    this.opener?.focus();
    this.opener = null;
  }

  private setOpen(open: boolean) {
    // State lives on <body> so styles.css can react to it, same as the
    // settings drawer's `data-panel`.
    document.body.dataset.preview = open ? 'open' : 'closed';
    this.modal.setAttribute('aria-hidden', String(!open));
  }

  /**
   * Detach the media without revoking anything. Clearing `src` stops a
   * playing clip at once - otherwise closing the dialog leaves its audio
   * running over the gallery.
   */
  private clearMedia() {
    const video = this.mediaSlot.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.mediaSlot.replaceChildren();
  }

  private onCloseClick = () => {
    this.close();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private onDownload = () => {
    // Re-read the take rather than holding the one from open(): the row may
    // have been rebuilt since. A gone take downloads nothing.
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (take) downloadBlob(take.blob, take.filename);
  };

  /**
   * A re-render or removal while the dialog is open. If the take is gone the
   * dialog closes; if it merely gained a thumbnail (extraction finishing on a
   * clip being previewed) the poster catches up.
   */
  private onStoreChange = () => {
    if (this.currentId === null) return;
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (!take) {
      this.close();
      return;
    }
    const video = this.mediaSlot.querySelector('video');
    if (video && take.thumbnailUrl) video.poster = take.thumbnailUrl;
  };
}
