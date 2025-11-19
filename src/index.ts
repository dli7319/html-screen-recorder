import { shareScreen } from './screen-share';
import { Recorder } from './recorder';
import { Cropper } from './cropper';
import { RecordingFormat } from './types';

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
const systemAudioToggle = document.getElementById("systemAudioToggle") as HTMLInputElement;
const micAudioToggle = document.getElementById("micAudioToggle") as HTMLInputElement;
const cropCheckbox = document.getElementById("cropCheckbox") as HTMLInputElement;
const cropContainer = document.getElementById("cropContainer") as HTMLDivElement;
const cropTargetElement = document.getElementById("cropTargetElement") as HTMLDivElement;
const cropBox = document.getElementById("cropBox") as HTMLDivElement;

let stream: MediaStream | null = null;
let stopwatchInterval: any = null;
let startTime = 0;

const cropper = new Cropper(cropBox, cropTargetElement, videoContainer, videoPreview);
const recorder = new Recorder(onRecordingStop);

// --- Initialization ---
window.addEventListener("load", populateSelectors);

function populateSelectors() {
  const formatsToCheck = [
    { name: "AV1 + Opus (MP4)", mimeType: "video/mp4; codecs=av01.0.05M.08,opus", ext: "mp4" },
    { name: "H.265/HEVC + Opus (MP4)", mimeType: "video/mp4; codecs=hvc1.1.6.L93.B0,opus", ext: "mp4" },
    { name: "VP9 + Opus (WebM)", mimeType: "video/webm; codecs=vp9,opus", ext: "webm" },
    { name: "H.264 + AAC (MP4)", mimeType: "video/mp4; codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { name: "VP9 (WebM)", mimeType: "video/webm; codecs=vp9", ext: "webm" },
    { name: "H.264 (MP4)", mimeType: "video/mp4; codecs=avc1.42E01E", ext: "mp4" },
  ];

  formatsToCheck.forEach((format) => {
    if (MediaRecorder.isTypeSupported(format.mimeType)) {
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
  showError("Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.");
  shareBtn.disabled = true;
}

// --- Event Listeners ---
shareBtn.addEventListener("click", () => {
  if (stream) stopSharing();
  else handleShareScreen();
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

async function handleShareScreen() {
  hideError();
  downloadLink.classList.add("pointer-events-none", "opacity-50");
  downloadLink.removeAttribute("href");

  try {
    stream = await shareScreen(systemAudioToggle.checked, micAudioToggle.checked);

    videoPreview.srcObject = stream;
    await videoPreview.play();
    placeholder.classList.add("hidden");

    shareBtn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg> Stop Sharing`;
    recordBtn.disabled = false;
    cropCheckbox.disabled = false;
    formatSelect.disabled = true;
    systemAudioToggle.disabled = true;
    micAudioToggle.disabled = true;

    stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  } catch (err: any) {
    console.error("Error sharing screen:", err);
    let errorMsg = "Could not start screen sharing. Please grant permission and try again.";
    if (err.name === "NotAllowedError") errorMsg = "Screen sharing permission was denied. Please allow permission and try again.";
    else if (err.name === "NotFoundError") errorMsg = "No screen sharing sources found. This can happen if your browser is misconfigured.";
    else if (err.name === "InvalidStateError") errorMsg = "An invalid state occurred. Please reload the page.";

    showError(errorMsg);
    stopSharing();
  }
}

async function startRecording() {
  if (!stream) {
    showError("Please share your screen first.");
    return;
  }
  hideError();

  const selectedFormatOption = formatSelect.options[formatSelect.selectedIndex];
  const format: RecordingFormat = {
    name: selectedFormatOption.textContent || "",
    mimeType: selectedFormatOption.value,
    ext: selectedFormatOption.dataset.ext!
  };

  let streamToRecord = stream;

  if (cropCheckbox.checked) {
    streamToRecord = await cropper.startCrop(stream);
  }

  try {
    recorder.start(streamToRecord, format);
  } catch (err: any) {
    showError(err.message);
    stopSharing();
    return;
  }

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

function onRecordingStop(blob: Blob, ext: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  const timestamp = `${year}${month}${day}-${hours}-${minutes}-${seconds}`;

  downloadLink.download = `${timestamp}.${ext}`;
  const url = URL.createObjectURL(blob);

  downloadLink.href = url;
  downloadLink.classList.remove("pointer-events-none", "opacity-50");

  statusDiv.classList.add("hidden");
  stopStopwatch();
  stopBtn.disabled = true;
  if (cropCheckbox.checked) {
    cropBox.classList.remove("is-recording");
  }
  if (stream && stream.active) {
    recordBtn.disabled = false;
    shareBtn.disabled = false;
    cropCheckbox.disabled = false;
  }
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
  systemAudioToggle.disabled = false;
  micAudioToggle.disabled = false;
}

function startStopwatch() {
  startTime = Date.now();
  const icon = recordBtn.querySelector("svg");
  if (icon) (icon as unknown as HTMLElement).style.display = "none";
  stopwatchInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
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

function toggleCropping() {
  if (cropCheckbox.checked) {
    cropContainer.classList.remove("hidden");
    cropTargetElement.classList.remove("hidden");
    cropper.show();
  } else {
    cropContainer.classList.add("hidden");
    cropTargetElement.classList.add("hidden");
    cropper.hide();
  }
}
