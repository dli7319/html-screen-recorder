export async function shareScreen(
  wantsSystemAudio: boolean,
  wantsMicAudio: boolean
): Promise<MediaStream> {
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

  // 3. Combine Audio Tracks
  const systemTrack = displayStream.getAudioTracks()[0];
  const micTrack = micStream?.getAudioTracks()[0];

  if (systemTrack && micTrack) {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream([systemTrack])).connect(dest);
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
    dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));
  } else {
    if (systemTrack) finalStream.addTrack(systemTrack);
    if (micTrack) finalStream.addTrack(micTrack);
  }

  return finalStream;
}
