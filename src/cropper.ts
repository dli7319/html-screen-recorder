import { CropMediaStreamTrack } from './types';

interface DragState {
  resizing: boolean;
  dragging: boolean;
  handle: string | null;
  startX: number;
  startY: number;
  containerRect: DOMRect;
  initialLeft: number;
  initialTop: number;
  initialWidth: number;
  initialHeight: number;
}

export class Cropper {
  private dragState: DragState = {} as DragState;
  private cropAnimationId: number | null = null;
  private isCropApiSupported =
    'CropTarget' in window && 'fromElement' in CropTarget;

  constructor(
    private cropBox: HTMLDivElement,
    private cropTargetElement: HTMLDivElement,
    private videoContainer: HTMLDivElement,
    private videoPreview: HTMLVideoElement
  ) {
    this.cropBox.addEventListener(
      'mousedown',
      this.onCropBoxMouseDown.bind(this)
    );
  }

  show() {
    this.initializeCropBox();
  }

  hide() {
    // Logic handled by UI toggling classes, but we could reset state here
  }

  private initializeCropBox() {
    const styles = { left: '10%', top: '10%', width: '80%', height: '80%' };
    Object.assign(this.cropBox.style, styles);
    Object.assign(this.cropTargetElement.style, styles);
  }

  async startCrop(stream: MediaStream): Promise<MediaStream> {
    if (this.isCropApiSupported) {
      try {
        const [videoTrack] = stream.getVideoTracks();
        const cropTarget = await CropTarget.fromElement(this.cropTargetElement);
        await (videoTrack as unknown as CropMediaStreamTrack).cropTo(
          cropTarget
        );
        return stream;
      } catch (err) {
        console.error('Native cropping failed, falling back to canvas.', err);
        return this.getCanvasFallbackStream(stream);
      }
    } else {
      return this.getCanvasFallbackStream(stream);
    }
  }

  async stopCrop(stream: MediaStream | null) {
    if (this.cropAnimationId) {
      cancelAnimationFrame(this.cropAnimationId);
      this.cropAnimationId = null;
    }
    if (stream && this.isCropApiSupported) {
      const [videoTrack] = stream.getVideoTracks();
      if ('cropTo' in videoTrack) {
        try {
          await (videoTrack as unknown as CropMediaStreamTrack).cropTo(null);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private getCanvasFallbackStream(stream: MediaStream): MediaStream {
    if (!stream) return new MediaStream();
    const cropCanvas = document.createElement('canvas');
    const ctx = cropCanvas.getContext('2d')!;

    const drawCropFrame = () => {
      const videoRect = this.videoPreview.getBoundingClientRect();
      const boxRect = this.cropBox.getBoundingClientRect();
      const trackSettings = stream.getVideoTracks()[0].getSettings();

      const scaleX = (trackSettings.width || 0) / videoRect.width;
      const scaleY = (trackSettings.height || 0) / videoRect.height;

      const sourceX = (boxRect.left - videoRect.left) * scaleX;
      const sourceY = (boxRect.top - videoRect.top) * scaleY;
      const sourceWidth = boxRect.width * scaleX;
      const sourceHeight = boxRect.height * scaleY;

      cropCanvas.width = Math.round(sourceWidth);
      cropCanvas.height = Math.round(sourceHeight);

      ctx.drawImage(
        this.videoPreview,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height
      );
      this.cropAnimationId = requestAnimationFrame(drawCropFrame);
    };
    drawCropFrame();

    const canvasStream = cropCanvas.captureStream();
    stream
      .getAudioTracks()
      .forEach((track) => canvasStream.addTrack(track.clone()));
    return canvasStream;
  }

  private onCropBoxMouseDown(e: MouseEvent) {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const handle = target.closest('.resize-handle');
    this.dragState = {
      resizing: !!handle,
      dragging: !handle,
      handle: handle
        ? handle.className.replace('resize-handle ', '').trim()
        : null,
      startX: e.clientX,
      startY: e.clientY,
      containerRect: this.videoContainer.getBoundingClientRect(),
      initialLeft: this.cropBox.offsetLeft,
      initialTop: this.cropBox.offsetTop,
      initialWidth: this.cropBox.offsetWidth,
      initialHeight: this.cropBox.offsetHeight,
    };
    window.addEventListener('mousemove', this.onCropBoxMouseMove);
    window.addEventListener('mouseup', this.onCropBoxMouseUp);
  }

  private onCropBoxMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - this.dragState.startX;
    const dy = e.clientY - this.dragState.startY;
    const {
      initialLeft,
      initialTop,
      initialWidth,
      initialHeight,
      containerRect,
    } = this.dragState;

    const clamp = (val: number, min: number, max: number) =>
      Math.max(min, Math.min(val, max));

    if (this.dragState.dragging) {
      const maxLeft = containerRect.width - initialWidth;
      const maxTop = containerRect.height - initialHeight;
      const left = clamp(initialLeft + dx, 0, maxLeft);
      const top = clamp(initialTop + dy, 0, maxTop);

      Object.assign(this.cropBox.style, { left: `${left}px`, top: `${top}px` });
      Object.assign(this.cropTargetElement.style, {
        left: `${left}px`,
        top: `${top}px`,
      });
    } else if (this.dragState.resizing) {
      let newLeft = initialLeft;
      let newTop = initialTop;
      let newWidth = initialWidth;
      let newHeight = initialHeight;

      const handle = this.dragState.handle || '';
      if (handle.includes('right')) newWidth += dx;
      if (handle.includes('left')) {
        newWidth -= dx;
        newLeft += dx;
      }
      if (handle.includes('bottom')) newHeight += dy;
      if (handle.includes('top')) {
        newHeight -= dy;
        newTop += dy;
      }

      const minSize = 20;
      if (newWidth < minSize) {
        if (handle.includes('left'))
          newLeft = initialLeft + initialWidth - minSize;
        newWidth = minSize;
      }
      if (newHeight < minSize) {
        if (handle.includes('top'))
          newTop = initialTop + initialHeight - minSize;
        newHeight = minSize;
      }

      // Boundary checks
      if (newLeft < 0) {
        newWidth += newLeft;
        newLeft = 0;
      }
      if (newTop < 0) {
        newHeight += newTop;
        newTop = 0;
      }
      if (newLeft + newWidth > containerRect.width)
        newWidth = containerRect.width - newLeft;
      if (newTop + newHeight > containerRect.height)
        newHeight = containerRect.height - newTop;

      const styles = {
        left: `${newLeft}px`,
        top: `${newTop}px`,
        width: `${newWidth}px`,
        height: `${newHeight}px`,
      };
      Object.assign(this.cropBox.style, styles);
      Object.assign(this.cropTargetElement.style, styles);
    }
  };

  private onCropBoxMouseUp = () => {
    window.removeEventListener('mousemove', this.onCropBoxMouseMove);
    window.removeEventListener('mouseup', this.onCropBoxMouseUp);
  };
}
