/** Which microphone conditioning to ask the browser for. */
export interface MicOptions {
  enabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

/** Sensible starting point: everything on, which suits most rooms. */
export const DEFAULT_MIC_OPTIONS: MicOptions = {
  enabled: false,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

export interface ShareResult {
  stream: MediaStream;
  analysers: {
    system?: AnalyserNode;
    mic?: AnalyserNode;
  };
  /** Per-source gain so the two inputs can be balanced against each other. */
  gains: {
    system?: GainNode;
    mic?: GainNode;
  };
  audioContext?: AudioContext;
}

export async function shareScreen(
  wantsSystemAudio: boolean,
  mic: MicOptions
): Promise<ShareResult> {
  const finalStream = new MediaStream();

  // 1. Get Display Stream
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' } as unknown as MediaTrackConstraints,
    audio: wantsSystemAudio,
  });

  displayStream
    .getVideoTracks()
    .forEach((track) => finalStream.addTrack(track));

  // 2. Get Mic Stream
  let micStream: MediaStream | undefined;
  if (mic.enabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        // These are hints the browser may or may not honour, but leaving them
        // unset means it applies its own defaults instead of the user's choice.
        audio: {
          noiseSuppression: mic.noiseSuppression,
          echoCancellation: mic.echoCancellation,
          autoGainControl: mic.autoGainControl,
        },
      });
    } catch (micErr) {
      console.error('Could not get microphone:', micErr);
      throw new Error('Could not access microphone. Continuing without it.');
    }
  }

  // 3. Setup Audio Context & Analysers
  const analysers: ShareResult['analysers'] = {};
  const gains: ShareResult['gains'] = {};
  let audioContext: AudioContext | undefined;

  const systemTrack = displayStream.getAudioTracks()[0];
  const micTrack = micStream?.getAudioTracks()[0];

  if (systemTrack || micTrack) {
    audioContext = new AudioContext({ latencyHint: 'playback' });
    audioContext.resume();
    const dest = audioContext.createMediaStreamDestination();

    const addSource = (track: MediaStreamTrack, which: 'system' | 'mic') => {
      const source = audioContext!.createMediaStreamSource(
        new MediaStream([track])
      );

      // The meter taps the raw input, so it still shows the source is live
      // when its fader is pulled down; the gain sits only on the path that is
      // actually recorded.
      const analyser = audioContext!.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analysers[which] = analyser;

      const gain = audioContext!.createGain();
      source.connect(gain);
      gain.connect(dest);
      gains[which] = gain;
    };

    if (systemTrack) addSource(systemTrack, 'system');
    if (micTrack) addSource(micTrack, 'mic');

    dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));
  }

  return { stream: finalStream, analysers, gains, audioContext };
}
