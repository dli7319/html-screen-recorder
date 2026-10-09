(function() {
	//#region src/quality.ts
	/**
	* `Auto` entries map to "set nothing" so the browser picks. That is the right
	* default for screen capture: the ideal settings depend on the content, the
	* codec and the machine, and a hardcoded number will be wrong more often than
	* the browser is.
	*/
	const RESOLUTION_PRESETS = [
		{
			id: "source",
			label: "Source",
			width: void 0
		},
		{
			id: "1080p",
			label: "1080p (1920 wide)",
			width: 1920
		},
		{
			id: "720p",
			label: "720p (1280 wide)",
			width: 1280
		},
		{
			id: "480p",
			label: "480p (854 wide)",
			width: 854
		}
	];
	const FRAME_RATE_PRESETS = [
		{
			id: "source",
			label: "Source",
			frameRate: void 0
		},
		{
			id: "60",
			label: "60 fps",
			frameRate: 60
		},
		{
			id: "30",
			label: "30 fps",
			frameRate: 30
		},
		{
			id: "24",
			label: "24 fps",
			frameRate: 24
		}
	];
	const BITRATE_PRESETS = [
		{
			id: "auto",
			label: "Auto",
			videoBitsPerSecond: void 0
		},
		{
			id: "high",
			label: "High (~12 Mbps)",
			videoBitsPerSecond: 12e6
		},
		{
			id: "medium",
			label: "Medium (~6 Mbps)",
			videoBitsPerSecond: 6e6
		},
		{
			id: "low",
			label: "Low (~2.5 Mbps)",
			videoBitsPerSecond: 25e5
		}
	];
	/** Look up a preset's value by id, falling back to the first (`Auto`) entry. */
	function resolvePreset(presets, id) {
		return presets.find((p) => p.id === id) ?? presets[0];
	}
	/**
	* Build the `getDisplayMedia` video constraints.
	*
	* Pure so the exact object handed to the browser is pinned by tests. The
	* `cursor` option is a Chrome extension not yet in the standard types, hence
	* the cast - it is still part of the constraints the browser receives.
	*/
	function buildVideoConstraints(capture) {
		const constraints = { cursor: "always" };
		if (capture.width) constraints.width = { ideal: capture.width };
		if (capture.frameRate) constraints.frameRate = { ideal: capture.frameRate };
		return constraints;
	}
	/**
	* Build the `MediaRecorder` options.
	*
	* Also pure: an unset bitrate must be *absent* from the object rather than
	* present and undefined, so the browser's own per-codec default applies.
	*/
	function buildRecorderOptions(format, encoder) {
		const options = { mimeType: format.mimeType };
		if (encoder.videoBitsPerSecond) options.videoBitsPerSecond = encoder.videoBitsPerSecond;
		if (encoder.audioBitsPerSecond) options.audioBitsPerSecond = encoder.audioBitsPerSecond;
		return options;
	}
	/** Human-readable summary of what will actually be asked for. */
	function describeQuality(capture, encoder) {
		const dims = [];
		if (capture.width) dims.push(`${capture.width}w`);
		if (capture.frameRate) dims.push(`${capture.frameRate}fps`);
		return `${dims.length ? dims.join(" ") : "Source"} · ${encoder.videoBitsPerSecond ? `${(encoder.videoBitsPerSecond / 1e6).toFixed(1)} Mbps` : "Auto"}`;
	}
	//#endregion
	//#region src/screen-share.ts
	async function shareScreen(wantsSystemAudio, mic, capture = {}) {
		const finalStream = new MediaStream();
		const displayStream = await navigator.mediaDevices.getDisplayMedia({
			video: buildVideoConstraints(capture),
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
			hasSystemAudio: Boolean(systemTrack),
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
		start(stream, format, encoder = {}) {
			this.recordedChunks = [];
			try {
				this.mediaRecorder = new MediaRecorder(stream, buildRecorderOptions(format, encoder));
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
	/**
	* `Expires in 30 days` and friends, for a take cache retention window.
	*
	* Rounded to the nearest unit rather than floored: a fresh take is 29.999
	* days from expiry, and flooring would brand-new clips "Expires in 29 days"
	* next to a note promising 30 - the display would look wrong on its best
	* day. Rounding is never off by more than half a unit, and past the window
	* this reads "Expired" rather than pretending time is left.
	*/
	function formatExpiry(remainingMs) {
		if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Expired";
		const MINUTE = 6e4;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		const phrase = (value, unit) => `Expires in ${value} ${unit}${value === 1 ? "" : "s"}`;
		if (remainingMs >= DAY) return phrase(Math.round(remainingMs / DAY), "day");
		if (remainingMs >= HOUR) return phrase(Math.round(remainingMs / HOUR), "hour");
		return phrase(Math.max(1, Math.round(remainingMs / MINUTE)), "minute");
	}
	/**
	* The tone an expiry label should take: a take about to vanish (or gone) must
	* stand out from one with weeks left. Returns a modifier class for the label,
	* or '' for the calm default.
	*/
	function expiryTone(remainingMs) {
		const HOUR = 36e5;
		const DAY = 24 * HOUR;
		if (remainingMs <= HOUR) return "is-urgent";
		if (remainingMs < DAY) return "is-soon";
		return "";
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
		if (event.key === "Escape") return "cancel";
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
				case "screenshot":
					handlers.onScreenshot?.();
					break;
				case "cancel": handlers.onCancel?.();
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
	//#region src/countdown.ts
	function runCountdown(options) {
		const { seconds, onTick, onDone, onCancel } = options;
		let timerId = null;
		let finished = false;
		let cancelled = false;
		const finish = () => {
			if (finished || cancelled) return;
			finished = true;
			timerId = null;
			onDone();
		};
		const tick = (remaining) => {
			if (cancelled) return;
			if (remaining <= 0) {
				finish();
				return;
			}
			onTick?.(remaining);
			timerId = window.setTimeout(() => tick(remaining - 1), 1e3);
		};
		if (seconds <= 0) finish();
		else tick(seconds);
		return {
			cancel() {
				if (finished || cancelled) return;
				cancelled = true;
				if (timerId !== null) {
					window.clearTimeout(timerId);
					timerId = null;
				}
				onCancel?.();
			},
			isActive() {
				return !finished && !cancelled;
			}
		};
	}
	//#endregion
	//#region src/pip.ts
	var PictureInPicture = class {
		constructor(video, options = {}) {
			this.video = video;
			this.options = options;
			this.active = false;
			this.onLeave = () => {
				if (!this.active) return;
				this.active = false;
				this.options.onChange?.(false);
			};
			document.addEventListener("leavepictureinpicture", this.onLeave);
		}
		/**
		* Whether the browser supports PiP at all.
		*
		* Reported rather than assumed: some contexts disable it (certain embedded
		* frames, or a browser built without it), and a button that silently does
		* nothing is worse than no button.
		*/
		isSupported() {
			return typeof document.pictureInPictureEnabled === "boolean" ? document.pictureInPictureEnabled : typeof this.video.requestPictureInPicture === "function";
		}
		isActive() {
			return this.active;
		}
		/** Open the floating window. Must be called from a user gesture. */
		async enter() {
			if (!this.isSupported() || this.active) return false;
			try {
				await this.video.requestPictureInPicture();
				this.active = true;
				this.options.onChange?.(true);
				return true;
			} catch (err) {
				console.error("Picture-in-picture failed:", err);
				return false;
			}
		}
		/** Close the floating window, if one is open. */
		async exit() {
			if (document.pictureInPictureElement !== this.video) {
				this.active = false;
				return;
			}
			try {
				await document.exitPictureInPicture();
			} catch (err) {
				console.error("Leaving picture-in-picture failed:", err);
			}
			this.active = false;
			this.options.onChange?.(false);
		}
		async toggle() {
			if (this.active) await this.exit();
			else await this.enter();
		}
		/** Stop listening. The floating window is left alone. */
		destroy() {
			document.removeEventListener("leavepictureinpicture", this.onLeave);
		}
	};
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
	/**
	* The transport and status surface: the preview, the share/record/stop/pause
	* controls, and the status row.
	*
	* Capture *settings* live in SettingsPanel, and produced output lives in
	* GalleryView. What remains here is the state the user is in - idle, sharing,
	* recording, paused - and the controls that move between those states.
	*/
	var UIManager = class {
		constructor() {
			this.videoPreview = document.getElementById("videoPreview");
			this.videoContainer = document.getElementById("videoContainer");
			this.cropBox = document.getElementById("cropBox");
			this.cropTargetElement = document.getElementById("cropTargetElement");
			this.shareBtn = document.getElementById("shareBtn");
			this.emptyShareBtn = document.getElementById("emptyShareBtn");
			this.shareBtnStart = document.getElementById("shareBtnStart");
			this.shareBtnStop = document.getElementById("shareBtnStop");
			this.recordBtn = document.getElementById("recordBtn");
			this.recordBtnText = document.getElementById("recordBtnText");
			this.stopBtn = document.getElementById("stopBtn");
			this.screenshotBtn = document.getElementById("screenshotBtn");
			this.placeholder = document.getElementById("placeholder");
			this.statusDiv = document.getElementById("status");
			this.statusText = document.getElementById("statusText");
			this.statusDot = document.getElementById("statusDot");
			this.pauseBtn = document.getElementById("pauseBtn");
			this.pauseBtnText = document.getElementById("pauseBtnText");
			this.pauseBtnIcon = document.getElementById("pauseBtnIcon");
			this.statsText = document.getElementById("statsText");
			this.countdownOverlay = document.getElementById("countdownOverlay");
			this.countdownNumber = document.getElementById("countdownNumber");
			this.pipBtn = document.getElementById("pipBtn");
			this.pipBtnText = document.getElementById("pipBtnText");
			this.errorDiv = document.getElementById("error");
			this.cropCheckbox = document.getElementById("cropCheckbox");
			this.cropContainer = document.getElementById("cropContainer");
			this.systemAudioVisualizer = document.getElementById("systemAudioVisualizer");
			this.micAudioVisualizer = document.getElementById("micAudioVisualizer");
			this.transport = document.getElementById("transport");
			this.recordingActive = false;
			this.pausedActive = false;
			this.runDuration = "";
		}
		/**
		* Drive the presentation state.
		*
		* `data-phase` on the transport container decides which of the four buttons
		* is currently the obvious next step, and `data-state` on the status pill
		* decides its colour. Neither touches the buttons' ids, their listeners or
		* their enabled flags - those are the state machine, and this is only how it
		* looks. Keeping the two apart is what let the UI go from four equally loud
		* buttons to one without destabilising the recording logic underneath.
		*/
		setPhase(phase) {
			this.transport.dataset.phase = phase;
			this.statusDiv.dataset.state = phase;
			this.statusDiv.classList.remove("hidden");
			if (phase === "idle") this.statusText.textContent = "Ready";
			if (phase === "sharing") this.statusText.textContent = "Sharing";
			if (phase === "recording") this.statusText.textContent = "Recording";
		}
		/**
		* Reflect a live capture in the tab title, so a backgrounded tab still shows
		* the recorder is running - the one cue that survives switching away. The
		* pill is only visible while you are looking at the app; the title is not.
		*/
		syncTabTitle() {
			const BASE = "Screen Recorder";
			if (this.recordingActive && this.pausedActive) document.title = `⏸ Paused — ${BASE}`;
			else if (this.recordingActive) {
				const run = this.runDuration ? ` ${this.runDuration}` : "";
				document.title = `● Recording${run} — ${BASE}`;
			} else document.title = BASE;
		}
		bindEvents(callbacks) {
			this.shareBtn.addEventListener("click", callbacks.onShare);
			this.emptyShareBtn.addEventListener("click", callbacks.onShare);
			this.recordBtn.addEventListener("click", callbacks.onRecord);
			this.stopBtn.addEventListener("click", callbacks.onStop);
			this.cropCheckbox.addEventListener("change", callbacks.onCropToggle);
			this.pauseBtn.addEventListener("click", callbacks.onPause);
			this.screenshotBtn.addEventListener("click", callbacks.onScreenshot);
			this.pipBtn.addEventListener("click", callbacks.onPip);
			const shell = document.body;
			const drawer = document.getElementById("settingsDrawer");
			const scrim = document.getElementById("settingsScrim");
			const openBtn = document.getElementById("openSettings");
			const chip = document.getElementById("settingsChip");
			const closeBtn = document.getElementById("closeSettings");
			const advBtn = document.getElementById("advToggle");
			const setPanel = (open) => {
				shell.dataset.panel = open ? "open" : "closed";
				drawer.setAttribute("aria-hidden", String(!open));
				openBtn.setAttribute("aria-expanded", String(open));
				if (open) closeBtn.focus();
				else openBtn.focus();
			};
			openBtn.addEventListener("click", () => setPanel(shell.dataset.panel !== "open"));
			chip.addEventListener("click", () => setPanel(true));
			closeBtn.addEventListener("click", () => setPanel(false));
			scrim.addEventListener("click", () => setPanel(false));
			document.addEventListener("keydown", (e) => {
				if (e.key === "Escape" && shell.dataset.panel === "open") setPanel(false);
			});
			advBtn.addEventListener("click", () => {
				const open = shell.dataset.adv !== "open";
				shell.dataset.adv = open ? "open" : "closed";
				advBtn.setAttribute("aria-expanded", String(open));
			});
		}
		/**
		* Reflect whether the preview is currently floating. The label changes
		* rather than the button disappearing, so the control stays put and its
		* state is readable at a glance.
		*/
		setPipState(active) {
			this.pipBtnText.textContent = active ? "Close" : "Pop out";
			this.pipBtn.title = active ? "Close the floating preview" : "Show the preview in a floating window";
			this.pipBtn.classList.toggle("bg-teal-600", active);
		}
		/** Whether the browser can do PiP at all; hides the control if not. */
		setPipSupported(supported) {
			this.pipBtn.dataset.supported = supported ? "true" : "false";
		}
		/**
		* Reflect a paused capture in the status row: the label, the button, and the
		* indicator (amber and still rather than red and pulsing).
		*/
		setPausedState(isPaused) {
			this.pausedActive = isPaused;
			this.statusText.textContent = isPaused ? "Paused" : "Recording...";
			this.pauseBtnText.textContent = isPaused ? "Resume" : "Pause";
			this.pauseBtn.title = isPaused ? "Resume recording (P)" : "Pause recording (P)";
			if (this.pauseBtnIcon) this.pauseBtnIcon.setAttribute("href", isPaused ? "./icons.svg#icon-record" : "./icons.svg#icon-pause");
			this.statusDot.classList.toggle("is-paused", isPaused);
			this.syncTabTitle();
		}
		/**
		* Show the running length of the take and how much has been written so far.
		* Both are interim figures until the capture stops.
		*/
		updateStats(duration, size) {
			this.runDuration = duration;
			this.statsText.textContent = `${duration} · ${size}`;
			this.syncTabTitle();
		}
		clearStats() {
			this.statsText.textContent = "";
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
				this.screenshotBtn.disabled = false;
				this.pipBtn.disabled = false;
				this.pipBtn.classList.remove("hidden");
				this.pipBtn.classList.add("flex");
				this.cropCheckbox.disabled = false;
			} else {
				this.videoPreview.srcObject = null;
				this.resetPreviewAspect();
				toggle(this.placeholder, true);
				toggle(this.shareBtnStart, true);
				toggle(this.shareBtnStop, false);
				this.recordBtn.disabled = true;
				this.screenshotBtn.disabled = true;
				this.pipBtn.disabled = true;
				this.pipBtn.classList.add("hidden");
				this.pipBtn.classList.remove("flex");
				this.stopBtn.disabled = true;
				this.cropCheckbox.checked = false;
				this.cropCheckbox.disabled = true;
				toggle(this.cropContainer, false);
				this.cropBox.classList.remove("is-recording");
				this.setPhase("idle");
			}
			if (isSharing) this.setPhase("sharing");
		}
		setRecordingState(isRecording) {
			const icon = this.recordBtn.querySelector("svg");
			this.recordingActive = isRecording;
			if (!isRecording) this.runDuration = "";
			if (isRecording) {
				this.setPhase("recording");
				this.setPausedState(false);
				this.stopBtn.disabled = false;
				this.recordBtn.disabled = true;
				this.shareBtn.disabled = true;
				this.cropCheckbox.disabled = true;
				if (this.cropCheckbox.checked) this.cropBox.classList.add("is-recording");
				if (icon) icon.style.display = "none";
			} else {
				this.setPhase("sharing");
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
			this.syncTabTitle();
		}
		updateStopwatch(text) {
			this.recordBtnText.textContent = text;
		}
		/**
		* Present the countdown.
		*
		* The Record button stays armed and reads "Cancel", so the countdown can be
		* called off from the control that started it rather than hunting for an
		* escape hatch.
		*/
		setCountdownState(active) {
			this.countdownOverlay.classList.toggle("hidden", !active);
			if (active) {
				this.recordBtn.disabled = false;
				this.recordBtnText.textContent = "Cancel";
				this.recordBtn.title = "Cancel the countdown (Esc)";
			} else {
				this.countdownNumber.textContent = "";
				this.recordBtn.title = "Start Recording (R)";
			}
		}
		showCountdown(remaining) {
			this.countdownNumber.textContent = String(remaining);
		}
		hideCountdown() {
			this.countdownOverlay.classList.add("hidden");
			this.countdownNumber.textContent = "";
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
	//#region src/settings-panel.ts
	/**
	* Everything the user configures before capturing: format, capture quality,
	* and the audio inputs.
	*
	* Split out of UIManager because this is a coherent block of settings with its
	* own locking rules, and because leaving it merged meant every feature added
	* more fields to a class that also owns the preview, the transport buttons and
	* the status row.
	*/
	var SettingsPanel = class {
		constructor() {
			this.formatSelect = document.getElementById("formatSelect");
			this.resolutionSelect = document.getElementById("resolutionSelect");
			this.frameRateSelect = document.getElementById("frameRateSelect");
			this.bitrateSelect = document.getElementById("bitrateSelect");
			this.qualitySummary = document.getElementById("qualitySummary");
			this.countdownSelect = document.getElementById("countdownSelect");
			this.systemAudioToggle = document.getElementById("systemAudioToggle");
			this.micAudioToggle = document.getElementById("micAudioToggle");
			this.micNoiseSuppression = document.getElementById("micNoiseSuppression");
			this.micEchoCancellation = document.getElementById("micEchoCancellation");
			this.micAutoGain = document.getElementById("micAutoGain");
			this.systemVolume = document.getElementById("systemVolume");
			this.micVolume = document.getElementById("micVolume");
			this.systemVolumeValue = document.getElementById("systemVolumeValue");
			this.micVolumeValue = document.getElementById("micVolumeValue");
			this.locked = false;
			this.systemAudioUnavailable = false;
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
			return this.formatSelect.options.length > 0;
		}
		/**
		* Populate the quality selects and wire their change handling in one call.
		*
		* Deliberately one method rather than a populate/bind pair that must be
		* called in the right order - a summary that silently stops updating is the
		* kind of bug nobody reports.
		*/
		populateQuality() {
			const fill = (select, presets) => {
				select.innerHTML = "";
				presets.forEach((preset) => {
					const option = document.createElement("option");
					option.value = preset.id;
					option.textContent = preset.label;
					select.appendChild(option);
				});
			};
			fill(this.resolutionSelect, RESOLUTION_PRESETS);
			fill(this.frameRateSelect, FRAME_RATE_PRESETS);
			fill(this.bitrateSelect, BITRATE_PRESETS);
			const sync = () => this.syncQualitySummary();
			this.resolutionSelect.addEventListener("change", sync);
			this.frameRateSelect.addEventListener("change", sync);
			this.bitrateSelect.addEventListener("change", sync);
			this.syncQualitySummary();
		}
		getFormat() {
			const selected = this.formatSelect.options[this.formatSelect.selectedIndex];
			return {
				name: selected.textContent || "",
				mimeType: selected.value,
				ext: selected.dataset.ext
			};
		}
		/**
		* The quality settings in effect.
		*
		* Split across the two half-interfaces because they have different
		* lifetimes: capture constraints are fixed once sharing starts, encoder
		* settings can change between takes.
		*/
		getQuality() {
			const resolution = resolvePreset(RESOLUTION_PRESETS, this.resolutionSelect.value);
			const frameRate = resolvePreset(FRAME_RATE_PRESETS, this.frameRateSelect.value);
			const bitrate = resolvePreset(BITRATE_PRESETS, this.bitrateSelect.value);
			return {
				width: resolution.width,
				frameRate: frameRate.frameRate,
				videoBitsPerSecond: bitrate.videoBitsPerSecond
			};
		}
		syncQualitySummary() {
			const q = this.getQuality();
			this.qualitySummary.textContent = describeQuality(q, q);
		}
		/**
		* Seconds to count down before capturing. Zero means start straight away -
		* the off setting is a value, not an absence.
		*/
		getCountdownSeconds() {
			const value = Number(this.countdownSelect.value);
			return Number.isFinite(value) && value > 0 ? value : 0;
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
		/**
		* Lock the settings that cannot change while a share is live.
		*
		* Only the capture-time settings lock. The bitrate is an encoder setting and
		* deliberately stays live, since it can take effect on the next take without
		* re-sharing - graying it out would imply the opposite.
		*/
		setLocked(locked) {
			this.locked = locked;
			this.formatSelect.disabled = locked;
			this.resolutionSelect.disabled = locked;
			this.frameRateSelect.disabled = locked;
			this.micAudioToggle.disabled = locked;
			this.micNoiseSuppression.disabled = locked;
			this.micEchoCancellation.disabled = locked;
			this.micAutoGain.disabled = locked;
			this.syncSystemAudioChip();
		}
		/**
		* A share can come back without system audio - the picker's "Share tab
		* audio" is the user's to untick, and window and screen shares carry no
		* audio at all. The chip then has nothing to control: the fader drives no
		* gain and the toggle cannot conjure a track the capture never made. So it
		* goes disabled and says why on hover, instead of accepting input that
		* silently does nothing. Restored by the next share.
		*/
		setSystemAudioAvailable(available) {
			this.systemAudioUnavailable = !available;
			this.syncSystemAudioChip();
		}
		syncSystemAudioChip() {
			const unavailable = this.systemAudioUnavailable;
			const chip = this.systemAudioToggle.closest(".source");
			this.systemAudioToggle.disabled = this.locked || unavailable;
			this.systemVolume.disabled = unavailable;
			if (!chip) return;
			chip.toggleAttribute("data-unavailable", unavailable);
			if (unavailable) chip.title = "System audio was not part of this share";
			else chip.removeAttribute("title");
		}
	};
	//#endregion
	//#region src/takes.ts
	/**
	* A cache that is full, disabled (some private windows), or simply slow must
	* never break a capture: the take is still made, still listed, still
	* downloadable - it just will not survive a refresh. So writes are fire and
	* forget, and only the failure is reported.
	*/
	function warnCacheFailure(err) {
		console.warn("Take cache write failed:", err);
	}
	/**
	* Owns the collection of takes and the blob URLs hanging off them.
	*
	* The URL lifecycle is the reason this exists as a class rather than an array.
	* A blob URL keeps the whole recording in memory until it is explicitly
	* revoked, and the previous single-download code never revoked anything. One
	* leaked URL was survivable; a gallery of a dozen takes would not be.
	*
	* With a cache attached it is also the only writer of cached takes: the same
	* three operations the gallery can perform - add, remove, clear - are the
	* three that reach storage, so the cache cannot drift from what is listed.
	*/
	var TakeStore = class TakeStore {
		constructor(cache) {
			this.cache = cache;
			this.takes = [];
			this.listeners = /* @__PURE__ */ new Set();
			this.counter = 0;
			this.sessionTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		}
		add(input) {
			const take = {
				id: this.nextId(),
				kind: input.kind,
				blob: input.blob,
				url: URL.createObjectURL(input.blob),
				filename: input.filename,
				size: input.blob.size,
				durationMs: input.durationMs,
				createdAt: input.createdAt ?? Date.now(),
				formatName: input.formatName
			};
			this.takes.unshift(take);
			this.cache?.put(TakeStore.toRecord(take)).catch(warnCacheFailure);
			this.emit();
			return take;
		}
		/**
		* The take as stored: blob-backed facts only. Both URL fields name memory
		* in this tab and are rebuilt on restore, so they are stripped here - the
		* one place that happens.
		*/
		static toRecord(take) {
			const { url: _url, thumbnailUrl: _thumbUrl, ...record } = take;
			return record;
		}
		/**
		* Attach a thumbnail that was made after the take landed. Idempotent, and a
		* no-op for an id that has since been removed or cleared - extraction is
		* async and the user is faster than any decoder. Reports whether the take
		* was still there to receive it.
		*/
		setThumbnail(id, thumbnail) {
			const take = this.takes.find((candidate) => candidate.id === id);
			if (!take) return false;
			if (take.thumbnailUrl) URL.revokeObjectURL(take.thumbnailUrl);
			const updated = {
				...take,
				thumbnail,
				thumbnailUrl: URL.createObjectURL(thumbnail)
			};
			this.takes[this.takes.indexOf(take)] = updated;
			this.cache?.put(TakeStore.toRecord(updated)).catch(warnCacheFailure);
			this.emit();
			return true;
		}
		nextId() {
			return `take-${this.sessionTag}-${(++this.counter).toString(36)}`;
		}
		/**
		* Re-populate from the cache. Called once at startup; safe to call on a
		* store that already holds takes (a capture made while the cache was still
		* loading) - existing takes win and the rest merge in by creation time.
		*/
		async restore() {
			if (!this.cache) return;
			let records;
			try {
				records = await this.cache.load();
			} catch (err) {
				warnCacheFailure(err);
				return;
			}
			const held = new Set(this.takes.map((take) => take.id));
			const restored = records.filter((record) => !held.has(record.id)).map((record) => ({
				...record,
				url: URL.createObjectURL(record.blob),
				thumbnailUrl: record.thumbnail ? URL.createObjectURL(record.thumbnail) : void 0
			}));
			if (restored.length === 0) return;
			this.takes = [...this.takes, ...restored].sort((a, b) => b.createdAt - a.createdAt);
			this.emit();
		}
		/** Remove one take and release its blob URLs. */
		remove(id) {
			const index = this.takes.findIndex((take) => take.id === id);
			if (index === -1) return;
			const [removed] = this.takes.splice(index, 1);
			TakeStore.release(removed);
			this.cache?.delete(id).catch(warnCacheFailure);
			this.emit();
		}
		/** Remove every take, releasing every blob URL. */
		clear() {
			for (const take of this.takes) TakeStore.release(take);
			const had = this.takes.length > 0;
			this.takes = [];
			this.cache?.clear().catch(warnCacheFailure);
			if (had) this.emit();
		}
		/**
		* Release everything. The store is unusable afterwards.
		*
		* Deliberately does not touch the cache: this is the page going away, not
		* the user saying "forget my takes".
		*/
		destroy() {
			for (const take of this.takes) TakeStore.release(take);
			this.takes = [];
			this.listeners.clear();
		}
		/** Every blob URL a take holds. Both are owned here and revoked nowhere else. */
		static release(take) {
			URL.revokeObjectURL(take.url);
			if (take.thumbnailUrl) URL.revokeObjectURL(take.thumbnailUrl);
		}
		list() {
			return this.takes;
		}
		count() {
			return this.takes.length;
		}
		totalBytes() {
			return this.takes.reduce((total, take) => total + take.size, 0);
		}
		byKind(kind) {
			return this.takes.filter((take) => take.kind === kind);
		}
		/**
		* Subscribe to changes. Returns the unsubscribe function, so wiring it up is
		* a single call with no bookkeeping on the caller.
		*/
		onChange(listener) {
			this.listeners.add(listener);
			return () => this.listeners.delete(listener);
		}
		emit() {
			const listeners = Array.from(this.listeners);
			for (const listener of listeners) listener();
		}
	};
	//#endregion
	//#region src/take-cache.ts
	const TAKE_TTL_MS = 2592e6;
	const DB_NAME = "html-screen-recorder";
	const DB_VERSION = 1;
	const STORE_NAME = "takes";
	function requestAsPromise(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	function transactionDone(tx) {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	}
	function openDatabase() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	/**
	* IndexedDB-backed TakePersistence.
	*
	* Every method resolves after its transaction commits, so callers that care
	* about ordering - a delete racing a put on the same id - can await. The
	* store itself fires these off without waiting; a cache that is slow or full
	* must never block a capture.
	*/
	var TakeCache = class {
		constructor() {
			this.db = null;
		}
		/** One open connection per page. Reused after the first call resolves. */
		database() {
			this.db ??= openDatabase();
			return this.db;
		}
		async put(record) {
			const tx = (await this.database()).transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).put(record);
			await transactionDone(tx);
		}
		async delete(id) {
			const tx = (await this.database()).transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).delete(id);
			await transactionDone(tx);
		}
		async clear() {
			const tx = (await this.database()).transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).clear();
			await transactionDone(tx);
		}
		/**
		* Every take still within the TTL, newest first.
		*
		* Expired rows are deleted here rather than by a timer: the cache is only
		* read on load, so this is the one moment stale rows would be seen, and a
		* sweep costs nothing extra alongside the read that already happened.
		*/
		async load() {
			const tx = (await this.database()).transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const all = await requestAsPromise(store.getAll());
			const cutoff = Date.now() - TAKE_TTL_MS;
			const fresh = all.filter((record) => !recordExpired(record, cutoff));
			for (const stale of all) if (recordExpired(stale, cutoff)) store.delete(stale.id);
			await transactionDone(tx);
			return fresh.sort((a, b) => b.createdAt - a.createdAt);
		}
	};
	function recordExpired(record, cutoff) {
		return record.createdAt < cutoff;
	}
	//#endregion
	//#region src/preview-modal.ts
	/**
	* The aspect the media box takes. The box itself is sized in CSS from these
	* variables (falling back to 16:9), so setting them keeps a clip's own shape
	* even when the element that knows the shape loads late. `--preview-ar-k` is
	* the same ratio as a plain number, which the width cap multiplies by to fit
	* the box exactly - a height cap alone would leave black bars wherever the
	* box ends up wider than its content.
	*/
	function setMediaAspect(video, width, height) {
		video.style.setProperty("--preview-ar", `${width} / ${height}`);
		video.style.setProperty("--preview-ar-k", String(width / height));
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
	var TakePreview = class {
		constructor(root, store) {
			this.root = root;
			this.store = store;
			this.currentId = null;
			this.opener = null;
			this.unsubscribe = null;
			this.onCloseClick = () => {
				this.close();
			};
			this.onKeyDown = (e) => {
				if (this.currentId === null) return;
				if (e.key === "Escape") this.close();
				else if (e.key === "ArrowLeft") {
					e.preventDefault();
					this.openRelative(-1);
				} else if (e.key === "ArrowRight") {
					e.preventDefault();
					this.openRelative(1);
				}
			};
			this.onDownload = () => {
				const take = this.store.list().find((t) => t.id === this.currentId);
				if (take) downloadBlob(take.blob, take.filename);
			};
			this.onPrev = () => this.openRelative(-1);
			this.onNext = () => this.openRelative(1);
			this.onStoreChange = () => {
				if (this.currentId === null) return;
				const take = this.store.list().find((t) => t.id === this.currentId);
				if (!take) {
					this.close();
					return;
				}
				const video = this.mediaSlot.querySelector("video");
				if (video && take.thumbnailUrl) video.poster = take.thumbnailUrl;
				this.updateNav();
			};
			this.scrim = this.require("#previewScrim");
			this.modal = this.require("#previewModal");
			this.title = this.require("#previewTitle");
			this.mediaSlot = this.require("#previewMedia");
			this.downloadBtn = this.require("#previewDownload");
			this.closeBtn = this.require("#previewClose");
			this.counter = this.require("#previewCounter");
			this.prevBtn = this.require("#previewPrev");
			this.nextBtn = this.require("#previewNext");
		}
		require(selector) {
			const el = this.root.querySelector(selector);
			if (!el) throw new Error(`Preview markup is missing ${selector}`);
			return el;
		}
		/** Wire the chrome. The document-level pieces are undone by unbind(). */
		bind() {
			this.unsubscribe?.();
			this.unsubscribe = this.store.onChange(this.onStoreChange);
			this.closeBtn.addEventListener("click", this.onCloseClick);
			this.scrim.addEventListener("click", this.onCloseClick);
			this.downloadBtn.addEventListener("click", this.onDownload);
			this.prevBtn.addEventListener("click", this.onPrev);
			this.nextBtn.addEventListener("click", this.onNext);
			document.addEventListener("keydown", this.onKeyDown);
		}
		unbind() {
			this.unsubscribe?.();
			this.unsubscribe = null;
			this.closeBtn.removeEventListener("click", this.onCloseClick);
			this.scrim.removeEventListener("click", this.onCloseClick);
			this.downloadBtn.removeEventListener("click", this.onDownload);
			this.prevBtn.removeEventListener("click", this.onPrev);
			this.nextBtn.removeEventListener("click", this.onNext);
			document.removeEventListener("keydown", this.onKeyDown);
			this.close();
		}
		open(take, opener) {
			this.clearMedia();
			this.title.textContent = take.filename;
			this.modal.setAttribute("aria-label", take.filename);
			if (take.kind === "recording") {
				const video = document.createElement("video");
				video.controls = true;
				video.playsInline = true;
				if (take.thumbnailUrl) video.poster = take.thumbnailUrl;
				video.src = take.url;
				this.mediaSlot.append(video);
				if (take.thumbnailUrl) {
					const probe = new Image();
					probe.addEventListener("load", () => {
						if (this.currentId === take.id && probe.naturalWidth > 0) setMediaAspect(video, probe.naturalWidth, probe.naturalHeight);
					});
					probe.src = take.thumbnailUrl;
				}
				video.addEventListener("loadedmetadata", () => {
					if (video.videoWidth > 0) setMediaAspect(video, video.videoWidth, video.videoHeight);
				});
			} else {
				const img = document.createElement("img");
				img.src = take.url;
				img.alt = take.filename;
				this.mediaSlot.append(img);
			}
			this.currentId = take.id;
			this.opener = opener ?? null;
			this.setOpen(true);
			this.updateNav();
			this.closeBtn.focus();
		}
		close() {
			if (this.currentId === null) return;
			this.clearMedia();
			this.currentId = null;
			this.setOpen(false);
			this.opener?.focus();
			this.opener = null;
		}
		setOpen(open) {
			document.body.dataset.preview = open ? "open" : "closed";
			this.modal.setAttribute("aria-hidden", String(!open));
		}
		/**
		* Detach the media without revoking anything. Clearing `src` stops a
		* playing clip at once - otherwise closing the dialog leaves its audio
		* running over the gallery.
		*/
		clearMedia() {
			const video = this.mediaSlot.querySelector("video");
			if (video) {
				video.pause();
				video.removeAttribute("src");
				video.load();
			}
			this.mediaSlot.replaceChildren();
		}
		/** Move to a neighbouring take in list order (the gallery is newest-first). */
		openRelative(offset) {
			const list = this.store.list();
			const idx = list.findIndex((t) => t.id === this.currentId);
			const target = list[idx + offset];
			if (idx < 0 || !target) return;
			this.open(target, this.opener ?? void 0);
		}
		/** Position in the list, and which way there is left to go. */
		updateNav() {
			const list = this.store.list();
			const idx = list.findIndex((t) => t.id === this.currentId);
			const total = list.length;
			const multi = total > 1;
			this.counter.textContent = multi ? `${idx + 1} / ${total}` : "";
			this.prevBtn.classList.toggle("hidden", !multi);
			this.nextBtn.classList.toggle("hidden", !multi);
			this.prevBtn.disabled = idx <= 0;
			this.nextBtn.disabled = idx >= total - 1;
		}
	};
	//#endregion
	//#region src/toast.ts
	/**
	* A single transient confirmation shown bottom-centre for a few seconds.
	*
	* Every take action used to fire silently: "Download all" kicked off N downloads,
	* "Remove" made a row vanish, "Clear" wiped the gallery - each with no trace that
	* it happened. This is the one shared way an action says "it worked" (or what it
	* did), so a click never leaves you wondering.
	*
	* It doubles as a live region (`role="status" aria-live="polite"` on the host in
	* index.html), so a screen reader hears the same confirmation everyone else sees.
	* One host element is reused and re-timed; a burst of actions shows the latest
	* message rather than stacking a pile of toasts.
	*/
	let timer;
	/** Show `message` bottom-centre for a few seconds, replacing any current one. */
	function showToast(message) {
		const host = document.getElementById("toastHost");
		const text = document.getElementById("toastText");
		if (!host || !text) return;
		text.textContent = message;
		host.classList.add("is-visible");
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			host.classList.remove("is-visible");
		}, 3200);
	}
	//#endregion
	//#region src/gallery-view.ts
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
	var GalleryView = class {
		constructor(root, store) {
			this.root = root;
			this.store = store;
			this.unsubscribe = null;
			this.clearArmed = false;
			this.clearLabel = "Clear";
			this.onDownloadAll = () => {
				const takes = this.store.list();
				downloadAll(takes);
				const n = takes.length;
				showToast(`Downloading ${n} ${n === 1 ? "take" : "takes"}`);
			};
			this.onClear = () => {
				if (!this.clearArmed) {
					this.armClear();
					return;
				}
				const n = this.store.list().length;
				this.store.clear();
				this.disarmClear();
				showToast(`Cleared ${n} ${n === 1 ? "take" : "takes"}`);
			};
			this.list = this.require("#takeList");
			this.emptyState = this.require("#takesEmpty");
			this.count = this.require("#takeCount");
			this.downloadAllBtn = this.require("#downloadAllBtn");
			this.clearBtn = this.require("#clearTakesBtn");
			this.preview = new TakePreview(document, store);
		}
		require(selector) {
			const el = this.root.querySelector(selector);
			if (!el) throw new Error(`Gallery markup is missing ${selector}`);
			return el;
		}
		/** Start rendering, wire the actions, and keep rendering as takes change. */
		bind() {
			this.unsubscribe?.();
			this.unsubscribe = this.store.onChange(() => this.render());
			this.downloadAllBtn.addEventListener("click", this.onDownloadAll);
			this.clearBtn.addEventListener("click", this.onClear);
			this.preview.bind();
			this.expiryTimer = window.setInterval(() => this.refreshExpiries(), 6e4);
			this.render();
		}
		unbind() {
			this.unsubscribe?.();
			this.unsubscribe = null;
			this.downloadAllBtn.removeEventListener("click", this.onDownloadAll);
			this.clearBtn.removeEventListener("click", this.onClear);
			this.preview.unbind();
			if (this.expiryTimer !== void 0) {
				window.clearInterval(this.expiryTimer);
				this.expiryTimer = void 0;
			}
			this.list.replaceChildren();
		}
		/**
		* Re-time every row's "Expires in ..." label in place. The rows keep their
		* identity so a background tick cannot steal focus or hover mid-read.
		*/
		refreshExpiries() {
			const labels = this.list.querySelectorAll("[data-expires-at]");
			for (const label of labels) {
				const remaining = Number(label.dataset.expiresAt) - Date.now();
				label.textContent = formatExpiry(remaining);
				this.setExpiryTone(label, remaining);
			}
		}
		/** Swap the label's urgency class to match the time left. */
		setExpiryTone(label, remainingMs) {
			label.classList.remove("is-soon", "is-urgent");
			const tone = expiryTone(remainingMs);
			if (tone) label.classList.add(tone);
		}
		/** First click: turn Clear into a danger-tinted "Confirm clear?" for a beat. */
		armClear() {
			this.clearArmed = true;
			this.clearBtn.textContent = "Confirm clear?";
			this.clearBtn.classList.add("is-armed");
			this.clearTimer = window.setTimeout(() => this.disarmClear(), 4e3);
		}
		/** Revert Clear to idle: text, tint, armed flag, and any pending timer. */
		disarmClear() {
			this.clearArmed = false;
			window.clearTimeout(this.clearTimer);
			this.clearTimer = void 0;
			this.clearBtn.textContent = this.clearLabel;
			this.clearBtn.classList.remove("is-armed");
		}
		render() {
			const takes = this.store.list();
			const has = takes.length > 0;
			this.emptyState.classList.toggle("hidden", has);
			this.downloadAllBtn.disabled = !has;
			this.clearBtn.disabled = !has;
			this.count.textContent = has ? `${takes.length} · ${formatBytes(this.store.totalBytes())}` : "";
			this.list.replaceChildren(...takes.map((take) => this.renderTake(take)));
		}
		renderTake(take) {
			const row = document.createElement("div");
			row.className = "take-row flex items-center gap-3 py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0";
			row.dataset.takeId = take.id;
			const icon = document.createElement("button");
			icon.type = "button";
			icon.className = "take-thumb";
			icon.title = `Preview ${take.filename}`;
			icon.setAttribute("aria-label", `Preview ${take.filename}`);
			if (take.thumbnailUrl) {
				const img = document.createElement("img");
				img.src = take.thumbnailUrl;
				img.alt = "";
				icon.append(img);
				if (take.kind === "recording") {
					const cue = document.createElement("span");
					cue.className = "thumb-cue";
					cue.setAttribute("aria-hidden", "true");
					cue.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
					icon.append(cue);
				}
			} else {
				icon.textContent = take.kind === "recording" ? "🎬" : "📷";
				icon.classList.add("is-loading");
			}
			icon.addEventListener("click", () => this.preview.open(take, icon));
			if (take.kind === "recording") {
				icon.addEventListener("mouseenter", () => this.startHoverPlay(icon, take));
				icon.addEventListener("mouseleave", () => this.stopHoverPlay(icon));
			}
			const detail = document.createElement("div");
			detail.className = "flex-1 min-w-0";
			const name = document.createElement("p");
			name.className = "text-sm font-medium text-gray-900 dark:text-gray-100 truncate";
			name.textContent = take.filename;
			name.title = take.filename;
			const meta = document.createElement("p");
			meta.className = "text-xs text-gray-500 dark:text-gray-400";
			meta.textContent = [this.describeTake(take), take.formatName].filter(Boolean).join(" · ");
			const expires = document.createElement("span");
			expires.className = "text-xs shrink-0 take-expiry";
			expires.dataset.expiresAt = String(take.createdAt + TAKE_TTL_MS);
			const remaining = take.createdAt + TAKE_TTL_MS - Date.now();
			expires.textContent = formatExpiry(remaining);
			this.setExpiryTone(expires, remaining);
			detail.append(name, meta);
			const download = document.createElement("button");
			download.type = "button";
			download.className = "btn btn--outline btn--sm shrink-0";
			download.textContent = "Download";
			download.title = `Download ${take.filename}`;
			download.addEventListener("click", () => {
				downloadBlob(take.blob, take.filename);
			});
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "btn btn--outline btn--danger btn--sm shrink-0";
			remove.textContent = "Remove";
			remove.title = `Remove ${take.filename} from the gallery`;
			remove.addEventListener("click", () => {
				this.store.remove(take.id);
				showToast(`Removed ${take.filename.length > 32 ? `${take.filename.slice(0, 31)}…` : take.filename}`);
			});
			const actions = document.createElement("div");
			actions.className = "take-actions";
			actions.append(expires, download, remove);
			row.append(icon, detail, actions);
			return row;
		}
		/** Length and size for a recording, just size for a screenshot. */
		describeTake(take) {
			const parts = [formatBytes(take.size)];
			if (take.durationMs !== void 0) parts.unshift(formatDuration(take.durationMs));
			return parts.join(" · ");
		}
		/**
		* Play the take's clip inside its thumbnail box on hover.
		*
		* The video is muted and looping with no controls - it is a moving preview
		* of the thumbnail, not playback. Autoplay is only ever granted to muted
		* elements, and if the browser refuses anyway the still simply stays.
		*/
		startHoverPlay(thumb, take) {
			if (thumb.querySelector("video")) return;
			const video = document.createElement("video");
			video.muted = true;
			video.loop = true;
			video.playsInline = true;
			video.src = take.url;
			thumb.append(video);
			Promise.resolve(video.play()).catch(() => {});
		}
		/** Take the hover video back out, leaving the thumbnail as it was. */
		stopHoverPlay(thumb) {
			const video = thumb.querySelector("video");
			if (!video) return;
			video.pause();
			video.removeAttribute("src");
			video.remove();
		}
	};
	/**
	* Download every take in turn.
	*
	* Browsers throttle parallel downloads kicked off by a single gesture, so
	* these are spaced out rather than fired together. Returns how many queued.
	*/
	function downloadAll(takes, delayMs = 250) {
		takes.forEach((take, index) => {
			window.setTimeout(() => downloadBlob(take.blob, take.filename), index * delayMs);
		});
		return takes.length;
	}
	/** Give up on extraction rather than leave a half-loaded video hanging. */
	const THUMBNAIL_TIMEOUT_MS = 3e3;
	/**
	* Where in a recording to grab the frame.
	*
	* Not the first frame: a MediaRecorder stream can open on a black or partial
	* frame before the compositor settles. Not the middle either - for a screen
	* recording, a second in is what the user was actually looking at. Clips
	* shorter than two seconds go to their midpoint instead of past their end.
	*/
	function pickSeekTime(durationMs) {
		if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
		return Math.min(1e3, durationMs / 2);
	}
	/**
	* The largest size within a max box that keeps the source aspect ratio.
	* Never upscales: a 40px screenshot stays 40px wide rather than blurring.
	*/
	function fitWithin(sourceWidth, sourceHeight, maxEdge = 320) {
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return {
			width: 0,
			height: 0
		};
		const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
		return {
			width: Math.max(1, Math.round(sourceWidth * scale)),
			height: Math.max(1, Math.round(sourceHeight * scale))
		};
	}
	/**
	* Draw a source that knows its own size into a JPEG/WebP blob. Prefers WebP
	* (roughly a third smaller at equal quality); falls back to JPEG for the
	* canvases that do not implement it. Returns null if the canvas cannot be
	* read back - some privacy modes taint or blank it.
	*/
	async function canvasToThumbnail(source, sourceWidth, sourceHeight) {
		const { width, height } = fitWithin(sourceWidth, sourceHeight);
		if (width === 0) return null;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.drawImage(source, 0, 0, width, height);
		const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
		return await encode("image/webp", .75) ?? await encode("image/jpeg", .8);
	}
	/**
	* One frame of a recorded clip, as a small image. `durationMs` comes from the
	* take when known - a MediaRecorder blob cannot be trusted to describe its
	* own length - and is only used to choose where to seek.
	*
	* Resolves null rather than rejecting: callers treat failure identically
	* whether it is a decode error, a timeout, or the browser refusing.
	*/
	async function extractVideoThumbnail(blob, durationMs) {
		const url = URL.createObjectURL(blob);
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		try {
			return await new Promise((resolve) => {
				let settled = false;
				const finish = (thumb) => {
					if (settled) return;
					settled = true;
					resolve(thumb);
				};
				const timer = setTimeout(() => finish(null), THUMBNAIL_TIMEOUT_MS);
				const done = (thumb) => {
					clearTimeout(timer);
					finish(thumb);
				};
				video.addEventListener("error", () => done(null), { once: true });
				video.addEventListener("loadeddata", () => {
					const seekTo = pickSeekTime(durationMs ?? video.duration * 1e3);
					if (seekTo > 0) {
						video.addEventListener("seeked", () => {
							canvasToThumbnail(video, video.videoWidth, video.videoHeight).then(done);
						}, { once: true });
						video.currentTime = seekTo / 1e3;
					} else canvasToThumbnail(video, video.videoWidth, video.videoHeight).then(done);
				}, { once: true });
				video.src = url;
				video.load();
			});
		} finally {
			URL.revokeObjectURL(url);
			video.removeAttribute("src");
			video.load();
		}
	}
	/**
	* A screenshot is already an image, so its thumbnail is just a shrunk copy -
	* the same fit math as the video path, without the seek.
	*/
	async function downscaleImage(blob) {
		let bitmap;
		try {
			bitmap = await createImageBitmap(blob);
		} catch {
			return null;
		}
		try {
			return await canvasToThumbnail(bitmap, bitmap.width, bitmap.height);
		} finally {
			bitmap.close();
		}
	}
	//#endregion
	//#region src/pwa.ts
	/**
	* Activate a waiting worker and run `onceControlled` afterwards.
	*
	* The reload is bound to `controllerchange` rather than fired immediately:
	* `postMessage` is asynchronous, so reloading right away would race the
	* activation and could serve the old worker again.
	*/
	function applyUpdate(container, worker, onceControlled) {
		container.addEventListener("controllerchange", () => onceControlled(), { once: true });
		worker.postMessage({ type: "SKIP_WAITING" });
	}
	/**
	* Report a waiting worker to the app, if there is one.
	*
	* Returns true when an update was handed over, so callers can distinguish
	* "already up to date" from "update ready".
	*/
	function armUpdate(container, worker, onUpdate, onceControlled) {
		if (!worker) return false;
		onUpdate?.(() => applyUpdate(container, worker, onceControlled));
		return true;
	}
	/**
	* Watch a registration for updates arriving after load.
	*
	* A worker that installs while an older one is controlling the page lands in
	* `waiting`; that is the only moment an update is actionable. An installing
	* worker with no existing controller is the *first* install, which is not an
	* update and must not trigger a prompt.
	*
	* `isControlled` is a predicate, not a boolean, and is evaluated when the
	* worker reaches `installed`. Sampling it at registration time was a bug: on a
	* first visit the worker has not claimed the page yet, so `controller` is null,
	* and the captured `false` stayed false for the life of the tab. Every later
	* update was then discarded and the Refresh control had nothing to apply - the
	* app looked up to date while sitting on a stale build.
	*/
	function observeUpdates(container, registration, onUpdate, onceControlled, isControlled) {
		registration.addEventListener("updatefound", () => {
			const installing = registration.installing;
			if (!installing) return;
			installing.addEventListener("statechange", () => {
				if (installing.state !== "installed") return;
				if (!isControlled()) return;
				armUpdate(container, installing, onUpdate, onceControlled);
			});
		});
	}
	async function registerServiceWorker(options = {}) {
		const { onUpdate, scriptUrl = "./sw.js", scope = "./", checkOnFocus = true } = options;
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
		if (typeof window !== "undefined" && !window.isSecureContext) return;
		const container = navigator.serviceWorker;
		const onceControlled = () => window.location.reload();
		try {
			const registration = await container.register(scriptUrl, {
				scope,
				updateViaCache: "none"
			});
			armUpdate(container, registration.waiting, onUpdate, onceControlled);
			observeUpdates(container, registration, onUpdate, onceControlled, () => Boolean(container.controller));
			if (checkOnFocus && typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible") registration.update().catch(() => {});
			});
		} catch {}
	}
	//#endregion
	//#region src/unload-guard.ts
	/**
	* Warn before the page unloads while a capture is still in flight.
	*
	* A reload or tab close destroys a MediaRecorder mid-stream: no take has landed
	* yet, so the clip is simply gone. Takes that already made it into the store are
	* cached in IndexedDB and come back after a reload, so the guard only fires while
	* a capture is actually being recorded or written out - never to nag about a
	* gallery of already-saved takes.
	*
	* Returns a teardown that removes the listener, so tests (and any future
	* teardown path) can undo it.
	*/
	function installUnloadGuard(isCapturing) {
		const handler = (event) => {
			if (!isCapturing()) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}
	//#endregion
	//#region src/index.ts
	const ui = new UIManager();
	const settings = new SettingsPanel();
	const takes = new TakeStore(new TakeCache());
	const galleryRoot = document.getElementById("takesRoot");
	if (!galleryRoot) throw new Error("Gallery markup is missing #takesRoot");
	const gallery = new GalleryView(galleryRoot, takes);
	const stopwatch = new Stopwatch();
	const cropper = new Cropper(ui.cropBox, ui.cropTargetElement, ui.videoContainer, ui.videoPreview);
	const recorder = new Recorder(onRecordingStop);
	const pip = new PictureInPicture(document.getElementById("videoPreview"), { onChange: (active) => ui.setPipState(active) });
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
	/**
	* The countdown in flight, if any. Kept at module level so the button and the
	* Escape key can both reach it and so a new capture cannot start underneath
	* one that is still counting.
	*/
	let activeCountdown = null;
	/**
	* True from the moment a take starts recording until its blob is safely in the
	* store. The unload guard keys off this rather than `recorder.isActive()`,
	* because a reload in the instant between the recorder stopping and the take
	* being written would still lose the clip.
	*/
	let captureInFlight = false;
	installUnloadGuard(() => captureInFlight);
	function applyVolume(source) {
		const gain = source === "system" ? currentGains.system : currentGains.mic;
		if (!gain) return;
		gain.gain.value = settings.getVolume(source);
	}
	settings.bindVolumeControls(applyVolume);
	ui.videoPreview.addEventListener("resize", syncPreviewAspect);
	window.addEventListener("load", () => {
		gallery.bind();
		takes.restore().then(backfillThumbnails);
		ui.setPipSupported(pip.isSupported());
		settings.populateQuality();
		if (!window.MediaRecorder) {
			ui.showError("Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.");
			ui.disableShareBtn();
			return;
		}
		if (!settings.populateFormats(FORMATS_TO_CHECK)) {
			ui.showError("No supported recording formats found in this browser.");
			ui.disableShareBtn();
		}
	});
	ui.bindEvents({
		onShare: () => {
			if (stream) stopSharing();
			else handleShareScreen();
		},
		onRecord: toggleRecord,
		onStop: stopRecording,
		onCropToggle: toggleCropping,
		onPause: togglePause,
		onScreenshot: captureScreenshot,
		onPip: () => {
			pip.toggle();
		}
	});
	bindShortcuts({
		onRecord: toggleRecord,
		onPause: togglePause,
		onStop: () => {
			if (recorder.isActive()) stopRecording();
		},
		onScreenshot: captureScreenshot,
		onCancel: cancelCountdown
	});
	const updateBanner = document.getElementById("updateBanner");
	const updateReloadBtn = document.getElementById("updateReloadBtn");
	const updateDismissBtn = document.getElementById("updateDismissBtn");
	let applyPendingUpdate = null;
	registerServiceWorker({ onUpdate: (apply) => {
		applyPendingUpdate = apply;
		if (updateBanner) updateBanner.hidden = false;
	} });
	updateReloadBtn?.addEventListener("click", () => applyPendingUpdate?.());
	updateDismissBtn?.addEventListener("click", () => {
		if (updateBanner) updateBanner.hidden = true;
	});
	/**
	* The Record button does two jobs: it starts a take, and it aborts a countdown
	* that is already running. Having one control that reverses itself keeps there
	* from being a second button that only exists for a few seconds.
	*/
	function toggleRecord() {
		if (activeCountdown) {
			cancelCountdown();
			return;
		}
		if (recorder.isActive()) return;
		startRecording();
	}
	function cancelCountdown() {
		activeCountdown?.cancel();
	}
	/**
	* Capture the preview's current frame as a PNG and file it as a take.
	*
	* Silent when there is nothing to capture - a shortcut should never throw up
	* an error banner mid-take - but when it does land it goes to the gallery like
	* a recording, so a screenshot cannot be lost by taking the next one.
	*/
	async function captureScreenshot() {
		const blob = await captureFrame(ui.videoPreview);
		if (!blob) return;
		attachThumbnail(takes.add({
			kind: "screenshot",
			blob,
			filename: timestampFilename("png"),
			formatName: "PNG"
		}), () => downscaleImage(blob));
	}
	/**
	* Make a take's thumbnail and attach it, best-effort. Fired from the capture
	* paths without awaiting: decoding must never delay the stop feedback. `make`
	* is a function so the store can have moved on by the time it resolves -
	* setThumbnail() is then a no-op rather than an error.
	*/
	function attachThumbnail(take, make) {
		return make().then((thumbnail) => {
			if (thumbnail) takes.setThumbnail(take.id, thumbnail);
		});
	}
	/**
	* Give restored takes that never got a thumbnail one.
	*
	* Rows cached before this feature existed have none, and one may have failed
	* mid-decode on a previous run. Two workers: a dozen simultaneous video
	* decodes at startup is a jank source, and there is no user-visible rush -
	* rows show their glyph until each picture lands.
	*/
	function backfillThumbnails() {
		const queue = takes.list().filter((take) => !take.thumbnail);
		const worker = async () => {
			for (let take = queue.shift(); take; take = queue.shift()) await attachThumbnail(take, () => makeThumbnail(take));
		};
		Promise.all([worker(), worker()]);
	}
	/** The thumbnail generator that fits a take's kind. */
	function makeThumbnail(take) {
		return take.kind === "recording" ? extractVideoThumbnail(take.blob, take.durationMs) : downscaleImage(take.blob);
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
			const shareResult = await shareScreen(settings.getAudioConfig().systemAudio, settings.getMicOptions(), settings.getQuality());
			currentGains = shareResult.gains;
			applyVolume("system");
			applyVolume("mic");
			stream = shareResult.stream;
			analysers = shareResult.analysers;
			audioContext = shareResult.audioContext;
			settings.setSystemAudioAvailable(shareResult.hasSystemAudio);
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
	/**
	* Begin a take: count down first if one is configured, then capture.
	*
	* The countdown runs before any capture setup so nothing is recorded during
	* it - the stopwatch in particular must not start until the take actually
	* does, or the reported length would include the countdown.
	*/
	function startRecording() {
		if (!stream) {
			ui.showError("Please share your screen first.");
			return;
		}
		ui.hideError();
		const seconds = settings.getCountdownSeconds();
		if (seconds <= 0) {
			startCapture();
			return;
		}
		ui.setCountdownState(true);
		activeCountdown = runCountdown({
			seconds,
			onTick: (remaining) => ui.showCountdown(remaining),
			onDone: () => {
				activeCountdown = null;
				ui.setCountdownState(false);
				ui.hideCountdown();
				startCapture();
			},
			onCancel: () => {
				activeCountdown = null;
				ui.setCountdownState(false);
				ui.hideCountdown();
			}
		});
	}
	/** Start capturing now. Called once the countdown has finished, or at once. */
	async function startCapture() {
		if (!stream) return;
		const format = settings.getFormat();
		let streamToRecord = stream;
		if (ui.cropCheckbox.checked) streamToRecord = await cropper.startCrop(stream);
		try {
			const quality = settings.getQuality();
			recorder.start(streamToRecord, format, { videoBitsPerSecond: quality.videoBitsPerSecond });
		} catch (err) {
			ui.showError(err.message);
			stopSharing();
			return;
		}
		captureInFlight = true;
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
		attachThumbnail(takes.add({
			kind: "recording",
			blob: fixedBlob,
			filename: timestampFilename(ext),
			formatName: settings.getFormat().name,
			durationMs
		}), () => extractVideoThumbnail(fixedBlob, durationMs));
		ui.setRecordingState(false);
		captureInFlight = false;
	}
	async function stopRecording() {
		await cropper.stopCrop(stream);
		if (recorder.isActive()) recorder.stop();
	}
	async function stopSharing() {
		cancelCountdown();
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
		settings.setSystemAudioAvailable(true);
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
