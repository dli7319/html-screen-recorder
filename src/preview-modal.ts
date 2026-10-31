import { Take, TakeStore } from './takes';
import { renameFilename } from './filename';
import {
  canCopyImages,
  copyImageToClipboard,
  downloadBlob,
} from './screenshot';
import { trapFocus } from './focus-trap';
import { showToast } from './toast';
import { countdownRunning } from './countdown';

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
 * actions that matter from here - saving it, and for a still, copying it to
 * the clipboard.
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
  private copyBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private counter: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private removeBtn: HTMLButtonElement;
  private renameBtn: HTMLButtonElement;
  /** Shown in place of the title while a rename is being typed. */
  private renameInput: HTMLInputElement;

  /** Which take is on screen, if any. */
  private currentId: string | null = null;
  /** True while the rename field is showing and owns the title's slot. */
  private renaming = false;
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

  /**
   * Which takes the dialog walks, and in what order. Handed in by the gallery
   * so prev/next and the counter follow the rows actually on screen - the
   * store is always newest-first and unfiltered, and navigation that steps
   * through takes the user cannot see (or in an order they did not ask for)
   * reads as broken. Optional so a bare dialog still works against the store.
   */
  private orderFn?: () => readonly Take[];

  constructor(
    private root: ParentNode,
    private store: TakeStore,
    order?: () => readonly Take[]
  ) {
    this.orderFn = order;
    this.scrim = this.require('#previewScrim');
    this.modal = this.require('#previewModal');
    this.title = this.require('#previewTitle');
    this.mediaSlot = this.require('#previewMedia');
    this.downloadBtn = this.require('#previewDownload') as HTMLButtonElement;
    this.copyBtn = this.require('#previewCopy') as HTMLButtonElement;
    this.closeBtn = this.require('#previewClose') as HTMLButtonElement;
    this.counter = this.require('#previewCounter');
    this.prevBtn = this.require('#previewPrev') as HTMLButtonElement;
    this.nextBtn = this.require('#previewNext') as HTMLButtonElement;
    this.removeBtn = this.require('#previewRemove') as HTMLButtonElement;
    this.renameBtn = this.require('#previewRename') as HTMLButtonElement;
    this.renameInput = this.require('#previewRenameInput') as HTMLInputElement;
  }

  private require(selector: string): HTMLElement {
    const el = this.root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Preview markup is missing ${selector}`);
    return el;
  }

  /** The takes to navigate: the gallery's current view, or the store alone. */
  private order(): readonly Take[] {
    return this.orderFn ? this.orderFn() : this.store.list();
  }

  /** Wire the chrome. The document-level pieces are undone by unbind(). */
  bind() {
    this.unsubscribe?.();
    this.unsubscribe = this.store.onChange(this.onStoreChange);
    this.closeBtn.addEventListener('click', this.onCloseClick);
    this.scrim.addEventListener('click', this.onCloseClick);
    this.downloadBtn.addEventListener('click', this.onDownload);
    this.copyBtn.addEventListener('click', this.onCopy);
    this.prevBtn.addEventListener('click', this.onPrev);
    this.nextBtn.addEventListener('click', this.onNext);
    this.removeBtn.addEventListener('click', this.onRemove);
    this.renameBtn.addEventListener('click', this.onRenameClick);
    this.renameInput.addEventListener('keydown', this.onRenameKeyDown);
    // Clicking away commits: the name is typed by then, and a rename that
    // evaporates on a stray click is worse than one that saves.
    this.renameInput.addEventListener('blur', this.onRenameBlur);
    document.addEventListener('keydown', this.onKeyDown);
  }

  unbind() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.closeBtn.removeEventListener('click', this.onCloseClick);
    this.scrim.removeEventListener('click', this.onCloseClick);
    this.downloadBtn.removeEventListener('click', this.onDownload);
    this.copyBtn.removeEventListener('click', this.onCopy);
    this.prevBtn.removeEventListener('click', this.onPrev);
    this.nextBtn.removeEventListener('click', this.onNext);
    this.removeBtn.removeEventListener('click', this.onRemove);
    this.renameBtn.removeEventListener('click', this.onRenameClick);
    this.renameInput.removeEventListener('keydown', this.onRenameKeyDown);
    this.renameInput.removeEventListener('blur', this.onRenameBlur);
    document.removeEventListener('keydown', this.onKeyDown);
    this.close();
  }

  open(take: Take, opener?: HTMLElement) {
    // Replace, never stack: a second open() gets the same dialog with new
    // contents. Tearing down the old media first means only one <video> can
    // ever be attached.
    this.clearMedia();
    // A rename in flight belongs to the take being replaced; drop its field
    // before the new take's name is written into the title.
    this.cancelRename();

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
    // Copy is for stills only (the clipboard takes an image) and only where
    // the browser can do it - a button that cannot work is worse than none.
    this.copyBtn.classList.toggle(
      'hidden',
      take.kind !== 'screenshot' || !canCopyImages()
    );
    this.setOpen(true);
    this.updateNav();
    this.releaseTrap?.();
    this.releaseTrap = trapFocus(this.modal);
    this.closeBtn.focus();
  }

  close() {
    if (this.currentId === null) return;
    this.clearMedia();
    this.cancelRename();
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
    // While a rename is being typed the dialog's keys belong to the field -
    // its own handler settles Enter and Escape, and arrows must not page
    // through takes mid-edit.
    if (this.renaming) return;
    if (e.key === 'Escape') {
      // While a countdown runs, Escape belongs to it (see shortcuts.ts and the
      // settings drawer in ui-manager.ts): this press cancels the count and
      // leaves the dialog for the next one. A press meant to abort the 3-2-1
      // must not also throw away the take being previewed.
      if (countdownRunning()) return;
      this.close();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // While the clip's own player has focus the arrows belong to it: they
      // are how a keyboard seeks inside the video, and swallowing them here
      // (with preventDefault, no less) made seeking impossible in the one
      // dialog that plays video. The gallery is steered from anywhere else -
      // and the Prev/Next buttons work regardless of focus.
      if (this.isPlayerTarget(e.target)) return;
      e.preventDefault();
      this.openRelative(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  /**
   * True when the keystroke came from the previewed clip's player - the
   * <video> itself or its controls, which retarget to it across the shadow
   * DOM. A still (or anything outside the media) is not a player: arrows
   * there keep navigating.
   */
  private isPlayerTarget(target: EventTarget | null): boolean {
    const video = this.mediaSlot.querySelector('video');
    return video !== null && target instanceof Node && video.contains(target);
  }

  private onDownload = () => {
    // Re-read the take rather than holding the one from open(): the row may
    // have been rebuilt since. A gone take downloads nothing.
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (take) downloadBlob(take.blob, take.filename);
  };

  /**
   * Put a still on the clipboard so it can be pasted straight into a chat or
   * doc - the other way to "keep" a screenshot besides a file download.
   * Clips stay out of it: the clipboard takes an image, not a video. Failure
   * is reported, not thrown - the blob is still there to download.
   */
  private onCopy = () => {
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (!take) return;
    void copyImageToClipboard(take.blob).then((ok) => {
      showToast(
        ok ? 'Copied image to clipboard' : 'Could not copy to clipboard'
      );
    });
  };

  /**
   * Swap the caption for a text field naming the take, with the base name
   * selected - renaming is about the name, and typing should not have to
   * fight the extension to replace it.
   */
  private onRenameClick = () => {
    const take = this.store.list().find((t) => t.id === this.currentId);
    if (!take) return;
    this.renaming = true;
    this.title.classList.add('hidden');
    this.renameInput.classList.remove('hidden');
    this.renameInput.value = take.filename;
    this.renameInput.focus();
    const dot = take.filename.lastIndexOf('.');
    this.renameInput.setSelectionRange(0, dot > 0 ? dot : take.filename.length);
  };

  /**
   * Enter saves, Escape abandons the edit. Every key is stopped here: the
   * document handler pages through takes on arrows and the window shortcuts
   * fire on bare letters, and both must be blind while a name is being typed.
   * Escape in particular must NOT reach the document handler, which would
   * close the whole dialog instead of just the edit.
   */
  private onRenameKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelRename();
      this.renameBtn.focus();
    }
  };

  /** Clicking away saves the name that is typed. */
  private onRenameBlur = () => this.commitRename();

  /** Apply the typed name to the take, or leave it be when it is empty. */
  private commitRename() {
    if (!this.renaming) return;
    const take = this.store.list().find((t) => t.id === this.currentId);
    const typed = this.renameInput.value;
    this.cancelRename();
    if (!take) return;
    // An empty name is refused, not applied: `renameFilename` returns null and
    // the old name simply stays. A name identical to the old one is a no-op
    // worth skipping so no toast claims something did not happen.
    const filename = renameFilename(take.filename, typed);
    if (filename === null || filename === take.filename) return;
    this.store.rename(take.id, filename);
    this.title.textContent = filename;
    this.modal.setAttribute('aria-label', filename);
    showToast(`Renamed to ${filename}`);
  }

  /** Put the caption back and drop the field without touching the take. */
  private cancelRename() {
    this.renaming = false;
    this.renameInput.classList.add('hidden');
    this.title.classList.remove('hidden');
  }

  /**
   * Remove the take being previewed and step to the next, so several can be
   * culled without closing the dialog each time. The toast offers Undo.
   */
  private onRemove = () => {
    // Undo goes back at the take's position in the STORE (that list has its
    // own order); stepping to the next take happens in the VIEW, which is
    // what the user is actually paging through.
    const storeList = this.store.list();
    const storeIdx = storeList.findIndex((t) => t.id === this.currentId);
    const take = storeList[storeIdx];
    if (!take) return;
    const viewIdx = this.order().findIndex((t) => t.id === this.currentId);
    const opener = this.opener;
    // Suppress the auto-close so remove() does not shut the dialog before we
    // pick where to go next.
    this.suppressAutoClose = true;
    const record = this.store.remove(take.id);
    this.suppressAutoClose = false;
    showToast(`Removed ${take.filename}`, {
      label: 'Undo',
      onClick: () => {
        if (record) this.store.reinsert(record, storeIdx < 0 ? 0 : storeIdx);
      },
    });
    // Step to whatever now sits at the removed position (or the new last one),
    // or close if that was the only take left in view.
    const remaining = this.order();
    const at = viewIdx < 0 ? 0 : viewIdx;
    const next = remaining[Math.min(at, remaining.length - 1)];
    if (next) this.open(next, opener ?? undefined);
    else this.close();
  };

  private onPrev = () => this.openRelative(-1);
  private onNext = () => this.openRelative(1);

  /**
   * Move to a neighbouring take in the gallery's view order - the rows as the
   * user sorted and filtered them, not the store's fixed newest-first list.
   */
  private openRelative(offset: number) {
    const list = this.order();
    const idx = list.findIndex((t) => t.id === this.currentId);
    const target = list[idx + offset];
    if (idx < 0 || !target) return;
    // Keep the original opener so close() still returns focus where it came
    // from, even after stepping through several takes.
    this.open(target, this.opener ?? undefined);
  }

  /** Position in the view, and which way there is left to go. */
  private updateNav() {
    const list = this.order();
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
