import { Take, TakeStore } from './takes';
import { downloadBlob } from './screenshot';
import { trapFocus } from './focus-trap';
import { showToast } from './toast';

/**
 * The aspect the media box takes. The box itself is sized in CSS from these
 * variables (falling back to 16:9), so setting them keeps a clip's own shape
 * even when the element that knows the shape loads late. `--preview-ar-k` is
 * the same ratio as a plain number, which the width cap multiplies by to fit
 * the box exactly - a height cap alone would leave black bars wherever the
 * box ends up wider than its content.
 */
function setMediaAspect(
  video: HTMLVideoElement,
  width: number,
  height: number
) {
  video.style.setProperty('--preview-ar', `${width} / ${height}`);
  video.style.setProperty('--preview-ar-k', String(width / height));
}

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
  private counter: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private removeBtn: HTMLButtonElement;

  /** Which take is on screen, if any. */
  private currentId: string | null = null;
  /** What had focus before open(), so closing puts the user back. */
  private opener: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Teardown for the focus trap, active only while the dialog is open. */
  private releaseTrap: (() => void) | null = null;
  /**
   * Set while the dialog removes a take itself, so the store-change handler
   * does not also close the dialog out from under the "step to the next take"
   * curating flow.
   */
  private suppressAutoClose = false;

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
    this.counter = this.require('#previewCounter');
    this.prevBtn = this.require('#previewPrev') as HTMLButtonElement;
    this.nextBtn = this.require('#previewNext') as HTMLButtonElement;
    this.removeBtn = this.require('#previewRemove') as HTMLButtonElement;
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
    this.prevBtn.addEventListener('click', this.onPrev);
    this.nextBtn.addEventListener('click', this.onNext);
    this.removeBtn.addEventListener('click', this.onRemove);
    document.addEventListener('keydown', this.onKeyDown);
  }

  unbind() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.closeBtn.removeEventListener('click', this.onCloseClick);
    this.scrim.removeEventListener('click', this.onCloseClick);
    this.downloadBtn.removeEventListener('click', this.onDownload);
    this.prevBtn.removeEventListener('click', this.onPrev);
    this.nextBtn.removeEventListener('click', this.onNext);
    this.removeBtn.removeEventListener('click', this.onRemove);
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
      // The box is sized from the clip's aspect, but a <video> does not know
      // its own dimensions until metadata - which MediaRecorder MP4s often
      // only hand over at playback. Two cheaper sources fill the gap: the
      // thumbnail's aspect (it was cut from this very clip), then the real
      // metadata whenever it does arrive. Until either lands the CSS
      // fallback's 16:9 stands, so the box never opens at the 300x150
      // default.
      if (take.thumbnailUrl) {
        const probe = new Image();
        probe.addEventListener('load', () => {
          if (this.currentId === take.id && probe.naturalWidth > 0) {
            setMediaAspect(video, probe.naturalWidth, probe.naturalHeight);
          }
        });
        probe.src = take.thumbnailUrl;
      }
      video.addEventListener('loadedmetadata', () => {
        if (video.videoWidth > 0) {
          setMediaAspect(video, video.videoWidth, video.videoHeight);
        }
      });
    } else {
      const img = document.createElement('img');
      img.src = take.url;
      img.alt = take.filename;
      this.mediaSlot.append(img);
    }

    this.currentId = take.id;
    this.opener = opener ?? null;
    this.setOpen(true);
    this.updateNav();
    this.releaseTrap?.();
    this.releaseTrap = trapFocus(this.modal);
    this.closeBtn.focus();
  }

  close() {
    if (this.currentId === null) return;
    this.clearMedia();
    this.currentId = null;
    this.setOpen(false);
    this.releaseTrap?.();
    this.releaseTrap = null;
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
    if (this.currentId === null) return;
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.openRelative(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.openRelative(1);
    }
  };

  private onDownload = () => {
    // Re-read the take rather than holding the one from open(): the row may
    // have been rebuilt since. A gone take downloads nothing.
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (take) downloadBlob(take.blob, take.filename);
  };

  /**
   * Remove the take being previewed and step to the next, so several can be
   * culled without closing the dialog each time. The toast offers Undo.
   */
  private onRemove = () => {
    const list = this.store.list();
    const idx = list.findIndex((t) => t.id === this.currentId);
    const take = list[idx];
    if (!take) return;
    const opener = this.opener;
    // Suppress the auto-close so remove() does not shut the dialog before we
    // pick where to go next.
    this.suppressAutoClose = true;
    const record = this.store.remove(take.id);
    this.suppressAutoClose = false;
    showToast(`Removed ${take.filename}`, {
      label: 'Undo',
      onClick: () => {
        if (record) this.store.reinsert(record, idx < 0 ? 0 : idx);
      },
    });
    // Step to whatever now sits at the removed position (or the new last one),
    // or close if that was the only take left.
    const remaining = this.store.list();
    const next = remaining[Math.min(idx, remaining.length - 1)];
    if (next) this.open(next, opener ?? undefined);
    else this.close();
  };

  private onPrev = () => this.openRelative(-1);
  private onNext = () => this.openRelative(1);

  /** Move to a neighbouring take in list order (the gallery is newest-first). */
  private openRelative(offset: number) {
    const list = this.store.list();
    const idx = list.findIndex((t) => t.id === this.currentId);
    const target = list[idx + offset];
    if (idx < 0 || !target) return;
    // Keep the original opener so close() still returns focus where it came
    // from, even after stepping through several takes.
    this.open(target, this.opener ?? undefined);
  }

  /** Position in the list, and which way there is left to go. */
  private updateNav() {
    const list = this.store.list();
    const idx = list.findIndex((t) => t.id === this.currentId);
    const total = list.length;
    const multi = total > 1;
    this.counter.textContent = multi ? `${idx + 1} / ${total}` : '';
    this.prevBtn.classList.toggle('hidden', !multi);
    this.nextBtn.classList.toggle('hidden', !multi);
    this.prevBtn.disabled = idx <= 0;
    this.nextBtn.disabled = idx >= total - 1;
  }

  /**
   * A re-render or removal while the dialog is open. If the take is gone the
   * dialog closes; if it merely gained a thumbnail (extraction finishing on a
   * clip being previewed) the poster catches up.
   */
  private onStoreChange = () => {
    // A dialog-driven removal handles its own next step; don't also close here.
    if (this.suppressAutoClose) return;
    if (this.currentId === null) return;
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (!take) {
      this.close();
      return;
    }
    const video = this.mediaSlot.querySelector('video');
    if (video && take.thumbnailUrl) video.poster = take.thumbnailUrl;
    // A neighbour may have been removed/added, shifting position and count.
    this.updateNav();
  };
}
