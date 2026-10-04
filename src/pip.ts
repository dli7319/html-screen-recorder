/**
 * Picture-in-picture for the preview, so you can keep an eye on the capture
 * while working in another window.
 *
 * Thin on purpose - the browser does the work - but the state tracking is not
 * trivial. The floating window can be dismissed by the user with its own
 * close button, entirely outside this page's control, so the state cannot be
 * assumed from what `enter()` returned. `leavepictureinpicture` is the only
 * reliable source of truth and is subscribed to for exactly that reason.
 */

export interface PictureInPictureOptions {
  /** Called whenever PiP starts or stops, including when the user closes it. */
  onChange?: (active: boolean) => void;
}

export class PictureInPicture {
  private active = false;

  constructor(
    private video: HTMLVideoElement,
    private options: PictureInPictureOptions = {}
  ) {
    document.addEventListener('leavepictureinpicture', this.onLeave);
  }

  private onLeave = () => {
    if (!this.active) return;
    this.active = false;
    this.options.onChange?.(false);
  };

  /**
   * Whether the browser supports PiP at all.
   *
   * Reported rather than assumed: some contexts disable it (certain embedded
   * frames, or a browser built without it), and a button that silently does
   * nothing is worse than no button.
   */
  isSupported(): boolean {
    return typeof document.pictureInPictureEnabled === 'boolean'
      ? document.pictureInPictureEnabled
      : typeof this.video.requestPictureInPicture === 'function';
  }

  isActive(): boolean {
    return this.active;
  }

  /** Open the floating window. Must be called from a user gesture. */
  async enter(): Promise<boolean> {
    if (!this.isSupported() || this.active) return false;

    try {
      await this.video.requestPictureInPicture();
      this.active = true;
      this.options.onChange?.(true);
      return true;
    } catch (err) {
      // NotAllowedError is the "no user gesture" case; a failure here should
      // not take down the page, so it is reported rather than thrown.
      console.error('Picture-in-picture failed:', err);
      return false;
    }
  }

  /** Close the floating window, if one is open. */
  async exit(): Promise<void> {
    if (document.pictureInPictureElement !== this.video) {
      this.active = false;
      return;
    }
    try {
      await document.exitPictureInPicture();
    } catch (err) {
      console.error('Leaving picture-in-picture failed:', err);
    }
    // `leavepictureinpicture` updates the state; this is just belt and braces.
    this.active = false;
    this.options.onChange?.(false);
  }

  async toggle(): Promise<void> {
    if (this.active) await this.exit();
    else await this.enter();
  }

  /** Stop listening. The floating window is left alone. */
  destroy() {
    document.removeEventListener('leavepictureinpicture', this.onLeave);
  }
}
