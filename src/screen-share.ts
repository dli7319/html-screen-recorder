export interface ShareResult {
  stream: MediaStream;
  analysers: {
    system?: AnalyserNode;
    mic?: AnalyserNode;
  };
  audioContext?: AudioContext;
}

export async function shareScreen(
  wantsSystemAudio: boolean,
  wantsMicAudio: boolean
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
  if (wantsMicAudio) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micErr) {
      console.error('Could not get microphone:', micErr);
      throw new Error('Could not access microphone. Continuing without it.');
    }
  }

  // 3. Setup Audio Context & Analysers
  const analysers: ShareResult['analysers'] = {};
  let audioContext: AudioContext | undefined;

  const systemTrack = displayStream.getAudioTracks()[0];
  const micTrack = micStream?.getAudioTracks()[0];

  if (systemTrack || micTrack) {
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();

    if (systemTrack) {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([systemTrack])
      );
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(dest);
      analysers.system = analyser;
    }

    if (micTrack) {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([micTrack])
      );
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(dest);
      analysers.mic = analyser;
    }

    dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));
  }

  return { stream: finalStream, analysers, audioContext };
}
