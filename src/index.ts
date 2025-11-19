// Define CropTarget interface as it might not be in standard lib yet
interface CropTarget {
  fromElement(element: Element): Promise<CropTarget>;
}
declare const CropTarget: {
  fromElement(element: Element): Promise<CropTarget>;
};

// Extend MediaStreamTrack to include cropTo
interface CropMediaStreamTrack extends MediaStreamTrack {
  cropTo(target: CropTarget | null): Promise<void>;
}

const videoPreview = document.getElementById("videoPreview") as HTMLVideoElement;
const videoContainer = document.getElementById("videoContainer") as HTMLDivElement;
const shareBtn = document.getElementById("shareBtn") as HTMLButtonElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const recordBtnText = document.getElementById("recordBtnText") as HTMLSpanElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const downloadLink = document.getElementById("downloadLink") as HTMLAnchorElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const errorDiv = document.getElementById("error") as HTMLDivElement;
const formatSelect = document.getElementById("formatSelect") as HTMLSelectElement;
// Updated audio element references
const systemAudioToggle = document.getElementById("systemAudioToggle") as HTMLInputElement;
const micAudioToggle = document.getElementById("micAudioToggle") as HTMLInputElement;
const cropCheckbox = document.getElementById("cropCheckbox") as HTMLInputElement;
const cropContainer = document.getElementById("cropContainer") as HTMLDivElement;
const cropTargetElement = document.getElementById("cropTargetElement") as HTMLDivElement;
const cropBox = document.getElementById("cropBox") as HTMLDivElement;

let mediaRecorder: MediaRecorder;
let recordedChunks: Blob[] = [];
let stream: MediaStream | null;
let stopwatchInterval: any = null;
let startTime = 0;
let cropAnimationId: number | null = null;

interface RecordingFormat {
  name: string;
  mimeType: string;
  ext: string;
}

const supportedFormats: RecordingFormat[] = [];
const isCropApiSupported =
  "CropTarget" in window && "fromElement" in CropTarget;

// --- Initialization ---
window.addEventListener("load", populateSelectors);

function populateSelectors() {
  const formatsToCheck = [
    {
      name: "AV1 + Opus (MP4)",
      mimeType: "video/mp4; codecs=av01.0.05M.08,opus",
      ext: "mp4",
    },
    {
      name: "H.265/HEVC + Opus (MP4)",
      mimeType: "video/mp4; codecs=hvc1.1.6.L93.B0,opus",
      ext: "mp4",
    },
    {
      name: "VP9 + Opus (WebM)",
      mimeType: "video/webm; codecs=vp9,opus",
      ext: "webm",
    },
    {
      name: "H.264 + AAC (MP4)",
      mimeType: "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
      ext: "mp4",
    },
    {
      name: "VP9 (WebM)",
      mimeType: "video/webm; codecs=vp9",
      ext: "webm",
    },
    {
      name: "H.264 (MP4)",
      mimeType: "video/mp4; codecs=avc1.42E01E",
      ext: "mp4",
    },
  ];

  formatsToCheck.forEach((format) => {
    if (MediaRecorder.isTypeSupported(format.mimeType)) {
      supportedFormats.push(format);
      const option = document.createElement("option");
      option.value = format.mimeType;
      option.textContent = format.name;
      option.dataset.ext = format.ext;
      formatSelect.appendChild(option);
    }
  });

  if (formatSelect.options.length === 0) {
    showError("No supported recording formats found in this browser.");
    shareBtn.disabled = true;
  }
}

if (!window.MediaRecorder) {
  showError(
    "Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox."
  );
  shareBtn.disabled = true;
}

// --- Event Listeners ---
shareBtn.addEventListener("click", () => {
  if (stream) stopSharing();
  else shareScreen();
});
recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
cropCheckbox.addEventListener("change", toggleCropping);

// --- Functions ---

function showError(message: string) {
  errorDiv.textContent = message;
  errorDiv.classList.remove("hidden");
}

function hideError() {
  errorDiv.textContent = "";
  errorDiv.classList.add("hidden");
}

async function shareScreen() {
  hideError();
  // Reset download link from any previous recording
  downloadLink.classList.add("pointer-events-none", "opacity-50");
  downloadLink.removeAttribute("href");

  try {
    // Get audio settings from checkboxes
    const wantsSystemAudio = systemAudioToggle.checked;
    const wantsMicAudio = micAudioToggle.checked;

    let displayStream: MediaStream;
    let micStream: MediaStream | undefined;
    let finalStream = new MediaStream();

    // 1. Get Display Stream (Video + System Audio if needed)
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" } as any, // cursor: 'always' might not be in standard types yet
      audio: wantsSystemAudio, // Request system audio based on toggle
    });

    // Add video track to final stream
    displayStream.getVideoTracks().forEach((track) => {
      finalStream.addTrack(track);
    });

    // 2. Get Mic Stream (if toggle is checked)
    if (wantsMicAudio) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (micErr) {
        console.error("Could not get microphone:", micErr);
        showError("Could not access microphone. Continuing without it.");
        // Continue without mic
      }
    }

    // 3. Combine Audio Tracks
    const systemAudioTrack = displayStream.getAudioTracks()[0];
    const micAudioTrack = micStream ? micStream.getAudioTracks()[0] : null;

    if (systemAudioTrack && micAudioTrack) {
      // ---- Both system and mic ----
      // Use AudioContext to merge the two audio streams
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Add system audio source
      const systemSource = audioContext.createMediaStreamSource(
        new MediaStream([systemAudioTrack])
      );
      systemSource.connect(destination);

      // Add mic audio source
      const micSource = audioContext.createMediaStreamSource(
        new MediaStream([micAudioTrack])
      );
      micSource.connect(destination);

      // Add the combined audio track to the final stream
      destination.stream.getAudioTracks().forEach((track) => {
        finalStream.addTrack(track);
      });
    } else if (systemAudioTrack) {
      // ---- System audio only ----
      finalStream.addTrack(systemAudioTrack);
    } else if (micAudioTrack) {
      // ---- Mic audio only ----
      finalStream.addTrack(micAudioTrack);
    }
    // If neither is present, no audio tracks are added.

    stream = finalStream; // This is the stream that will be recorded

    videoPreview.srcObject = stream;
    await videoPreview.play();
    placeholder.classList.add("hidden");

    shareBtn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg> Stop Sharing`;
    recordBtn.disabled = false;
    cropCheckbox.disabled = false;
    formatSelect.disabled = true;
    // Disable audio toggles
    systemAudioToggle.disabled = true;
    micAudioToggle.disabled = true;

    // When the user stops sharing via the browser UI, the video track ends.
    stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  } catch (err: any) {
    console.error("Error sharing screen:", err);
    let errorMsg =
      "Could not start screen sharing. Please grant permission and try again.";
    if (err.name === "NotAllowedError") {
      errorMsg =
        "Screen sharing permission was denied. Please allow permission and try again.";
    } else if (err.name === "NotFoundError") {
      errorMsg =
        "No screen sharing sources found. This can happen if your browser is misconfigured.";
    } else if (err.name === "InvalidStateError") {
      errorMsg = "An invalid state occurred. Please reload the page.";
    }
    showError(errorMsg);
    stopSharing(); // Ensure UI is reset
  }
}

async function startRecording() {
  if (!stream) {
    showError("Please share your screen first.");
    return;
  }
  hideError();
  recordedChunks = [];

  const selectedFormat = formatSelect.options[formatSelect.selectedIndex];
  const mimeType = selectedFormat.value;

  let streamToRecord = stream;

  if (cropCheckbox.checked) {
    if (isCropApiSupported) {
      try {
        const [videoTrack] = stream.getVideoTracks();
        const cropTarget = await CropTarget.fromElement(
          cropTargetElement
        );
        await (videoTrack as unknown as CropMediaStreamTrack).cropTo(cropTarget);
      } catch (err) {
        console.error(
          "Native cropping failed, falling back to canvas.",
          err
        );
        streamToRecord = getCanvasFallbackStream();
      }
    } else {
      streamToRecord = getCanvasFallbackStream();
    }
  }

  try {
    mediaRecorder = new MediaRecorder(streamToRecord, {
      mimeType: mimeType,
    });
  } catch (err) {
    console.error("Failed to create MediaRecorder:", err);
    showError(`Failed to start recording. Unsupported format: ${mimeType}`);
    stopSharing();
    return;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };

  mediaRecorder.onstop = () => {
    // This is the centralized cleanup function for when a recording ends.
    // 1. Create the downloadable file.
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");
    const timestamp = `${year}${month}${day}-${hours}-${minutes}-${seconds}`;

    const selectedFormatOption =
      formatSelect.options[formatSelect.selectedIndex];
    const fileExtension = selectedFormatOption.dataset.ext!;
    const mimeTypeBlob = selectedFormatOption.value.split(";")[0];

    downloadLink.download = `${timestamp}.${fileExtension}`;
    const blob = new Blob(recordedChunks, { type: mimeTypeBlob });
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.classList.remove("pointer-events-none", "opacity-50");

    // 2. Reset the UI for recording.
    statusDiv.classList.add("hidden");
    stopStopwatch();
    stopBtn.disabled = true;
    if (cropCheckbox.checked) {
      cropBox.classList.remove("is-recording");
    }
    // Only re-enable controls if the user is still sharing.
    if (stream && stream.active) {
      recordBtn.disabled = false;
      shareBtn.disabled = false;
      cropCheckbox.disabled = false;
    }
  };

  mediaRecorder.start();

  // Update UI to "recording" state
  statusDiv.classList.remove("hidden");
  stopBtn.disabled = false;
  recordBtn.disabled = true;
  shareBtn.disabled = true;
  cropCheckbox.disabled = true;
  if (cropCheckbox.checked) {
    cropBox.classList.add("is-recording");
  }
  startStopwatch();
}

function getCanvasFallbackStream() {
  if (!stream) return new MediaStream(); // Should not happen
  const cropCanvas = document.createElement("canvas");
  const ctx = cropCanvas.getContext("2d")!;
  const videoRect = videoPreview.getBoundingClientRect();
  const boxRect = cropBox.getBoundingClientRect();
  const trackSettings = stream.getVideoTracks()[0].getSettings();

  const scaleX = (trackSettings.width || 0) / videoRect.width;
  const scaleY = (trackSettings.height || 0) / videoRect.height;

  const sourceX = (boxRect.left - videoRect.left) * scaleX;
  const sourceY = (boxRect.top - videoRect.top) * scaleY;
  const sourceWidth = boxRect.width * scaleX;
  const sourceHeight = boxRect.height * scaleY;

  cropCanvas.width = Math.round(sourceWidth);
  cropCanvas.height = Math.round(sourceHeight);

  function drawCropFrame() {
    ctx.drawImage(
      videoPreview,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );
    cropAnimationId = requestAnimationFrame(drawCropFrame);
  }
  drawCropFrame();

  const canvasStream = cropCanvas.captureStream();
  stream
    .getAudioTracks()
    .forEach((track) => canvasStream.addTrack(track.clone()));
  return canvasStream;
}

async function stopRecording() {
  await removeCrop();
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

async function stopSharing() {
  await removeCrop();
  // If a recording is in progress, stop it. The onstop handler will generate the download.
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  // Reset the UI for SHARING only. onstop handles the recording UI.
  videoPreview.srcObject = null;
  placeholder.classList.remove("hidden");
  shareBtn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"></path></svg> Share Screen`;
  recordBtn.disabled = true;
  stopBtn.disabled = true;
  cropCheckbox.checked = false;
  cropCheckbox.disabled = true;
  cropContainer.classList.add("hidden");
  cropBox.classList.remove("is-recording");
  formatSelect.disabled = false;
  // Re-enable audio toggles
  systemAudioToggle.disabled = false;
  micAudioToggle.disabled = false;
}

function startStopwatch() {
  startTime = Date.now();
  const icon = recordBtn.querySelector("svg");
  if (icon) (icon as unknown as HTMLElement).style.display = "none";
  stopwatchInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    recordBtnText.textContent = `${mins}:${secs}`;
  }, 1000);
}


function stopStopwatch() {
  if (stopwatchInterval) {
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
  }
  recordBtnText.textContent = "Start Recording";
  const icon = recordBtn.querySelector("svg");
  if (icon) (icon as unknown as HTMLElement).style.display = "inline-block";
}

// --- Cropping Logic ---
function toggleCropping() {
  if (cropCheckbox.checked) {
    cropContainer.classList.remove("hidden");
    cropTargetElement.classList.remove("hidden");
    initializeCropBox();
  } else {
    cropContainer.classList.add("hidden");
    cropTargetElement.classList.add("hidden");
  }
}

function initializeCropBox() {
  const styles = { left: "10%", top: "10%", width: "80%", height: "80%" };
  Object.assign(cropBox.style, styles);
  Object.assign(cropTargetElement.style, styles);
  cropBox.addEventListener("mousedown", onCropBoxMouseDown);
}

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

let dragState: DragState = {} as DragState;

function onCropBoxMouseDown(e: MouseEvent) {
  e.preventDefault();
  const target = e.target as HTMLElement;
  const handle = target.closest(".resize-handle");
  dragState = {
    resizing: !!handle,
    dragging: !handle,
    handle: handle
      ? handle.className.replace("resize-handle ", "").trim()
      : null,
    startX: e.clientX,
    startY: e.clientY,
    containerRect: videoContainer.getBoundingClientRect(),
    initialLeft: cropBox.offsetLeft,
    initialTop: cropBox.offsetTop,
    initialWidth: cropBox.offsetWidth,
    initialHeight: cropBox.offsetHeight,
  };
  window.addEventListener("mousemove", onCropBoxMouseMove);
  window.addEventListener("mouseup", onCropBoxMouseUp);
}

function onCropBoxMouseMove(e: MouseEvent) {
  let styles: Partial<CSSStyleDeclaration> = {};
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  if (dragState.dragging) {
    let newLeft = dragState.initialLeft + dx;
    let newTop = dragState.initialTop + dy;

    newLeft = Math.max(
      0,
      Math.min(
        newLeft,
        dragState.containerRect.width - dragState.initialWidth
      )
    );
    newTop = Math.max(
      0,
      Math.min(
        newTop,
        dragState.containerRect.height - dragState.initialHeight
      )
    );

    styles = { left: `${newLeft}px`, top: `${newTop}px` };
  } else if (dragState.resizing) {
    let newLeft = dragState.initialLeft;
    let newTop = dragState.initialTop;
    let newWidth = dragState.initialWidth;
    let newHeight = dragState.initialHeight;

    if (dragState.handle && dragState.handle.includes("right")) newWidth += dx;
    if (dragState.handle && dragState.handle.includes("left")) {
      newWidth -= dx;
      newLeft += dx;
    }
    if (dragState.handle && dragState.handle.includes("bottom")) newHeight += dy;
    if (dragState.handle && dragState.handle.includes("top")) {
      newHeight -= dy;
      newTop += dy;
    }

    const minSize = 20;

    if (newWidth < minSize) {
      if (dragState.handle && dragState.handle.includes("left"))
        newLeft =
          dragState.initialLeft + dragState.initialWidth - minSize;
      newWidth = minSize;
    }
    if (newHeight < minSize) {
      if (dragState.handle && dragState.handle.includes("top"))
        newTop = dragState.initialTop + dragState.initialHeight - minSize;
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
    if (newLeft + newWidth > dragState.containerRect.width) {
      newWidth = dragState.containerRect.width - newLeft;
    }
    if (newTop + newHeight > dragState.containerRect.height) {
      newHeight = dragState.containerRect.height - newTop;
    }

    styles = {
      left: `${newLeft}px`,
      top: `${newTop}px`,
      width: `${newWidth}px`,
      height: `${newHeight}px`,
    };
  }
  if (Object.keys(styles).length) {
    Object.assign(cropBox.style, styles);
    Object.assign(cropTargetElement.style, cropBox.style);
  }
}

function onCropBoxMouseUp() {
  window.removeEventListener("mousemove", onCropBoxMouseMove);
  window.removeEventListener("mouseup", onCropBoxMouseUp);
}

async function removeCrop() {
  if (cropAnimationId) {
    cancelAnimationFrame(cropAnimationId);
    cropAnimationId = null;
  }
  if (stream && isCropApiSupported) {
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
