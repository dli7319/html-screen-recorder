(function() {
	//#region src/screen-share.ts
	async function shareScreen(wantsSystemAudio, mic) {
		const finalStream = new MediaStream();
		const displayStream = await navigator.mediaDevices.getDisplayMedia({
			video: { cursor: "always" },
			audio: wantsSystemAudio
		});
		displayStream.getVideoTracks().forEach((track) => finalStream.addTrack(track));
		let micStream;
		if (mic.enabled) try {
			micStream = await navigator.mediaDevices.getUserMedia({ audio: {
				noiseSuppression: mic.noiseSuppression,
				echoCancellation: mic.echoCancellation,
				autoGainControl: mic.autoGainControl
			} });
		} catch (micErr) {
			console.error("Could not get microphone:", micErr);
			throw new Error("Could not access microphone. Continuing without it.");
		}
		const analysers = {};
		const gains = {};
		let audioContext;
		const systemTrack = displayStream.getAudioTracks()[0];
		const micTrack = micStream?.getAudioTracks()[0];
		if (systemTrack || micTrack) {
			audioContext = new AudioContext({ latencyHint: "playback" });
			audioContext.resume();
			const dest = audioContext.createMediaStreamDestination();
			const addSource = (track, which) => {
				const source = audioContext.createMediaStreamSource(new MediaStream([track]));
				const analyser = audioContext.createAnalyser();
				analyser.fftSize = 256;
				source.connect(analyser);
				analysers[which] = analyser;
				const gain = audioContext.createGain();
				source.connect(gain);
				gain.connect(dest);
				gains[which] = gain;
			};
			if (systemTrack) addSource(systemTrack, "system");
			if (micTrack) addSource(micTrack, "mic");
			dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));
		}
		return {
			stream: finalStream,
			analysers,
			gains,
			audioContext
		};
	}
	//#endregion
	//#region src/recorder.ts
	/**
	* How often MediaRecorder hands back a chunk.
	*
	* Without a timeslice `ondataavailable` fires exactly once, at stop - fine for
	* assembling the file, useless for showing progress. Asking for a chunk every
	* second keeps the live byte count honest. Both containers are built for this:
	* WebM emits complete clusters per chunk and MP4 is fragmented, so
	* concatenating the chunks is exactly what the single-chunk path already did.
	*/
	const TIMESLICE_MS = 1e3;
	var Recorder = class {
		constructor(onStopCallback) {
			this.onStopCallback = onStopCallback;
			this.mediaRecorder = null;
			this.recordedChunks = [];
		}
		start(stream, format) {
			this.recordedChunks = [];
			try {
				this.mediaRecorder = new MediaRecorder(stream, { mimeType: format.mimeType });
			} catch (err) {
				console.error("Failed to create MediaRecorder:", err);
				throw new Error(`Failed to start recording. Unsupported format: ${format.mimeType}`);
			}
			this.mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) this.recordedChunks.push(event.data);
			};
			this.mediaRecorder.onstop = () => {
				const mimeTypeBlob = format.mimeType.split(";")[0];
				const blob = new Blob(this.recordedChunks, { type: mimeTypeBlob });
				this.onStopCallback(blob, format.ext);
			};
			this.mediaRecorder.start(TIMESLICE_MS);
		}
		/**
		* Bytes handed back so far. The total is an interim figure while recording
		* and exact once the capture has stopped.
		*/
		bytesCaptured() {
			return this.recordedChunks.reduce((total, chunk) => total + chunk.size, 0);
		}
		stop() {
			if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
		}
		pause() {
			if (this.mediaRecorder?.state === "recording") this.mediaRecorder.pause();
		}
		resume() {
			if (this.mediaRecorder?.state === "paused") this.mediaRecorder.resume();
		}
		isRecording() {
			return this.mediaRecorder?.state === "recording";
		}
		isPaused() {
			return this.mediaRecorder?.state === "paused";
		}
		/** True while a capture is in flight, including while it is paused. */
		isActive() {
			return this.isRecording() || this.isPaused();
		}
	};
	//#endregion
	//#region src/cropper.ts
	var Cropper = class {
		constructor(cropBox, cropTargetElement, videoContainer, videoPreview) {
			this.cropBox = cropBox;
			this.cropTargetElement = cropTargetElement;
			this.videoContainer = videoContainer;
			this.videoPreview = videoPreview;
			this.dragState = {};
			this.cropAnimationId = null;
			this.isCropApiSupported = "CropTarget" in window && "fromElement" in CropTarget;
			this.onCropBoxMouseMove = (e) => {
				const dx = e.clientX - this.dragState.startX;
				const dy = e.clientY - this.dragState.startY;
				const { initialLeft, initialTop, initialWidth, initialHeight, containerRect } = this.dragState;
				const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
				if (this.dragState.dragging) {
					const maxLeft = containerRect.width - initialWidth;
					const maxTop = containerRect.height - initialHeight;
					const left = clamp(initialLeft + dx, 0, maxLeft);
					const top = clamp(initialTop + dy, 0, maxTop);
					Object.assign(this.cropBox.style, {
						left: `${left}px`,
						top: `${top}px`
					});
					Object.assign(this.cropTargetElement.style, {
						left: `${left}px`,
						top: `${top}px`
					});
				} else if (this.dragState.resizing) {
					let newLeft = initialLeft;
					let newTop = initialTop;
					let newWidth = initialWidth;
					let newHeight = initialHeight;
					const handle = this.dragState.handle || "";
					if (handle.includes("right")) newWidth += dx;
					if (handle.includes("left")) {
						newWidth -= dx;
						newLeft += dx;
					}
					if (handle.includes("bottom")) newHeight += dy;
					if (handle.includes("top")) {
						newHeight -= dy;
						newTop += dy;
					}
					const minSize = 20;
					if (newWidth < minSize) {
						if (handle.includes("left")) newLeft = initialLeft + initialWidth - minSize;
						newWidth = minSize;
					}
					if (newHeight < minSize) {
						if (handle.includes("top")) newTop = initialTop + initialHeight - minSize;
						newHeight = minSize;
					}
					if (newLeft < 0) {
						newWidth += newLeft;
						newLeft = 0;
					}
					if (newTop < 0) {
						newHeight += newTop;
						newTop = 0;
					}
					if (newLeft + newWidth > containerRect.width) newWidth = containerRect.width - newLeft;
					if (newTop + newHeight > containerRect.height) newHeight = containerRect.height - newTop;
					const styles = {
						left: `${newLeft}px`,
						top: `${newTop}px`,
						width: `${newWidth}px`,
						height: `${newHeight}px`
					};
					Object.assign(this.cropBox.style, styles);
					Object.assign(this.cropTargetElement.style, styles);
				}
			};
			this.onCropBoxMouseUp = () => {
				window.removeEventListener("mousemove", this.onCropBoxMouseMove);
				window.removeEventListener("mouseup", this.onCropBoxMouseUp);
			};
			this.cropBox.addEventListener("mousedown", this.onCropBoxMouseDown.bind(this));
		}
		show() {
			this.initializeCropBox();
		}
		hide() {}
		initializeCropBox() {
			const styles = {
				left: "10%",
				top: "10%",
				width: "80%",
				height: "80%"
			};
			Object.assign(this.cropBox.style, styles);
			Object.assign(this.cropTargetElement.style, styles);
		}
		async startCrop(stream) {
			if (this.isCropApiSupported) try {
				const [videoTrack] = stream.getVideoTracks();
				const cropTarget = await CropTarget.fromElement(this.cropTargetElement);
				await videoTrack.cropTo(cropTarget);
				return stream;
			} catch (err) {
				console.error("Native cropping failed, falling back to canvas.", err);
				return this.getCanvasFallbackStream(stream);
			}
			else return this.getCanvasFallbackStream(stream);
		}
		async stopCrop(stream) {
			if (this.cropAnimationId) {
				cancelAnimationFrame(this.cropAnimationId);
				this.cropAnimationId = null;
			}
			if (stream && this.isCropApiSupported) {
				const [videoTrack] = stream.getVideoTracks();
				if ("cropTo" in videoTrack) try {
					await videoTrack.cropTo(null);
				} catch {}
			}
		}
		getCanvasFallbackStream(stream) {
			if (!stream) return new MediaStream();
			const cropCanvas = document.createElement("canvas");
			const ctx = cropCanvas.getContext("2d");
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
			stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track.clone()));
			return canvasStream;
		}
		onCropBoxMouseDown(e) {
			e.preventDefault();
			const handle = e.target.closest(".resize-handle");
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
				initialHeight: this.cropBox.offsetHeight
			};
			window.addEventListener("mousemove", this.onCropBoxMouseMove);
			window.addEventListener("mouseup", this.onCropBoxMouseUp);
		}
	};
	//#endregion
	//#region src/constants.ts
	const FORMATS_TO_CHECK = [
		{
			name: "AV1 + Opus (MP4)",
			mimeType: "video/mp4; codecs=av01.0.05M.08,opus",
			ext: "mp4"
		},
		{
			name: "H.265/HEVC + Opus (MP4)",
			mimeType: "video/mp4; codecs=hvc1.1.6.L93.B0,opus",
			ext: "mp4"
		},
		{
			name: "VP9 + Opus (WebM)",
			mimeType: "video/webm; codecs=vp9,opus",
			ext: "webm"
		},
		{
			name: "H.264 + AAC (MP4)",
			mimeType: "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
			ext: "mp4"
		},
		{
			name: "VP9 (WebM)",
			mimeType: "video/webm; codecs=vp9",
			ext: "webm"
		},
		{
			name: "H.264 (MP4)",
			mimeType: "video/mp4; codecs=avc1.42E01E",
			ext: "mp4"
		}
	];
	//#endregion
	//#region src/filename.ts
	/**
	* Build the download name for a capture: a sortable, collision-resistant
	* `YYYYMMDDHHmmss` stamp plus the container extension.
	*
	* Shared by recordings and screenshots so both name files the same way.
	*/
	function timestampFilename(ext, at = /* @__PURE__ */ new Date()) {
		return `${at.toISOString().replace(/[-:T.]/g, "").slice(0, 14)}.${ext}`;
	}
	//#endregion
	//#region src/format.ts
	/**
	* Display formatting for the live recording stats. Pure functions, so the exact
	* output the user sees is pinned by tests rather than eyeballed.
	*/
	/**
	* Human-readable byte count using 1024-based steps, which is what people expect
	* from a file they are about to download.
	*
	*   0        -> "0 B"
	*   842      -> "842 B"
	*   12_845   -> "12.5 KB"
	*   5_242_880 -> "5.0 MB"
	*/
	function formatBytes(bytes) {
		if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
		const units = [
			"B",
			"KB",
			"MB",
			"GB",
			"TB"
		];
		const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		if (exponent === 0) return `${Math.round(bytes)} ${units[0]}`;
		return `${(bytes / Math.pow(1024, exponent)).toFixed(1)} ${units[exponent]}`;
	}
	/**
	* Elapsed time as `mm:ss`, or `h:mm:ss` once an hour is passed. Minutes are not
	* wrapped at 60, so a long take reads its true length instead of restarting.
	*/
	function formatDuration(ms) {
		const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
		const seconds = totalSeconds % 60;
		const totalMinutes = Math.floor(totalSeconds / 60);
		const hours = Math.floor(totalMinutes / 60);
		const pad = (n) => n.toString().padStart(2, "0");
		return hours > 0 ? `${hours}:${pad(totalMinutes % 60)}:${pad(seconds)}` : `${pad(totalMinutes)}:${pad(seconds)}`;
	}
	//#endregion
	//#region src/shortcuts.ts
	/** Targets where a bare letter must stay a letter, not a command. */
	function isTypingTarget(target) {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
		if (target.isContentEditable === true) return true;
		const editable = target.getAttribute("contenteditable");
		return editable !== null && editable !== "false";
	}
	/**
	* Map a key event to an action, or null when it is not a shortcut.
	*
	* Returns null for typing targets and for any chord with a modifier, so
	* Cmd/Ctrl/Alt combinations never trigger a recording.
	*/
	function matchShortcut(event) {
		if (event.metaKey || event.ctrlKey || event.altKey) return null;
		if (isTypingTarget(event.target)) return null;
		switch (event.key.toLowerCase()) {
			case "r": return "record";
			case "p": return "pause";
			case "s": return event.shiftKey ? "screenshot" : "stop";
			default: return null;
		}
	}
	/** Bind the shortcuts and return an unsubscribe function. */
	function bindShortcuts(handlers) {
		const onKeyDown = (event) => {
			const action = matchShortcut(event);
			if (!action) return;
			event.preventDefault();
			switch (action) {
				case "record":
					handlers.onRecord?.();
					break;
				case "pause":
					handlers.onPause?.();
					break;
				case "stop":
					handlers.onStop?.();
					break;
				case "screenshot": handlers.onScreenshot?.();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}
	//#endregion
	//#region src/screenshot.ts
	/**
	* Still-frame capture. Grabs the preview's current frame as a PNG, and the
	* download plumbing it needs (which the recording path does not, since a
	* recording is offered as a link the user clicks).
	*/
	/**
	* The pixel size to capture at: the frame's own decoded dimensions.
	*
	* Returning null is the "there is no frame yet" case - sharing has not started,
	* or the video has not produced a frame - and callers should do nothing rather
	* than emit a blank image.
	*/
	function frameSize(video) {
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) return null;
		return {
			width,
			height
		};
	}
	/** Render the video's current frame into a PNG blob. */
	async function captureFrame(video) {
		const size = frameSize(video);
		if (!size) return null;
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(video, 0, 0, size.width, size.height);
		return new Promise((resolve) => {
			canvas.toBlob((blob) => resolve(blob), "image/png");
		});
	}
	/** Save a blob to the user's downloads under the given name. */
	function downloadBlob(blob, filename) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1e3);
	}
	//#endregion
	//#region src/stopwatch.ts
	var Stopwatch = class {
		constructor() {
			this.startTime = 0;
			this.intervalId = null;
			this.pausedAt = 0;
			this.pausedTotal = 0;
			this.paused = false;
		}
		start(onTick) {
			this.startTime = Date.now();
			this.pausedAt = 0;
			this.pausedTotal = 0;
			this.paused = false;
			this.intervalId = window.setInterval(() => {
				if (this.paused) return;
				onTick(formatDuration(this.elapsed()));
			}, 1e3);
		}
		/**
		* Freeze the clock. Paused time is excluded from the reading, so a recording
		* that is paused mid-way reports only the time actually captured.
		*/
		pause() {
			if (this.paused || !this.intervalId) return;
			this.paused = true;
			this.pausedAt = Date.now();
		}
		resume() {
			if (!this.paused) return;
			this.pausedTotal += Date.now() - this.pausedAt;
			this.pausedAt = 0;
			this.paused = false;
		}
		isPaused() {
			return this.paused;
		}
		/** Milliseconds actually captured so far, excluding any paused time. */
		elapsed() {
			if (!this.startTime) return 0;
			return (this.paused ? this.pausedAt : Date.now()) - this.startTime - this.pausedTotal;
		}
		stop() {
			if (this.intervalId) {
				clearInterval(this.intervalId);
				this.intervalId = null;
			}
			this.paused = false;
			this.pausedAt = 0;
			this.pausedTotal = 0;
			this.startTime = 0;
		}
	};
	//#endregion
	//#region src/webm-duration.ts
	/**
	* MediaRecorder's WebM output omits the EBML `Duration` element, so players and
	* editors report the recording as `Infinity` (or refuse to seek). This writes the
	* real duration into the header once the capture is finished.
	*
	* The structure being patched is:
	*
	*   Segment (0x18538067)
	*     Info (0x1549A966)
	*       TimestampScale (0x2AD7B1)   <- usually 1000000 (1ms)
	*       MuxingApp / WritingApp
	*       Duration (0x4489)           <- usually MISSING, float in scale units
	*     Tracks / Cluster...
	*
	* Anything that does not match this shape is returned untouched: a recording
	* that still reports Infinity is a nuisance, but a mangled one is a lost take.
	*/
	const ID_SEGMENT = 408125543;
	const ID_INFO = 357149030;
	const ID_TIMESTAMP_SCALE = 2807729;
	const ID_DURATION = 17545;
	const DEFAULT_TIMESTAMP_SCALE = 1e6;
	/**
	* EBML variable-length integers carry their own length in the leading zero bits
	* of the first byte, with the marker bit forming part of the value.
	*/
	function readVint(buf, pos) {
		const first = buf[pos];
		if (first === void 0) return null;
		let length = 0;
		for (let i = 0; i < 8; i++) if (first & 128 >> i) {
			length = i + 1;
			break;
		}
		if (length === 0 || pos + length > buf.length) return null;
		const mask = 255 >> length;
		let value = first & mask;
		let allOnes = value === mask;
		for (let i = 1; i < length; i++) {
			value = value * 256 + buf[pos + i];
			if (buf[pos + i] !== 255) allOnes = false;
		}
		return {
			value: allOnes ? null : value,
			length
		};
	}
	/** Element IDs use the same length-encoding but keep their marker bits. */
	function readId(buf, pos) {
		const first = buf[pos];
		if (first === void 0) return null;
		let length = 0;
		for (let i = 0; i < 8; i++) if (first & 128 >> i) {
			length = i + 1;
			break;
		}
		if (length === 0 || pos + length > buf.length) return null;
		let value = 0;
		for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i];
		return {
			value,
			length
		};
	}
	/** Encode a size value in the fewest bytes that can hold it. */
	function writeVint(value) {
		for (let length = 1; length <= 8; length++) if (value <= Math.pow(2, 7 * length) - 2) {
			const out = new Uint8Array(length);
			let rest = value;
			for (let i = length - 1; i >= 0; i--) {
				out[i] = rest % 256;
				rest = Math.floor(rest / 256);
			}
			out[0] |= 128 >> length - 1;
			return out;
		}
		throw new Error("Value too large for an EBML size field");
	}
	function findElement(buf, from, to, id) {
		let pos = from;
		while (pos < to) {
			const elementId = readId(buf, pos);
			if (!elementId) return null;
			const size = readVint(buf, pos + elementId.length);
			if (!size) return null;
			const dataStart = pos + elementId.length + size.length;
			if (elementId.value === id) return {
				start: pos,
				dataStart,
				size: size.value,
				sizeLength: size.length
			};
			if (size.value === null) return null;
			pos = dataStart + size.value;
		}
		return null;
	}
	function readTimestampScale(info) {
		const scale = findElement(info, 0, info.length, ID_TIMESTAMP_SCALE);
		if (!scale || scale.size !== 4 && scale.size !== 8) return DEFAULT_TIMESTAMP_SCALE;
		let value = 0;
		for (let i = 0; i < scale.size; i++) value = value * 256 + info[scale.dataStart + i];
		return value > 0 ? value : DEFAULT_TIMESTAMP_SCALE;
	}
	/**
	* Return a copy of `bytes` with the recording's duration written into the EBML
	* header. Falls back to the input unchanged if the file does not look like the
	* layout MediaRecorder produces.
	*/
	function patchWebmDuration(bytes, durationMs) {
		if (!Number.isFinite(durationMs) || durationMs <= 0) return bytes;
		const segment = findElement(bytes, 0, bytes.length, ID_SEGMENT);
		if (!segment) return bytes;
		const segmentEnd = segment.size === null ? bytes.length : segment.dataStart + segment.size;
		const info = findElement(bytes, segment.dataStart, segmentEnd, ID_INFO);
		if (!info || info.size === null) return bytes;
		const infoEnd = info.dataStart + info.size;
		const infoPayload = bytes.subarray(info.dataStart, infoEnd);
		const timestampScale = readTimestampScale(infoPayload);
		const durationValue = durationMs * 1e6 / timestampScale;
		const existing = findElement(infoPayload, 0, infoPayload.length, ID_DURATION);
		let newPayload;
		if (existing) {
			const width = existing.size ?? 8;
			if (width !== 4 && width !== 8) return bytes;
			newPayload = new Uint8Array(infoPayload);
			writeFloat(newPayload, existing.dataStart, width, durationValue);
		} else {
			const scale = findElement(infoPayload, 0, infoPayload.length, ID_TIMESTAMP_SCALE);
			const insertAt = scale ? scale.dataStart + (scale.size ?? 0) : 0;
			const entry = buildDurationElement(durationValue);
			newPayload = new Uint8Array(infoPayload.length + entry.length);
			newPayload.set(infoPayload.subarray(0, insertAt), 0);
			newPayload.set(entry, insertAt);
			newPayload.set(infoPayload.subarray(insertAt), insertAt + entry.length);
		}
		const newInfoSize = writeVint(newPayload.length);
		if (newInfoSize.length !== info.sizeLength) return bytes;
		const outLength = bytes.length - info.size + newPayload.length;
		const out = new Uint8Array(outLength);
		out.set(bytes.subarray(0, info.dataStart), 0);
		out.set(newInfoSize, info.dataStart - info.sizeLength);
		out.set(newPayload, info.dataStart);
		out.set(bytes.subarray(infoEnd), info.dataStart + newPayload.length);
		return out;
	}
	function buildDurationElement(value) {
		const id = Uint8Array.from([68, 137]);
		const size = writeVint(8);
		const out = new Uint8Array(id.length + size.length + 8);
		out.set(id, 0);
		out.set(size, id.length);
		writeFloat(out, id.length + size.length, 8, value);
		return out;
	}
	function writeFloat(target, offset, width, value) {
		const view = new DataView(target.buffer, target.byteOffset + offset, width);
		if (width === 4) view.setFloat32(0, value);
		else view.setFloat64(0, value);
	}
	/**
	* Blob-facing wrapper: reads, patches, and hands back a Blob of the same type.
	* A failure anywhere returns the original blob rather than risking the take.
	*/
	async function fixWebmDuration(blob, durationMs) {
		if (!blob || blob.size === 0 || durationMs <= 0) return blob;
		if (!/webm|matroska/i.test(blob.type)) return blob;
		try {
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const patched = patchWebmDuration(bytes, durationMs);
			return patched === bytes ? blob : new Blob([patched.buffer], { type: blob.type });
		} catch {
			return blob;
		}
	}
	//#endregion
	//#region src/ui-manager.ts
	var UIManager = class {
		constructor() {
			this.videoPreview = document.getElementById("videoPreview");
			this.videoContainer = document.getElementById("videoContainer");
			this.cropBox = document.getElementById("cropBox");
			this.cropTargetElement = document.getElementById("cropTargetElement");
			this.shareBtn = document.getElementById("shareBtn");
			this.shareBtnStart = document.getElementById("shareBtnStart");
			this.shareBtnStop = document.getElementById("shareBtnStop");
			this.recordBtn = document.getElementById("recordBtn");
			this.recordBtnText = document.getElementById("recordBtnText");
			this.stopBtn = document.getElementById("stopBtn");
			this.downloadLink = document.getElementById("downloadLink");
			this.placeholder = document.getElementById("placeholder");
			this.statusDiv = document.getElementById("status");
			this.statusText = document.getElementById("statusText");
			this.statusDot = document.getElementById("statusDot");
			this.pauseBtn = document.getElementById("pauseBtn");
			this.pauseBtnText = document.getElementById("pauseBtnText");
			this.pauseBtnIcon = document.getElementById("pauseBtnIcon");
			this.statsText = document.getElementById("statsText");
			this.errorDiv = document.getElementById("error");
			this.formatSelect = document.getElementById("formatSelect");
			this.systemAudioToggle = document.getElementById("systemAudioToggle");
			this.micAudioToggle = document.getElementById("micAudioToggle");
			this.micNoiseSuppression = document.getElementById("micNoiseSuppression");
			this.micEchoCancellation = document.getElementById("micEchoCancellation");
			this.micAutoGain = document.getElementById("micAutoGain");
			this.systemVolume = document.getElementById("systemVolume");
			this.micVolume = document.getElementById("micVolume");
			this.systemVolumeValue = document.getElementById("systemVolumeValue");
			this.micVolumeValue = document.getElementById("micVolumeValue");
			this.cropCheckbox = document.getElementById("cropCheckbox");
			this.cropContainer = document.getElementById("cropContainer");
			this.systemAudioVisualizer = document.getElementById("systemAudioVisualizer");
			this.micAudioVisualizer = document.getElementById("micAudioVisualizer");
		}
		bindEvents(callbacks) {
			this.shareBtn.addEventListener("click", callbacks.onShare);
			this.recordBtn.addEventListener("click", callbacks.onRecord);
			this.stopBtn.addEventListener("click", callbacks.onStop);
			this.cropCheckbox.addEventListener("change", callbacks.onCropToggle);
			this.pauseBtn.addEventListener("click", callbacks.onPause);
		}
		/**
		* Reflect a paused capture in the status row: the label, the button, and the
		* indicator (amber and still rather than red and pulsing).
		*/
		setPausedState(isPaused) {
			this.statusText.textContent = isPaused ? "Paused" : "Recording...";
			this.pauseBtnText.textContent = isPaused ? "Resume" : "Pause";
			this.pauseBtn.title = isPaused ? "Resume recording (P)" : "Pause recording (P)";
			if (this.pauseBtnIcon) this.pauseBtnIcon.setAttribute("href", isPaused ? "./icons.svg#icon-record" : "./icons.svg#icon-pause");
			this.statusDot.classList.toggle("is-paused", isPaused);
		}
		/**
		* Show the running length of the take and how much has been written so far.
		* Both are interim figures until the capture stops.
		*/
		updateStats(duration, size) {
			this.statsText.textContent = `${duration} · ${size}`;
		}
		clearStats() {
			this.statsText.textContent = "";
		}
		populateFormats(formats) {
			formats.forEach((format) => {
				if (MediaRecorder.isTypeSupported(format.mimeType)) {
					const option = document.createElement("option");
					option.value = format.mimeType;
					option.textContent = format.name;
					option.dataset.ext = format.ext;
					this.formatSelect.appendChild(option);
				}
			});
			if (this.formatSelect.options.length === 0) {
				this.showError("No supported recording formats found in this browser.");
				this.disableShareBtn();
			}
		}
		disableShareBtn() {
			this.shareBtn.disabled = true;
		}
		showError(message) {
			this.errorDiv.textContent = message;
			this.errorDiv.classList.remove("hidden");
		}
		hideError() {
			this.errorDiv.textContent = "";
			this.errorDiv.classList.add("hidden");
		}
		/**
		* Match the preview container's aspect ratio to the shared screen so the
		* preview is never cropped or letterboxed. The container is `aspect-video`
		* (16:9) by default, which is wrong for any screen that is not 16:9.
		*/
		setPreviewAspect(width, height) {
			if (!width || !height) return;
			this.videoContainer.style.aspectRatio = `${width} / ${height}`;
		}
		resetPreviewAspect() {
			this.videoContainer.style.removeProperty("aspect-ratio");
		}
		setSharingState(isSharing) {
			const toggle = (el, show) => el.classList.toggle("hidden", !show);
			if (isSharing) {
				toggle(this.placeholder, false);
				toggle(this.shareBtnStart, false);
				toggle(this.shareBtnStop, true);
				this.recordBtn.disabled = false;
				this.cropCheckbox.disabled = false;
				this.formatSelect.disabled = true;
				this.systemAudioToggle.disabled = true;
				this.micAudioToggle.disabled = true;
				this.setMicProcessingDisabled(true);
				this.downloadLink.classList.add("pointer-events-none", "opacity-50");
				this.downloadLink.removeAttribute("href");
			} else {
				this.videoPreview.srcObject = null;
				this.resetPreviewAspect();
				toggle(this.placeholder, true);
				toggle(this.shareBtnStart, true);
				toggle(this.shareBtnStop, false);
				this.recordBtn.disabled = true;
				this.stopBtn.disabled = true;
				this.cropCheckbox.checked = false;
				this.cropCheckbox.disabled = true;
				toggle(this.cropContainer, false);
				this.cropBox.classList.remove("is-recording");
				this.formatSelect.disabled = false;
				this.systemAudioToggle.disabled = false;
				this.micAudioToggle.disabled = false;
				this.setMicProcessingDisabled(false);
			}
		}
		setRecordingState(isRecording) {
			const icon = this.recordBtn.querySelector("svg");
			if (isRecording) {
				this.statusDiv.classList.remove("hidden");
				this.setPausedState(false);
				this.stopBtn.disabled = false;
				this.recordBtn.disabled = true;
				this.shareBtn.disabled = true;
				this.cropCheckbox.disabled = true;
				if (this.cropCheckbox.checked) this.cropBox.classList.add("is-recording");
				if (icon) icon.style.display = "none";
			} else {
				this.statusDiv.classList.add("hidden");
				this.setPausedState(false);
				this.clearStats();
				this.stopBtn.disabled = true;
				if (this.cropCheckbox.checked) this.cropBox.classList.remove("is-recording");
				this.recordBtnText.textContent = "Start Recording";
				if (icon) icon.style.display = "inline-block";
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
			this.downloadLink.classList.remove("pointer-events-none", "opacity-50");
		}
		getFormat() {
			const selected = this.formatSelect.options[this.formatSelect.selectedIndex];
			return {
				name: selected.textContent || "",
				mimeType: selected.value,
				ext: selected.dataset.ext
			};
		}
		getAudioConfig() {
			return {
				systemAudio: this.systemAudioToggle.checked,
				micAudio: this.micAudioToggle.checked
			};
		}
		/**
		* Microphone conditioning. These are hints the browser may ignore, but they
		* must still be read at share time - once the stream exists the constraints
		* are fixed.
		*/
		getMicOptions() {
			return {
				enabled: this.micAudioToggle.checked,
				noiseSuppression: this.micNoiseSuppression.checked,
				echoCancellation: this.micEchoCancellation.checked,
				autoGainControl: this.micAutoGain.checked
			};
		}
		/**
		* Level for one source, as a gain multiplier. The faders stay live while
		* recording - balancing the two inputs is exactly the sort of thing you
		* discover you need mid-take.
		*/
		getVolume(source) {
			const slider = source === "system" ? this.systemVolume : this.micVolume;
			return Number(slider.value) / 100;
		}
		/** Wire the faders to a callback and keep the percentage readout in step. */
		bindVolumeControls(onChange) {
			const wire = (slider, readout, source) => {
				const sync = () => {
					readout.textContent = `${slider.value}%`;
					onChange(source);
				};
				slider.addEventListener("input", sync);
				sync();
			};
			wire(this.systemVolume, this.systemVolumeValue, "system");
			wire(this.micVolume, this.micVolumeValue, "mic");
		}
		setMicProcessingDisabled(disabled) {
			this.micNoiseSuppression.disabled = disabled;
			this.micEchoCancellation.disabled = disabled;
			this.micAutoGain.disabled = disabled;
		}
		toggleCropping(show) {
			this.cropContainer.classList.toggle("hidden", !show);
			this.cropTargetElement.classList.toggle("hidden", !show);
		}
		updateAudioLevel(source, level) {
			const visualizer = source === "system" ? this.systemAudioVisualizer : this.micAudioVisualizer;
			if (visualizer) visualizer.style.width = `${Math.min(100, Math.max(0, level * 100))}%`;
		}
	};
	//#endregion
	//#region src/index.ts
	const ui = new UIManager();
	const stopwatch = new Stopwatch();
	const cropper = new Cropper(ui.cropBox, ui.cropTargetElement, ui.videoContainer, ui.videoPreview);
	const recorder = new Recorder(onRecordingStop);
	let stream = null;
	let audioContext = null;
	let analysers = null;
	let visualizationAnimationFrame = null;
	/**
	* Per-source gains from the current capture, so the faders can drive them.
	* They are replaced wholesale when a new share starts, since a new capture
	* builds a fresh audio graph.
	*/
	let currentGains = {};
	function applyVolume(source) {
		const gain = source === "system" ? currentGains.system : currentGains.mic;
		if (!gain) return;
		gain.gain.value = ui.getVolume(source);
	}
	ui.bindVolumeControls(applyVolume);
	ui.videoPreview.addEventListener("resize", syncPreviewAspect);
	window.addEventListener("load", () => {
		ui.populateFormats(FORMATS_TO_CHECK);
		if (!window.MediaRecorder) {
			ui.showError("Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.");
			ui.disableShareBtn();
		}
	});
	ui.bindEvents({
		onShare: () => {
			if (stream) stopSharing();
			else handleShareScreen();
		},
		onRecord: startRecording,
		onStop: stopRecording,
		onCropToggle: toggleCropping,
		onPause: togglePause
	});
	bindShortcuts({
		onRecord: () => {
			if (!recorder.isActive()) startRecording();
		},
		onPause: togglePause,
		onStop: () => {
			if (recorder.isActive()) stopRecording();
		},
		onScreenshot: captureScreenshot
	});
	/**
	* Save the preview's current frame as a PNG. Silent when there is nothing to
	* capture - a shortcut should never throw up an error banner mid-take.
	*/
	async function captureScreenshot() {
		const blob = await captureFrame(ui.videoPreview);
		if (!blob) return;
		downloadBlob(blob, timestampFilename("png"));
	}
	/**
	* Pause/resume the in-flight capture. The stopwatch is paused alongside the
	* recorder so the timer keeps reporting the time actually captured.
	*/
	function togglePause() {
		if (!recorder.isActive()) return;
		if (recorder.isPaused()) {
			recorder.resume();
			stopwatch.resume();
			ui.setPausedState(false);
		} else {
			recorder.pause();
			stopwatch.pause();
			ui.setPausedState(true);
		}
	}
	async function handleShareScreen() {
		ui.hideError();
		try {
			const shareResult = await shareScreen(ui.getAudioConfig().systemAudio, ui.getMicOptions());
			currentGains = shareResult.gains;
			applyVolume("system");
			applyVolume("mic");
			stream = shareResult.stream;
			analysers = shareResult.analysers;
			audioContext = shareResult.audioContext;
			ui.videoPreview.srcObject = stream;
			await ui.videoPreview.play();
			ui.setSharingState(true);
			const [videoTrack] = stream.getVideoTracks();
			syncPreviewAspect();
			videoTrack.addEventListener("ended", stopSharing);
			visualizeAudio();
		} catch (err) {
			console.error("Error sharing screen:", err);
			let errorMsg = "Could not start screen sharing. Please grant permission and try again.";
			const error = err;
			if (error.name === "NotAllowedError") errorMsg = "Screen sharing permission was denied. Please allow permission and try again.";
			else if (error.name === "NotFoundError") errorMsg = "No screen sharing sources found. This can happen if your browser is misconfigured.";
			else if (error.name === "InvalidStateError") errorMsg = "An invalid state occurred. Please reload the page.";
			ui.showError(errorMsg);
			stopSharing();
		}
	}
	/**
	* Size the preview container to the shared screen's real aspect ratio.
	*
	* This reads the <video> element's own decoded frame size rather than
	* MediaTrack.getSettings(), because the two can disagree: the element is what
	* `object-contain` actually fits, so matching it is what keeps the preview
	* letterbox-free. It is kept in sync from the element's `resize` event, which
	* fires whenever the shared surface changes shape (e.g. the recorded window is
	* resized).
	*
	* The markup defaults to `aspect-video` (16:9) purely as an empty-state
	* placeholder.
	*/
	function syncPreviewAspect() {
		const w = ui.videoPreview.videoWidth;
		const h = ui.videoPreview.videoHeight;
		if (w && h) ui.setPreviewAspect(w, h);
	}
	async function startRecording() {
		if (!stream) {
			ui.showError("Please share your screen first.");
			return;
		}
		ui.hideError();
		const format = ui.getFormat();
		let streamToRecord = stream;
		if (ui.cropCheckbox.checked) streamToRecord = await cropper.startCrop(stream);
		try {
			recorder.start(streamToRecord, format);
		} catch (err) {
			ui.showError(err.message);
			stopSharing();
			return;
		}
		ui.setRecordingState(true);
		ui.clearStats();
		stopwatch.start((time) => {
			ui.updateStopwatch(time);
			ui.updateStats(formatDuration(stopwatch.elapsed()), formatBytes(recorder.bytesCaptured()));
		});
	}
	async function onRecordingStop(blob, ext) {
		const durationMs = stopwatch.elapsed();
		stopwatch.stop();
		const fixedBlob = await fixWebmDuration(blob, durationMs);
		const filename = timestampFilename(ext);
		const url = URL.createObjectURL(fixedBlob);
		ui.setDownloadLink(url, filename);
		ui.setRecordingState(false);
	}
	async function stopRecording() {
		await cropper.stopCrop(stream);
		if (recorder.isActive()) recorder.stop();
	}
	async function stopSharing() {
		await cropper.stopCrop(stream);
		if (recorder.isActive()) recorder.stop();
		if (visualizationAnimationFrame) {
			cancelAnimationFrame(visualizationAnimationFrame);
			visualizationAnimationFrame = null;
		}
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		analysers = null;
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
			stream = null;
		}
		ui.setSharingState(false);
		cropper.hide();
	}
	function visualizeAudio() {
		if (!analysers) return;
		const bufferLength = 256;
		const dataArray = new Uint8Array(bufferLength);
		if (analysers.system) {
			analysers.system.getByteFrequencyData(dataArray);
			const average = dataArray.reduce((src, a) => src + a, 0) / bufferLength;
			ui.updateAudioLevel("system", average / 128);
		} else ui.updateAudioLevel("system", 0);
		if (analysers.mic) {
			analysers.mic.getByteFrequencyData(dataArray);
			const average = dataArray.reduce((src, a) => src + a, 0) / bufferLength;
			ui.updateAudioLevel("mic", average / 128);
		} else ui.updateAudioLevel("mic", 0);
		visualizationAnimationFrame = requestAnimationFrame(visualizeAudio);
	}
	function toggleCropping() {
		if (ui.cropCheckbox.checked) {
			ui.toggleCropping(true);
			cropper.show();
		} else {
			ui.toggleCropping(false);
			cropper.hide();
		}
	}
	//#endregion
})();
