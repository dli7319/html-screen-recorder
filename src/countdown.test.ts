import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCountdown } from './countdown';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runCountdown', () => {
  it('counts down to one, then reports done', () => {
    const ticks: number[] = [];
    const onDone = vi.fn();

    runCountdown({ seconds: 3, onTick: (n) => ticks.push(n), onDone });

    expect(ticks).toEqual([3]);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2]);

    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2, 1]);
    expect(onDone).not.toHaveBeenCalled();

    // "1" is the last number shown; done fires on the following beat.
    vi.advanceTimersByTime(1000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('never repeats the count after finishing', () => {
    const ticks: number[] = [];
    runCountdown({ seconds: 2, onTick: (n) => ticks.push(n), onDone: vi.fn() });

    vi.advanceTimersByTime(10_000);
    expect(ticks).toEqual([2, 1]);
  });

  it('starts immediately rather than one second late', () => {
    // Waiting a beat before showing "3" would feel broken.
    const onTick = vi.fn();
    runCountdown({ seconds: 5, onTick, onDone: vi.fn() });

    expect(onTick).toHaveBeenCalledWith(5);
  });

  it('counts a one second countdown as a single tick', () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    runCountdown({ seconds: 1, onTick: (n) => ticks.push(n), onDone });

    expect(ticks).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('runCountdown with no countdown', () => {
  it('reports done at once for zero seconds', () => {
    const onTick = vi.fn();
    const onDone = vi.fn();
    runCountdown({ seconds: 0, onTick, onDone });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('treats a negative count as off rather than looping forever', () => {
    const onDone = vi.fn();
    runCountdown({ seconds: -5, onDone });

    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('tolerates an absent onTick', () => {
    const onDone = vi.fn();
    expect(() => runCountdown({ seconds: 2, onDone })).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('runCountdown cancellation', () => {
  it('stops counting and reports the cancellation', () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    const onCancel = vi.fn();
    const handle = runCountdown({
      seconds: 5,
      onTick: (n) => ticks.push(n),
      onDone,
      onCancel,
    });

    handle.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(ticks).toEqual([5]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('never reports both done and cancelled', () => {
    // A stray cancel must not fire onCancel after onDone - the caller would
    // tear down a capture that already started.
    const onDone = vi.fn();
    const onCancel = vi.fn();
    const handle = runCountdown({ seconds: 1, onDone, onCancel });

    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledTimes(1);

    handle.cancel();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const onCancel = vi.fn();
    const handle = runCountdown({ seconds: 5, onDone: vi.fn(), onCancel });

    handle.cancel();
    handle.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is safe to cancel a countdown that was never really started', () => {
    const onCancel = vi.fn();
    const handle = runCountdown({ seconds: 0, onDone: vi.fn(), onCancel });

    expect(() => handle.cancel()).not.toThrow();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('runCountdown.isActive', () => {
  it('is true while counting and false once done', () => {
    const handle = runCountdown({ seconds: 2, onDone: vi.fn() });
    expect(handle.isActive()).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(handle.isActive()).toBe(false);
  });

  it('goes false as soon as it is cancelled', () => {
    const handle = runCountdown({ seconds: 5, onDone: vi.fn() });
    handle.cancel();

    expect(handle.isActive()).toBe(false);
  });

  it('is false immediately when there is no countdown', () => {
    const handle = runCountdown({ seconds: 0, onDone: vi.fn() });
    expect(handle.isActive()).toBe(false);
  });
});
