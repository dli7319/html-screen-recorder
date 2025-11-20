import { RecordingFormat } from './types';

export const FORMATS_TO_CHECK: RecordingFormat[] = [
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
