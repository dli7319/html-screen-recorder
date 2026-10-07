import { describe, expect, it } from 'vitest';
import { fitWithin, pickSeekTime, THUMBNAIL_MAX_EDGE } from './thumbnail';

describe('pickSeekTime', () => {
  const SECOND = 1000;

  it('takes the first second of a normal clip', () => {
    // Past a possible black opening frame, still at the start of the action.
    expect(pickSeekTime(30 * SECOND)).toBe(1000);
    expect(pickSeekTime(60 * SECOND)).toBe(1000);
  });

  it('goes to the midpoint of a clip too short for a second', () => {
    expect(pickSeekTime(2 * SECOND)).toBe(1000);
    expect(pickSeekTime(500)).toBe(250);
    expect(pickSeekTime(100)).toBe(50);
    expect(pickSeekTime(0)).toBe(0);
    expect(pickSeekTime(-5)).toBe(0);
    expect(pickSeekTime(NaN)).toBe(0);
    expect(pickSeekTime(Infinity)).toBe(0);
  });
});

describe('fitWithin', () => {
  it('shrinks to the max edge keeping the aspect ratio', () => {
    expect(fitWithin(1920, 1080)).toEqual({ width: 320, height: 180 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 180, height: 320 });
    expect(fitWithin(640, 360)).toEqual({ width: 320, height: 180 });
  });

  it('never upscales a source that already fits', () => {
    expect(fitWithin(100, 80)).toEqual({ width: 100, height: 80 });
    expect(fitWithin(40, 40)).toEqual({ width: 40, height: 40 });
  });

  it('accepts a tighter max', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });

  it('survives degenerate input without producing NaN pixels', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, Infinity)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-10, -10)).toEqual({ width: 0, height: 0 });
  });

  it('clamps to at least one pixel once scaled', () => {
    // A 2000x1 sliver scaled to 320 would round its height to 0.
    const { height } = fitWithin(2000, 1);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('uses the documented default max edge', () => {
    expect(fitWithin(4000, 2000)).toEqual({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE / 2,
    });
  });
});
