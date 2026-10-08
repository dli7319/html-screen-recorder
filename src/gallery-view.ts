import { Take, TakeStore } from './takes';
import { TAKE_TTL_MS } from './take-cache';
import { formatBytes, formatDuration, formatExpiry } from './format';
import { downloadBlob } from './screenshot';
import { TakePreview } from './preview-modal';
import { showToast } from './toast';

/**
 * Renders the take list and its actions.
 *
 * Kept separate from UIManager because it is a view over a collection rather
 * than a set of fixed controls: it rebuilds itself when the store changes,
 * which is a different shape of job from wiring one button to one handler.
 *
 * It queries its own markup from a root element, so the gallery is one
 * self-contained block rather than another batch of element fields spread
 * across the manager.
 */
export class GalleryView {
  private list: HTMLElement;
  private emptyState: HTMLElement;
  private count: HTMLElement;
  private downloadAllBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;
  private expiryTimer: number | undefined;
  /** "Clear" is destructive and had no guard, so its click is two-step: the
   *  first arms it ("Confirm clear?"), the second acts. Armed reverts after a
   *  beat or on any other action so a stray half-click can't linger. */
  private clearArmed = false;
  private clearTimer: number | undefined;
  private readonly clearLabel = 'Clear';
  /** The one preview dialog rows open into. Lives at document level - the
   *  markup sits beside the settings drawer, not inside the gallery. */
  private preview: TakePreview;

  constructor(
    private root: HTMLElement,
    private store: TakeStore
  ) {
    this.list = this.require('#takeList');
    this.emptyState = this.require('#takesEmpty');
    this.count = this.require('#takeCount');
    this.downloadAllBtn = this.require('#downloadAllBtn') as HTMLButtonElement;
    this.clearBtn = this.require('#clearTakesBtn') as HTMLButtonElement;
    this.preview = new TakePreview(document, store);
  }

  private require(selector: string): HTMLElement {
    const el = this.root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Gallery markup is missing ${selector}`);
    return el;
  }

  /** Start rendering, wire the actions, and keep rendering as takes change. */
  bind() {
    this.unsubscribe?.();
    this.unsubscribe = this.store.onChange(() => this.render());

    this.downloadAllBtn.addEventListener('click', this.onDownloadAll);
    this.clearBtn.addEventListener('click', this.onClear);
    this.preview.bind();

    // Expiry labels are the one piece of row text that goes stale on its own:
    // "Expires in 30 minutes" is a lie within the hour if nothing re-times it.
    // Once a minute is well under the label's own granularity and cheap - the
    // ticks only rewrite span text, never the rows themselves.
    this.expiryTimer = window.setInterval(() => this.refreshExpiries(), 60_000);

    this.render();
  }

  unbind() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.downloadAllBtn.removeEventListener('click', this.onDownloadAll);
    this.clearBtn.removeEventListener('click', this.onClear);
    this.preview.unbind();
    if (this.expiryTimer !== undefined) {
      window.clearInterval(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    this.list.replaceChildren();
  }

  /**
   * Re-time every row's "Expires in ..." label in place. The rows keep their
   * identity so a background tick cannot steal focus or hover mid-read.
   */
  private refreshExpiries() {
    const labels = this.list.querySelectorAll<HTMLElement>('[data-expires-at]');
    for (const label of labels) {
      const expiresAt = Number(label.dataset.expiresAt);
      label.textContent = formatExpiry(expiresAt - Date.now());
    }
  }

  private onDownloadAll = () => {
    const takes = this.store.list();
    downloadAll(takes);
    const n = takes.length;
    showToast(`Downloading ${n} ${n === 1 ? 'take' : 'takes'}`);
  };

  private onClear = () => {
    // Two-step: first click arms ("Confirm clear?"), second actually clears.
    if (!this.clearArmed) {
      this.armClear();
      return;
    }
    const n = this.store.list().length;
    this.store.clear();
    this.disarmClear();
    showToast(`Cleared ${n} ${n === 1 ? 'take' : 'takes'}`);
  };

  /** First click: turn Clear into a danger-tinted "Confirm clear?" for a beat. */
  private armClear(): void {
    this.clearArmed = true;
    this.clearBtn.textContent = 'Confirm clear?';
    this.clearBtn.classList.add('is-armed');
    this.clearTimer = window.setTimeout(() => this.disarmClear(), 4000);
  }

  /** Revert Clear to idle: text, tint, armed flag, and any pending timer. */
  private disarmClear(): void {
    this.clearArmed = false;
    window.clearTimeout(this.clearTimer);
    this.clearTimer = undefined;
    this.clearBtn.textContent = this.clearLabel;
    this.clearBtn.classList.remove('is-armed');
  }

  render() {
    const takes = this.store.list();
    const has = takes.length > 0;

    this.emptyState.classList.toggle('hidden', has);
    this.downloadAllBtn.disabled = !has;
    this.clearBtn.disabled = !has;
    this.count.textContent = has
      ? `${takes.length} · ${formatBytes(this.store.totalBytes())}`
      : '';

    // Rebuild wholesale. The lists are small and this is far harder to get out
    // of sync than incremental patching.
    this.list.replaceChildren(...takes.map((take) => this.renderTake(take)));
  }

  private renderTake(take: Take): HTMLElement {
    const row = document.createElement('div');
    row.className =
      'flex items-center gap-3 py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0';
    row.dataset.takeId = take.id;

    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'take-thumb';
    icon.title = `Preview ${take.filename}`;
    icon.setAttribute('aria-label', `Preview ${take.filename}`);
    if (take.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = take.thumbnailUrl;
      img.alt = '';
      icon.append(img);
    } else {
      // No thumbnail yet (extraction is async) or never (it failed): the
      // glyph keeps the row complete and the button still previews the take.
      icon.textContent = take.kind === 'recording' ? '🎬' : '📷';
    }
    icon.addEventListener('click', () => this.preview.open(take, icon));
    // Hover plays the clip inside the thumbnail itself: muted, looping, no
    // controls - a moving preview, not a player. Screenshots have no motion
    // to show. The video is built on first hover and dropped on leave, so a
    // page of takes does not keep a page of decoders standing by.
    if (take.kind === 'recording') {
      icon.addEventListener('mouseenter', () =>
        this.startHoverPlay(icon, take)
      );
      icon.addEventListener('mouseleave', () => this.stopHoverPlay(icon));
    }

    const detail = document.createElement('div');
    detail.className = 'flex-1 min-w-0';

    const name = document.createElement('p');
    name.className =
      'text-sm font-medium text-gray-900 dark:text-gray-100 truncate';
    name.textContent = take.filename;
    name.title = take.filename;

    const meta = document.createElement('p');
    meta.className = 'text-xs text-gray-500 dark:text-gray-400';
    meta.textContent = [this.describeTake(take), take.formatName]
      .filter(Boolean)
      .join(' · ');

    // "Expires in 29 days" and friends: the retention window applied to when
    // this take was made. The hook is data-*, not a class, so refreshExpiries()
    // can re-time the labels in place - rebuilding the rows every tick would
    // yank focus and hover out from under anyone reading the list. The label
    // states the cache's policy; if a cache write failed (private window,
    // quota) the take simply won't survive a refresh, and this doesn't track
    // that per take.
    const expires = document.createElement('span');
    expires.className = 'text-xs text-gray-500 dark:text-gray-400 shrink-0';
    expires.dataset.expiresAt = String(take.createdAt + TAKE_TTL_MS);
    expires.textContent = formatExpiry(
      take.createdAt + TAKE_TTL_MS - Date.now()
    );

    detail.append(name, meta);

    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'btn btn--outline btn--sm shrink-0';
    download.textContent = 'Download';
    download.title = `Download ${take.filename}`;
    download.addEventListener('click', () => {
      downloadBlob(take.blob, take.filename);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    // A destructive secondary action: same outline pill as Download, but it
    // turns danger on hover so "Remove" still reads as destructive.
    remove.className = 'btn btn--outline btn--danger btn--sm shrink-0';
    remove.textContent = 'Remove';
    remove.title = `Remove ${take.filename} from the gallery`;
    remove.addEventListener('click', () => {
      this.store.remove(take.id);
      // The row vanishes instantly; the toast is the only trace it happened.
      const name =
        take.filename.length > 32
          ? `${take.filename.slice(0, 31)}…`
          : take.filename;
      showToast(`Removed ${name}`);
    });

    row.append(icon, detail, expires, download, remove);
    return row;
  }

  /** Length and size for a recording, just size for a screenshot. */
  private describeTake(take: Take): string {
    const parts = [formatBytes(take.size)];
    if (take.durationMs !== undefined) {
      parts.unshift(formatDuration(take.durationMs));
    }
    return parts.join(' · ');
  }

  /**
   * Play the take's clip inside its thumbnail box on hover.
   *
   * The video is muted and looping with no controls - it is a moving preview
   * of the thumbnail, not playback. Autoplay is only ever granted to muted
   * elements, and if the browser refuses anyway the still simply stays.
   */
  private startHoverPlay(thumb: HTMLElement, take: Take) {
    if (thumb.querySelector('video')) return;
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = take.url;
    thumb.append(video);
    void Promise.resolve(video.play()).catch(() => {});
  }

  /** Take the hover video back out, leaving the thumbnail as it was. */
  private stopHoverPlay(thumb: HTMLElement) {
    const video = thumb.querySelector('video');
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.remove();
  }
}

/**
 * Download every take in turn.
 *
 * Browsers throttle parallel downloads kicked off by a single gesture, so
 * these are spaced out rather than fired together. Returns how many queued.
 */
export function downloadAll(takes: readonly Take[], delayMs = 250): number {
  takes.forEach((take, index) => {
    window.setTimeout(
      () => downloadBlob(take.blob, take.filename),
      index * delayMs
    );
  });
  return takes.length;
}
