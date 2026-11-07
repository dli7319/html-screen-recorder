import { describe, expect, it, vi } from 'vitest';
import {
  WakeLockKeeper,
  type WakeLockManagerLike,
  type WakeLockSentinelLike,
} from './wake-lock';

/**
 * jsdom has no Wake Lock API. The behaviour worth pinning is the state
 * machine around the platform's quirks: the lock is reclaimed whenever the
 * document hides, request() can fail outright, and a request in flight when
 * the take ends must not leave a lock running behind the user's back.
 */
function fakeSentinel() {
  const listeners: (() => void)[] = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
    addEventListener: (type: 'release', listener: () => void) => {
      if (type === 'release') listeners.push(listener);
    },
    /** Simulate the platform reclaiming the lock (e.g. tab hidden). */
    fireRelease() {
      sentinel.released = true;
      for (const listener of listeners) listener();
    },
  };
  return sentinel;
}

function fakeManager() {
  const sentinels: ReturnType<typeof fakeSentinel>[] = [];
  const request = vi.fn(async () => {
    const sentinel = fakeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  return {
    manager: { request } satisfies WakeLockManagerLike as WakeLockManagerLike,
    request,
    sentinels,
  };
}

describe('WakeLockKeeper', () => {
  it('acquires a screen lock and reports it held', async () => {
    const { manager, request } = fakeManager();
    const keeper = new WakeLockKeeper(manager);

    await keeper.acquire();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    expect(keeper.isHeld()).toBe(true);
  });

  it('asks only once while a lock is already held', async () => {
    const { manager, request } = fakeManager();
    const keeper = new WakeLockKeeper(manager);

    await keeper.acquire();
    await keeper.acquire();

    expect(request).toHaveBeenCalledTimes(1);
    expect(keeper.isHeld()).toBe(true);
  });

  it('releases the sentinel on release and stops reporting it held', async () => {
    const { manager, sentinels } = fakeManager();
    const keeper = new WakeLockKeeper(manager);
    await keeper.acquire();

    await keeper.release();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(keeper.isHeld()).toBe(false);
  });

  it('release is safe with nothing held, and repeated', async () => {
    const { manager, sentinels } = fakeManager();
    const keeper = new WakeLockKeeper(manager);

    await keeper.release();
    await keeper.acquire();
    await keeper.release();
    await keeper.release();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(keeper.isHeld()).toBe(false);
  });

  it('lets the platform reclaim the lock without breaking state', async () => {
    const { manager, sentinels, request } = fakeManager();
    const keeper = new WakeLockKeeper(manager);
    await keeper.acquire();

    // The document hid: the platform takes its lock back and says so.
    sentinels[0].fireRelease();
    expect(keeper.isHeld()).toBe(false);

    // Coming back to a take still recording re-asks for a fresh lock.
    await keeper.refresh();
    expect(request).toHaveBeenCalledTimes(2);
    expect(keeper.isHeld()).toBe(true);
  });

  it('re-asks when the sentinel reports released even without the event', async () => {
    const { manager, sentinels, request } = fakeManager();
    const keeper = new WakeLockKeeper(manager);
    await keeper.acquire();

    sentinels[0].released = true;

    await keeper.refresh();
    expect(request).toHaveBeenCalledTimes(2);
    expect(keeper.isHeld()).toBe(true);
  });

  it('does not re-ask after release', async () => {
    const { manager, request } = fakeManager();
    const keeper = new WakeLockKeeper(manager);
    await keeper.acquire();
    await keeper.release();

    await keeper.refresh();

    expect(request).toHaveBeenCalledTimes(1);
    expect(keeper.isHeld()).toBe(false);
  });

  it('is a quiet no-op where the API is missing', async () => {
    const keeper = new WakeLockKeeper(undefined);

    await expect(keeper.acquire()).resolves.toBeUndefined();
    expect(keeper.isHeld()).toBe(false);
  });

  it('swallows a denied request and can retry later', async () => {
    const request = vi
      .fn<() => Promise<WakeLockSentinelLike>>()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValue(fakeSentinel());
    const keeper = new WakeLockKeeper({ request });

    await expect(keeper.acquire()).resolves.toBeUndefined();
    expect(keeper.isHeld()).toBe(false);

    await keeper.acquire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(keeper.isHeld()).toBe(true);
  });

  it('gives back a lock that lands after the take already ended', async () => {
    // The request is slow enough to outlive the recording it was asked for.
    const sentinel = fakeSentinel();
    let resolveRequest: (s: WakeLockSentinelLike) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<WakeLockSentinelLike>((resolve) => {
          resolveRequest = resolve;
        })
    );
    const keeper = new WakeLockKeeper({ request });

    const acquiring = keeper.acquire();
    await keeper.release(); // take stopped while request() was in flight
    resolveRequest(sentinel);
    await acquiring;

    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(keeper.isHeld()).toBe(false);
  });
});
