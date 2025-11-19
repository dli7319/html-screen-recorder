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
    private isCropApiSupported = "CropTarget" in window && "fromElement" in CropTarget;

    constructor(
        private cropBox: HTMLDivElement,
        private cropTargetElement: HTMLDivElement,
        private videoContainer: HTMLDivElement,
        private videoPreview: HTMLVideoElement
    ) {
        this.cropBox.addEventListener("mousedown", this.onCropBoxMouseDown.bind(this));
    }

    show() {
        this.initializeCropBox();
    }

    hide() {
        // Logic handled by UI toggling classes, but we could reset state here
    }

    private initializeCropBox() {
        const styles = { left: "10%", top: "10%", width: "80%", height: "80%" };
        Object.assign(this.cropBox.style, styles);
        Object.assign(this.cropTargetElement.style, styles);
    }

    async startCrop(stream: MediaStream): Promise<MediaStream> {
        if (this.isCropApiSupported) {
            try {
                const [videoTrack] = stream.getVideoTracks();
                const cropTarget = await CropTarget.fromElement(this.cropTargetElement);
                await (videoTrack as unknown as CropMediaStreamTrack).cropTo(cropTarget);
                return stream;
            } catch (err) {
                console.error("Native cropping failed, falling back to canvas.", err);
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
            if ("cropTo" in videoTrack) {
                try {
                    await (videoTrack as unknown as CropMediaStreamTrack).cropTo(null);
                } catch (e) {
                    /* ignore */
                }
            }
        }
    }

    private getCanvasFallbackStream(stream: MediaStream): MediaStream {
        if (!stream) return new MediaStream();
        const cropCanvas = document.createElement("canvas");
        const ctx = cropCanvas.getContext("2d")!;

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
        }
        drawCropFrame();

        const canvasStream = cropCanvas.captureStream();
        stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track.clone()));
        return canvasStream;
    }

    private onCropBoxMouseDown(e: MouseEvent) {
        e.preventDefault();
        const target = e.target as HTMLElement;
        const handle = target.closest(".resize-handle");
        this.dragState = {
            resizing: !!handle,
            dragging: !handle,
            handle: handle ? handle.className.replace("resize-handle ", "").trim() : null,
            startX: e.clientX,
            startY: e.clientY,
            containerRect: this.videoContainer.getBoundingClientRect(),
            initialLeft: this.cropBox.offsetLeft,
            initialTop: this.cropBox.offsetTop,
            initialWidth: this.cropBox.offsetWidth,
            initialHeight: this.cropBox.offsetHeight,
        };
        window.addEventListener("mousemove", this.onCropBoxMouseMove);
        window.addEventListener("mouseup", this.onCropBoxMouseUp);
    }

    private onCropBoxMouseMove = (e: MouseEvent) => {
        let styles: Partial<CSSStyleDeclaration> = {};
        const dx = e.clientX - this.dragState.startX;
        const dy = e.clientY - this.dragState.startY;

        if (this.dragState.dragging) {
            let newLeft = this.dragState.initialLeft + dx;
            let newTop = this.dragState.initialTop + dy;

            newLeft = Math.max(0, Math.min(newLeft, this.dragState.containerRect.width - this.dragState.initialWidth));
            newTop = Math.max(0, Math.min(newTop, this.dragState.containerRect.height - this.dragState.initialHeight));

            styles = { left: `${newLeft}px`, top: `${newTop}px` };
        } else if (this.dragState.resizing) {
            let newLeft = this.dragState.initialLeft;
            let newTop = this.dragState.initialTop;
            let newWidth = this.dragState.initialWidth;
            let newHeight = this.dragState.initialHeight;

            if (this.dragState.handle?.includes("right")) newWidth += dx;
            if (this.dragState.handle?.includes("left")) {
                newWidth -= dx;
                newLeft += dx;
            }
            if (this.dragState.handle?.includes("bottom")) newHeight += dy;
            if (this.dragState.handle?.includes("top")) {
                newHeight -= dy;
                newTop += dy;
            }

            const minSize = 20;

            if (newWidth < minSize) {
                if (this.dragState.handle?.includes("left")) newLeft = this.dragState.initialLeft + this.dragState.initialWidth - minSize;
                newWidth = minSize;
            }
            if (newHeight < minSize) {
                if (this.dragState.handle?.includes("top")) newTop = this.dragState.initialTop + this.dragState.initialHeight - minSize;
                newHeight = minSize;
            }

            if (newLeft < 0) { newWidth += newLeft; newLeft = 0; }
            if (newTop < 0) { newHeight += newTop; newTop = 0; }
            if (newLeft + newWidth > this.dragState.containerRect.width) newWidth = this.dragState.containerRect.width - newLeft;
            if (newTop + newHeight > this.dragState.containerRect.height) newHeight = this.dragState.containerRect.height - newTop;

            styles = {
                left: `${newLeft}px`,
                top: `${newTop}px`,
                width: `${newWidth}px`,
                height: `${newHeight}px`,
            };
        }
        if (Object.keys(styles).length) {
            Object.assign(this.cropBox.style, styles);
            Object.assign(this.cropTargetElement.style, this.cropBox.style);
        }
    }

    private onCropBoxMouseUp = () => {
        window.removeEventListener("mousemove", this.onCropBoxMouseMove);
        window.removeEventListener("mouseup", this.onCropBoxMouseUp);
    }
}
