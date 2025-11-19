// Define CropTarget interface as it might not be in standard lib yet
export interface CropTarget {
    fromElement(element: Element): Promise<CropTarget>;
}
declare global {
    const CropTarget: {
        fromElement(element: Element): Promise<CropTarget>;
    };
}


// Extend MediaStreamTrack to include cropTo
export interface CropMediaStreamTrack extends MediaStreamTrack {
    cropTo(target: CropTarget | null): Promise<void>;
}

export interface RecordingFormat {
    name: string;
    mimeType: string;
    ext: string;
}
