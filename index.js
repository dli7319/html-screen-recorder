(function () {
    'use strict';

    async function shareScreen(wantsSystemAudio, wantsMicAudio) {
        const finalStream = new MediaStream();
        // 1. Get Display Stream
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: wantsSystemAudio,
        });
        displayStream
            .getVideoTracks()
            .forEach((track) => finalStream.addTrack(track));
        // 2. Get Mic Stream
        let micStream;
        if (wantsMicAudio) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            catch (micErr) {
                console.error('Could not get microphone:', micErr);
                throw new Error('Could not access microphone. Continuing without it.');
            }
        }
        // 3. Combine Audio Tracks
        const systemTrack = displayStream.getAudioTracks()[0];
        const micTrack = micStream === null || micStream === void 0 ? void 0 : micStream.getAudioTracks()[0];
        if (systemTrack && micTrack) {
            const ctx = new AudioContext();
            const dest = ctx.createMediaStreamDestination();
            ctx.createMediaStreamSource(new MediaStream([systemTrack])).connect(dest);
            ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
            dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));
        }
        else {
            if (systemTrack)
                finalStream.addTrack(systemTrack);
            if (micTrack)
                finalStream.addTrack(micTrack);
        }
        return finalStream;
    }

    class Recorder {
        constructor(onStopCallback) {
            this.onStopCallback = onStopCallback;
            this.mediaRecorder = null;
            this.recordedChunks = [];
        }
        start(stream, format) {
            this.recordedChunks = [];
            try {
                this.mediaRecorder = new MediaRecorder(stream, {
                    mimeType: format.mimeType,
                });
            }
            catch (err) {
                console.error('Failed to create MediaRecorder:', err);
                throw new Error(`Failed to start recording. Unsupported format: ${format.mimeType}`);
            }
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0)
                    this.recordedChunks.push(event.data);
            };
            this.mediaRecorder.onstop = () => {
                const mimeTypeBlob = format.mimeType.split(';')[0];
                const blob = new Blob(this.recordedChunks, { type: mimeTypeBlob });
                this.onStopCallback(blob, format.ext);
            };
            this.mediaRecorder.start();
        }
        stop() {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
            }
        }
        isRecording() {
            var _a;
            return ((_a = this.mediaRecorder) === null || _a === void 0 ? void 0 : _a.state) === 'recording';
        }
    }

    class Cropper {
        constructor(cropBox, cropTargetElement, videoContainer, videoPreview) {
            this.cropBox = cropBox;
            this.cropTargetElement = cropTargetElement;
            this.videoContainer = videoContainer;
            this.videoPreview = videoPreview;
            this.dragState = {};
            this.cropAnimationId = null;
            this.isCropApiSupported = 'CropTarget' in window && 'fromElement' in CropTarget;
            this.onCropBoxMouseMove = (e) => {
                const dx = e.clientX - this.dragState.startX;
                const dy = e.clientY - this.dragState.startY;
                const { initialLeft, initialTop, initialWidth, initialHeight, containerRect, } = this.dragState;
                const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
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
                }
                else if (this.dragState.resizing) {
                    let newLeft = initialLeft;
                    let newTop = initialTop;
                    let newWidth = initialWidth;
                    let newHeight = initialHeight;
                    const handle = this.dragState.handle || '';
                    if (handle.includes('right'))
                        newWidth += dx;
                    if (handle.includes('left')) {
                        newWidth -= dx;
                        newLeft += dx;
                    }
                    if (handle.includes('bottom'))
                        newHeight += dy;
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
            this.onCropBoxMouseUp = () => {
                window.removeEventListener('mousemove', this.onCropBoxMouseMove);
                window.removeEventListener('mouseup', this.onCropBoxMouseUp);
            };
            this.cropBox.addEventListener('mousedown', this.onCropBoxMouseDown.bind(this));
        }
        show() {
            this.initializeCropBox();
        }
        hide() {
            // Logic handled by UI toggling classes, but we could reset state here
        }
        initializeCropBox() {
            const styles = { left: '10%', top: '10%', width: '80%', height: '80%' };
            Object.assign(this.cropBox.style, styles);
            Object.assign(this.cropTargetElement.style, styles);
        }
        async startCrop(stream) {
            if (this.isCropApiSupported) {
                try {
                    const [videoTrack] = stream.getVideoTracks();
                    const cropTarget = await CropTarget.fromElement(this.cropTargetElement);
                    await videoTrack.cropTo(cropTarget);
                    return stream;
                }
                catch (err) {
                    console.error('Native cropping failed, falling back to canvas.', err);
                    return this.getCanvasFallbackStream(stream);
                }
            }
            else {
                return this.getCanvasFallbackStream(stream);
            }
        }
        async stopCrop(stream) {
            if (this.cropAnimationId) {
                cancelAnimationFrame(this.cropAnimationId);
                this.cropAnimationId = null;
            }
            if (stream && this.isCropApiSupported) {
                const [videoTrack] = stream.getVideoTracks();
                if ('cropTo' in videoTrack) {
                    try {
                        await videoTrack.cropTo(null);
                    }
                    catch (_a) {
                        /* ignore */
                    }
                }
            }
        }
        getCanvasFallbackStream(stream) {
            if (!stream)
                return new MediaStream();
            const cropCanvas = document.createElement('canvas');
            const ctx = cropCanvas.getContext('2d');
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
                ctx.drawImage(this.videoPreview, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, cropCanvas.width, cropCanvas.height);
                this.cropAnimationId = requestAnimationFrame(drawCropFrame);
            };
            drawCropFrame();
            const canvasStream = cropCanvas.captureStream();
            stream
                .getAudioTracks()
                .forEach((track) => canvasStream.addTrack(track.clone()));
            return canvasStream;
        }
        onCropBoxMouseDown(e) {
            e.preventDefault();
            const target = e.target;
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
    }

    const FORMATS_TO_CHECK = [
        {
            name: 'AV1 + Opus (MP4)',
            mimeType: 'video/mp4; codecs=av01.0.05M.08,opus',
            ext: 'mp4',
        },
        {
            name: 'H.265/HEVC + Opus (MP4)',
            mimeType: 'video/mp4; codecs=hvc1.1.6.L93.B0,opus',
            ext: 'mp4',
        },
        {
            name: 'VP9 + Opus (WebM)',
            mimeType: 'video/webm; codecs=vp9,opus',
            ext: 'webm',
        },
        {
            name: 'H.264 + AAC (MP4)',
            mimeType: 'video/mp4; codecs=avc1.42E01E,mp4a.40.2',
            ext: 'mp4',
        },
        { name: 'VP9 (WebM)', mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
        {
            name: 'H.264 (MP4)',
            mimeType: 'video/mp4; codecs=avc1.42E01E',
            ext: 'mp4',
        },
    ];

    class Stopwatch {
        constructor() {
            this.startTime = 0;
            this.intervalId = null;
        }
        start(onTick) {
            this.startTime = Date.now();
            this.intervalId = window.setInterval(() => {
                const seconds = Math.floor((Date.now() - this.startTime) / 1000);
                const mins = Math.floor(seconds / 60)
                    .toString()
                    .padStart(2, '0');
                const secs = (seconds % 60).toString().padStart(2, '0');
                onTick(`${mins}:${secs}`);
            }, 1000);
        }
        stop() {
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        }
    }

    class UIManager {
        constructor() {
            this.videoPreview = document.getElementById('videoPreview');
            this.videoContainer = document.getElementById('videoContainer');
            this.cropBox = document.getElementById('cropBox');
            this.cropTargetElement = document.getElementById('cropTargetElement');
            this.shareBtn = document.getElementById('shareBtn');
            this.shareBtnStart = document.getElementById('shareBtnStart');
            this.shareBtnStop = document.getElementById('shareBtnStop');
            this.recordBtn = document.getElementById('recordBtn');
            this.recordBtnText = document.getElementById('recordBtnText');
            this.stopBtn = document.getElementById('stopBtn');
            this.downloadLink = document.getElementById('downloadLink');
            this.placeholder = document.getElementById('placeholder');
            this.statusDiv = document.getElementById('status');
            this.errorDiv = document.getElementById('error');
            this.formatSelect = document.getElementById('formatSelect');
            this.systemAudioToggle = document.getElementById('systemAudioToggle');
            this.micAudioToggle = document.getElementById('micAudioToggle');
            this.cropCheckbox = document.getElementById('cropCheckbox');
            this.cropContainer = document.getElementById('cropContainer');
        }
        bindEvents(callbacks) {
            this.shareBtn.addEventListener('click', callbacks.onShare);
            this.recordBtn.addEventListener('click', callbacks.onRecord);
            this.stopBtn.addEventListener('click', callbacks.onStop);
            this.cropCheckbox.addEventListener('change', callbacks.onCropToggle);
        }
        populateFormats(formats) {
            formats.forEach((format) => {
                if (MediaRecorder.isTypeSupported(format.mimeType)) {
                    const option = document.createElement('option');
                    option.value = format.mimeType;
                    option.textContent = format.name;
                    option.dataset.ext = format.ext;
                    this.formatSelect.appendChild(option);
                }
            });
            if (this.formatSelect.options.length === 0) {
                this.showError('No supported recording formats found in this browser.');
                this.disableShareBtn();
            }
        }
        disableShareBtn() {
            this.shareBtn.disabled = true;
        }
        showError(message) {
            this.errorDiv.textContent = message;
            this.errorDiv.classList.remove('hidden');
        }
        hideError() {
            this.errorDiv.textContent = '';
            this.errorDiv.classList.add('hidden');
        }
        setSharingState(isSharing) {
            const toggle = (el, show) => el.classList.toggle('hidden', !show);
            if (isSharing) {
                toggle(this.placeholder, false);
                toggle(this.shareBtnStart, false);
                toggle(this.shareBtnStop, true);
                this.recordBtn.disabled = false;
                this.cropCheckbox.disabled = false;
                this.formatSelect.disabled = true;
                this.systemAudioToggle.disabled = true;
                this.micAudioToggle.disabled = true;
                this.downloadLink.classList.add('pointer-events-none', 'opacity-50');
                this.downloadLink.removeAttribute('href');
            }
            else {
                this.videoPreview.srcObject = null;
                toggle(this.placeholder, true);
                toggle(this.shareBtnStart, true);
                toggle(this.shareBtnStop, false);
                this.recordBtn.disabled = true;
                this.stopBtn.disabled = true;
                this.cropCheckbox.checked = false;
                this.cropCheckbox.disabled = true;
                toggle(this.cropContainer, false);
                this.cropBox.classList.remove('is-recording');
                this.formatSelect.disabled = false;
                this.systemAudioToggle.disabled = false;
                this.micAudioToggle.disabled = false;
            }
        }
        setRecordingState(isRecording) {
            const icon = this.recordBtn.querySelector('svg');
            if (isRecording) {
                this.statusDiv.classList.remove('hidden');
                this.stopBtn.disabled = false;
                this.recordBtn.disabled = true;
                this.shareBtn.disabled = true;
                this.cropCheckbox.disabled = true;
                if (this.cropCheckbox.checked)
                    this.cropBox.classList.add('is-recording');
                if (icon)
                    icon.style.display = 'none';
            }
            else {
                this.statusDiv.classList.add('hidden');
                this.stopBtn.disabled = true;
                if (this.cropCheckbox.checked)
                    this.cropBox.classList.remove('is-recording');
                this.recordBtnText.textContent = 'Start Recording';
                if (icon)
                    icon.style.display = 'inline-block';
                this.recordBtn.disabled = false;
                this.shareBtn.disabled = false;
                this.cropCheckbox.disabled = false;
            }
        }
        updateStopwatch(text) {
            this.recordBtnText.textContent = text;
        }
        setDownloadLink(url, filename) {
            this.downloadLink.href = url;
            this.downloadLink.download = filename;
            this.downloadLink.classList.remove('pointer-events-none', 'opacity-50');
        }
        getFormat() {
            const selected = this.formatSelect.options[this.formatSelect.selectedIndex];
            return {
                name: selected.textContent || '',
                mimeType: selected.value,
                ext: selected.dataset.ext,
            };
        }
        getAudioConfig() {
            return {
                systemAudio: this.systemAudioToggle.checked,
                micAudio: this.micAudioToggle.checked,
            };
        }
        toggleCropping(show) {
            this.cropContainer.classList.toggle('hidden', !show);
            this.cropTargetElement.classList.toggle('hidden', !show);
        }
    }

    const ui = new UIManager();
    const stopwatch = new Stopwatch();
    const cropper = new Cropper(ui.cropBox, ui.cropTargetElement, ui.videoContainer, ui.videoPreview);
    const recorder = new Recorder(onRecordingStop);
    let stream = null;
    // --- Initialization ---
    window.addEventListener('load', () => {
        ui.populateFormats(FORMATS_TO_CHECK);
        if (!window.MediaRecorder) {
            ui.showError('Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.');
            ui.disableShareBtn();
        }
    });
    // --- Event Listeners ---
    ui.bindEvents({
        onShare: () => {
            if (stream)
                stopSharing();
            else
                handleShareScreen();
        },
        onRecord: startRecording,
        onStop: stopRecording,
        onCropToggle: toggleCropping,
    });
    // --- Functions ---
    async function handleShareScreen() {
        ui.hideError();
        try {
            const audioConfig = ui.getAudioConfig();
            stream = await shareScreen(audioConfig.systemAudio, audioConfig.micAudio);
            ui.videoPreview.srcObject = stream;
            await ui.videoPreview.play();
            ui.setSharingState(true);
            stream.getVideoTracks()[0].addEventListener('ended', stopSharing);
        }
        catch (err) {
            console.error('Error sharing screen:', err);
            let errorMsg = 'Could not start screen sharing. Please grant permission and try again.';
            const error = err;
            if (error.name === 'NotAllowedError')
                errorMsg =
                    'Screen sharing permission was denied. Please allow permission and try again.';
            else if (error.name === 'NotFoundError')
                errorMsg =
                    'No screen sharing sources found. This can happen if your browser is misconfigured.';
            else if (error.name === 'InvalidStateError')
                errorMsg = 'An invalid state occurred. Please reload the page.';
            ui.showError(errorMsg);
            stopSharing();
        }
    }
    async function startRecording() {
        if (!stream) {
            ui.showError('Please share your screen first.');
            return;
        }
        ui.hideError();
        const format = ui.getFormat();
        let streamToRecord = stream;
        if (ui.cropCheckbox.checked) {
            streamToRecord = await cropper.startCrop(stream);
        }
        try {
            recorder.start(streamToRecord, format);
        }
        catch (err) {
            ui.showError(err.message);
            stopSharing();
            return;
        }
        ui.setRecordingState(true);
        stopwatch.start((time) => ui.updateStopwatch(time));
    }
    function onRecordingStop(blob, ext) {
        const now = new Date();
        const timestamp = now
            .toISOString()
            .replace(/[-:T.]/g, '')
            .slice(0, 14);
        const filename = `${timestamp}.${ext}`;
        const url = URL.createObjectURL(blob);
        ui.setDownloadLink(url, filename);
        ui.setRecordingState(false);
        stopwatch.stop();
    }
    async function stopRecording() {
        await cropper.stopCrop(stream);
        if (recorder.isRecording()) {
            recorder.stop();
        }
    }
    async function stopSharing() {
        await cropper.stopCrop(stream);
        if (recorder.isRecording()) {
            recorder.stop();
        }
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        ui.setSharingState(false);
        cropper.hide();
    }
    function toggleCropping() {
        if (ui.cropCheckbox.checked) {
            ui.toggleCropping(true);
            cropper.show();
        }
        else {
            ui.toggleCropping(false);
            cropper.hide();
        }
    }

})();
