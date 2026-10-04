import { describe, expect, it } from 'vitest';
import {
  BITRATE_PRESETS,
  DEFAULT_QUALITY,
  FRAME_RATE_PRESETS,
  RESOLUTION_PRESETS,
  buildRecorderOptions,
  buildVideoConstraints,
  describeQuality,
  resolvePreset,
} from './quality';

describe('buildVideoConstraints', () => {
  it('still keeps the cursor visible with no quality settings', () => {
    expect(buildVideoConstraints({})).toEqual({ cursor: 'always' });
  });

  it('asks for the target width as an ideal, not a hard requirement', () => {
    // A hard constraint would fail outright on a source that cannot supply it;
    // `ideal` lets the browser scale or fall back.
    const constraints = buildVideoConstraints({ width: 1280 });
    expect(constraints.width).toEqual({ ideal: 1280 });
    expect(constraints.width).not.toHaveProperty('exact');
  });

  it('never asks for a height, so the source keeps its aspect ratio', () => {
    // Requesting both dimensions would distort or crop the picture. This is the
    // whole reason the preset is a width rather than a WxH pair.
    const constraints = buildVideoConstraints({ width: 1920, frameRate: 30 });
    expect(constraints).not.toHaveProperty('height');
  });

  it('omits frame rate when it is not set', () => {
    expect(buildVideoConstraints({})).not.toHaveProperty('frameRate');
    expect(buildVideoConstraints({ frameRate: 60 }).frameRate).toEqual({
      ideal: 60,
    });
  });

  it('always keeps the cursor constraint even with everything set', () => {
    // `cursor` is a Chrome extension not present on the standard types, which
    // is why buildVideoConstraints casts; the browser does receive it.
    const constraints = buildVideoConstraints({
      width: 854,
      frameRate: 24,
    }) as {
      cursor?: string;
    };
    expect(constraints.cursor).toBe('always');
    expect(Object.keys(constraints).sort()).toEqual([
      'cursor',
      'frameRate',
      'width',
    ]);
  });
});

describe('buildRecorderOptions', () => {
  const format = {
    name: 'VP9',
    mimeType: 'video/webm; codecs=vp9',
    ext: 'webm',
  };

  it('always carries the mimeType', () => {
    expect(buildRecorderOptions(format, {}).mimeType).toBe(format.mimeType);
  });

  it('leaves the bitrate entirely absent when unset', () => {
    // Present-but-undefined would override the browser's per-codec default
    // with NaN rather than deferring to it.
    const options = buildRecorderOptions(format, {});
    expect(options).not.toHaveProperty('videoBitsPerSecond');
    expect(options).not.toHaveProperty('audioBitsPerSecond');
  });

  it('passes an explicit bitrate through', () => {
    const options = buildRecorderOptions(format, {
      videoBitsPerSecond: 6_000_000,
    });
    expect(options.videoBitsPerSecond).toBe(6_000_000);
  });

  it('passes an audio bitrate independently of the video one', () => {
    const options = buildRecorderOptions(format, {
      audioBitsPerSecond: 128_000,
    });
    expect(options.audioBitsPerSecond).toBe(128_000);
    expect(options).not.toHaveProperty('videoBitsPerSecond');
  });

  it('treats zero as unset rather than encoding at zero bits', () => {
    expect(
      buildRecorderOptions(format, { videoBitsPerSecond: 0 })
    ).not.toHaveProperty('videoBitsPerSecond');
  });
});

describe('presets', () => {
  it('leads every table with an Auto entry that sets nothing', () => {
    expect(RESOLUTION_PRESETS[0].width).toBeUndefined();
    expect(FRAME_RATE_PRESETS[0].frameRate).toBeUndefined();
    expect(BITRATE_PRESETS[0].videoBitsPerSecond).toBeUndefined();
  });

  it('has unique ids within each table', () => {
    for (const table of [
      RESOLUTION_PRESETS,
      FRAME_RATE_PRESETS,
      BITRATE_PRESETS,
    ]) {
      const ids = table.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('labels every preset', () => {
    for (const table of [
      RESOLUTION_PRESETS,
      FRAME_RATE_PRESETS,
      BITRATE_PRESETS,
    ]) {
      for (const preset of table)
        expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('offers descending resolutions', () => {
    const widths = RESOLUTION_PRESETS.map((p) => p.width).filter(
      (w): w is number => w !== undefined
    );
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });

  it('resolves a known id to its preset', () => {
    expect(resolvePreset(RESOLUTION_PRESETS, '720p').width).toBe(1280);
    expect(resolvePreset(FRAME_RATE_PRESETS, '30').frameRate).toBe(30);
  });

  it('falls back to Auto for an unknown id', () => {
    // A stale persisted id must degrade to "let the browser pick", never crash.
    expect(resolvePreset(RESOLUTION_PRESETS, 'nope').width).toBeUndefined();
    expect(
      resolvePreset(BITRATE_PRESETS, 'nope').videoBitsPerSecond
    ).toBeUndefined();
  });

  it('defaults everything to Auto', () => {
    expect(DEFAULT_QUALITY).toEqual({
      width: undefined,
      frameRate: undefined,
      videoBitsPerSecond: undefined,
    });
  });
});

describe('describeQuality', () => {
  it('names the Auto behaviour explicitly rather than showing blanks', () => {
    // Two words, not three. The chip this feeds shares a single line with the
    // transport, so the default case has to be short enough to fit and has to
    // read as the setting rather than describing each preset.
    expect(describeQuality({}, {})).toBe('Source · Auto');
  });

  it('reports each setting once set', () => {
    expect(
      describeQuality(
        { width: 1280, frameRate: 30 },
        { videoBitsPerSecond: 6_000_000 }
      )
    ).toBe('1280w 30fps · 6.0 Mbps');
  });

  it('mixes set and unset settings', () => {
    expect(describeQuality({ width: 854 }, {})).toBe('854w · Auto');
    expect(
      describeQuality({ frameRate: 60 }, { videoBitsPerSecond: 2_500_000 })
    ).toBe('60fps · 2.5 Mbps');
  });
});
