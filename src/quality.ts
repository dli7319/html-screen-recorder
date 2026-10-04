import { RecordingFormat } from './types';

/**
 * Capture-time settings.
 *
 * These live in the *track*, so they can only take effect when
 * `getDisplayMedia` runs. Changing one after sharing has started would silently
 * do nothing, which is why they are kept apart from the encoder settings below.
 *
 * Height is deliberately absent: screen capture gets the source's own aspect
 * ratio, and asking for both a width and a height would either distort the
 * picture or crop it. A width alone lets the browser scale the whole surface.
 */
export interface CaptureConstraints {
  /** Target width in px. Omitted means the source's own resolution. */
  width?: number;
  /** Target frame rate. Omitted means the source's own rate. */
  frameRate?: number;
}

/**
 * Encoder-time settings.
 *
 * These live in the *recorder*, so unlike the capture constraints they can be
 * changed between takes without asking the user to pick a window again.
 *
 * Both are omitted when unset rather than given a value: `MediaRecorder` has
 * its own defaults per codec, and forcing a number would quietly override them.
 */
export interface EncoderConfig {
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

export interface Preset {
  id: string;
  label: string;
}

/** A resolution preset is a target width; the height follows the source. */
export interface ResolutionPreset extends Preset {
  width?: number;
}

export interface FrameRatePreset extends Preset {
  frameRate?: number;
}

export interface BitratePreset extends Preset {
  videoBitsPerSecond?: number;
}

/**
 * `Auto` entries map to "set nothing" so the browser picks. That is the right
 * default for screen capture: the ideal settings depend on the content, the
 * codec and the machine, and a hardcoded number will be wrong more often than
 * the browser is.
 */
export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'source', label: 'Source', width: undefined },
  { id: '1080p', label: '1080p (1920 wide)', width: 1920 },
  { id: '720p', label: '720p (1280 wide)', width: 1280 },
  { id: '480p', label: '480p (854 wide)', width: 854 },
];

export const FRAME_RATE_PRESETS: FrameRatePreset[] = [
  { id: 'source', label: 'Source', frameRate: undefined },
  { id: '60', label: '60 fps', frameRate: 60 },
  { id: '30', label: '30 fps', frameRate: 30 },
  { id: '24', label: '24 fps', frameRate: 24 },
];

export const BITRATE_PRESETS: BitratePreset[] = [
  { id: 'auto', label: 'Auto', videoBitsPerSecond: undefined },
  { id: 'high', label: 'High (~12 Mbps)', videoBitsPerSecond: 12_000_000 },
  { id: 'medium', label: 'Medium (~6 Mbps)', videoBitsPerSecond: 6_000_000 },
  { id: 'low', label: 'Low (~2.5 Mbps)', videoBitsPerSecond: 2_500_000 },
];

export const DEFAULT_QUALITY: CaptureConstraints & EncoderConfig = {
  width: undefined,
  frameRate: undefined,
  videoBitsPerSecond: undefined,
};

/** Look up a preset's value by id, falling back to the first (`Auto`) entry. */
export function resolvePreset<T extends Preset>(presets: T[], id: string): T {
  return presets.find((p) => p.id === id) ?? presets[0];
}

/**
 * Build the `getDisplayMedia` video constraints.
 *
 * Pure so the exact object handed to the browser is pinned by tests. The
 * `cursor` option is a Chrome extension not yet in the standard types, hence
 * the cast - it is still part of the constraints the browser receives.
 */
export function buildVideoConstraints(
  capture: CaptureConstraints
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    cursor: 'always',
  } as unknown as MediaTrackConstraints;

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
export function buildRecorderOptions(
  format: RecordingFormat,
  encoder: EncoderConfig
): MediaRecorderOptions {
  const options: MediaRecorderOptions = { mimeType: format.mimeType };

  if (encoder.videoBitsPerSecond) {
    options.videoBitsPerSecond = encoder.videoBitsPerSecond;
  }
  if (encoder.audioBitsPerSecond) {
    options.audioBitsPerSecond = encoder.audioBitsPerSecond;
  }

  return options;
}

/** Human-readable summary of what will actually be asked for. */
export function describeQuality(
  capture: CaptureConstraints,
  encoder: EncoderConfig
): string {
  // Shown in the settings chip on the session bar, which shares one line with
  // the transport. The previous wording ("source res · source fps · auto
  // bitrate") described each preset instead of stating the setting, and was
  // too long to fit alongside the controls.
  const dims: string[] = [];
  if (capture.width) dims.push(`${capture.width}w`);
  if (capture.frameRate) dims.push(`${capture.frameRate}fps`);
  // "Source" covers both when neither is constrained, which is the default.
  const capturePart = dims.length ? dims.join(' ') : 'Source';

  const bitratePart = encoder.videoBitsPerSecond
    ? `${(encoder.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps`
    : 'Auto';

  return `${capturePart} · ${bitratePart}`;
}
