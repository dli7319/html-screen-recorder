import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stopwatch } from './stopwatch';

describe('Stopwatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a mm:ss reading once a second', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(3000);
    stopwatch.stop();

    expect(ticks).toEqual(['00:01', '00:02', '00:03']);
  });

  it('does not fire before a full second has elapsed', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(999);
    stopwatch.stop();

    expect(ticks).toEqual([]);
  });

  it('rolls over into minutes', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(65_000);
    stopwatch.stop();

    expect(ticks.at(-1)).toBe('01:05');
  });

  it('zero-pads both fields', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(9_000);
    stopwatch.stop();

    expect(ticks.at(-1)).toBe('00:09');
  });

  it('keeps counting past an hour rather than wrapping', () => {
    // The button label is a recording duration, so 3661s must read 61:01,
    // not 01:01 - a wrap would silently mislabel long recordings.
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(3_661_000);
    stopwatch.stop();

    expect(ticks.at(-1)).toBe('61:01');
  });

  it('stops emitting once stopped', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(2000);
    stopwatch.stop();
    vi.advanceTimersByTime(5000);

    expect(ticks).toEqual(['00:01', '00:02']);
  });

  it('clears its interval so it cannot leak timers', () => {
    const stopwatch = new Stopwatch();
    stopwatch.start(() => {});
    stopwatch.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not count time spent paused', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(2000); // 2s captured
    stopwatch.pause();
    vi.advanceTimersByTime(60_000); // 60s paused - must not count
    stopwatch.resume();
    vi.advanceTimersByTime(1000); // 1s more

    stopwatch.stop();
    expect(ticks.at(-1)).toBe('00:03');
  });

  it('reports elapsed capture time excluding pauses', () => {
    const stopwatch = new Stopwatch();
    stopwatch.start(() => {});

    vi.advanceTimersByTime(4000);
    expect(stopwatch.elapsed()).toBe(4000);

    stopwatch.pause();
    vi.advanceTimersByTime(30_000);
    expect(stopwatch.elapsed()).toBe(4000); // frozen while paused

    stopwatch.resume();
    vi.advanceTimersByTime(1000);
    expect(stopwatch.elapsed()).toBe(5000);
    stopwatch.stop();
  });

  it('exposes its paused state', () => {
    const stopwatch = new Stopwatch();
    expect(stopwatch.isPaused()).toBe(false);

    stopwatch.start(() => {});
    stopwatch.pause();
    expect(stopwatch.isPaused()).toBe(true);

    stopwatch.resume();
    expect(stopwatch.isPaused()).toBe(false);
    stopwatch.stop();
  });

  it('ignores pause and resume when not running', () => {
    const stopwatch = new Stopwatch();
    expect(() => {
      stopwatch.pause();
      stopwatch.resume();
    }).not.toThrow();
    expect(stopwatch.elapsed()).toBe(0);
  });

  it('ignores a repeated pause', () => {
    const ticks: string[] = [];
    const stopwatch = new Stopwatch();
    stopwatch.start((time) => ticks.push(time));

    vi.advanceTimersByTime(1000);
    stopwatch.pause();
    vi.advanceTimersByTime(5000);
    stopwatch.pause(); // no-op, must not extend the pause window
    vi.advanceTimersByTime(5000);
    stopwatch.resume();

    expect(stopwatch.elapsed()).toBe(1000);
    stopwatch.stop();
  });

  it('is safe to stop before it was ever started', () => {
    const stopwatch = new Stopwatch();
    expect(() => stopwatch.stop()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
