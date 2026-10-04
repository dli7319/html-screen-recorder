import { Take, TakeStore } from './takes';
import { formatBytes, formatDuration } from './format';
import { downloadBlob } from './screenshot';

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

  constructor(
    private root: HTMLElement,
    private store: TakeStore
  ) {
    this.list = this.require('#takeList');
    this.emptyState = this.require('#takesEmpty');
    this.count = this.require('#takeCount');
    this.downloadAllBtn = this.require('#downloadAllBtn') as HTMLButtonElement;
    this.clearBtn = this.require('#clearTakesBtn') as HTMLButtonElement;
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

    this.render();
  }

  unbind() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.downloadAllBtn.removeEventListener('click', this.onDownloadAll);
    this.clearBtn.removeEventListener('click', this.onClear);
  }

  private onDownloadAll = () => {
    downloadAll(this.store.list());
  };

  private onClear = () => {
    this.store.clear();
  };

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

    const icon = document.createElement('span');
    icon.className = 'text-lg leading-none shrink-0';
    icon.textContent = take.kind === 'recording' ? '🎬' : '📷';
    icon.title = take.kind === 'recording' ? 'Recording' : 'Screenshot';

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

    detail.append(name, meta);

    const download = document.createElement('button');
    download.type = 'button';
    download.className =
      'text-sm text-blue-600 dark:text-blue-400 hover:underline shrink-0';
    download.textContent = 'Download';
    download.title = `Download ${take.filename}`;
    download.addEventListener('click', () => {
      downloadBlob(take.blob, take.filename);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    // Explicit dark override rather than reusing one grey: text-gray-400 is
    // fine on the dark card but only reaches 2.6:1 on white, well under AA.
    remove.className =
      'text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 shrink-0';
    remove.textContent = 'Remove';
    remove.title = `Remove ${take.filename} from the gallery`;
    remove.addEventListener('click', () => this.store.remove(take.id));

    row.append(icon, detail, download, remove);
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
