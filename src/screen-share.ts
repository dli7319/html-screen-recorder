export async function shareScreen(wantsSystemAudio: boolean, wantsMicAudio: boolean): Promise<MediaStream> {

    let micStream: MediaStream | undefined;
    const finalStream = new MediaStream();

    // 1. Get Display Stream (Video + System Audio if needed)
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as unknown as MediaTrackConstraints,

        audio: wantsSystemAudio,
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
            throw new Error("Could not access microphone. Continuing without it.");
        }
    }

    // 3. Combine Audio Tracks
    const systemAudioTrack = displayStream.getAudioTracks()[0];
    const micAudioTrack = micStream ? micStream.getAudioTracks()[0] : null;

    if (systemAudioTrack && micAudioTrack) {
        // ---- Both system and mic ----
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        const systemSource = audioContext.createMediaStreamSource(
            new MediaStream([systemAudioTrack])
        );
        systemSource.connect(destination);

        const micSource = audioContext.createMediaStreamSource(
            new MediaStream([micAudioTrack])
        );
        micSource.connect(destination);

        destination.stream.getAudioTracks().forEach((track) => {
            finalStream.addTrack(track);
        });
    } else if (systemAudioTrack) {
        finalStream.addTrack(systemAudioTrack);
    } else if (micAudioTrack) {
        finalStream.addTrack(micAudioTrack);
    }

    return finalStream;
}
