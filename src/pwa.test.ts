import { describe, expect, it, vi } from 'vitest';
import {
  applyUpdate,
  armUpdate,
  observeUpdates,
  registerServiceWorker,
  type ApplyFn,
} from './pwa';

type Handler = () => void;

function fakeWorker(state = 'installed') {
  const listeners = new Map<string, Handler[]>();
  return {
    state,
    postMessage: vi.fn(),
    addEventListener(type: string, handler: Handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    emit(type: string) {
      for (const h of listeners.get(type) ?? []) h();
    },
    listeners,
  };
}

function fakeContainer({ controlled = true } = {}) {
  const listeners = new Map<string, Handler[]>();
  return {
    controller: controlled ? {} : null,
    register: vi.fn(),
    addEventListener(
      type: string,
      handler: Handler,
      options?: { once?: boolean }
    ) {
      // Honour `once` the way the real EventTarget does - applyUpdate relies
      // on it to guarantee a single reload, and a fake that ignores it would
      // make that guarantee untestable.
      const wrapped: Handler = () => {
        if (options?.once) {
          const current = listeners.get(type) ?? [];
          listeners.set(
            type,
            current.filter((h) => h !== wrapped)
          );
        }
        handler();
      };
      listeners.set(type, [...(listeners.get(type) ?? []), wrapped]);
    },
    emit(type: string) {
      // No defensive copy needed: `once` handlers replace the map entry with a
      // filtered array rather than mutating the one being iterated.
      for (const h of listeners.get(type) ?? []) h();
    },
  };
}

describe('applyUpdate', () => {
  it('asks the worker to take over but does not reload by itself', () => {
    const container = fakeContainer();
    const worker = fakeWorker();
    const reload = vi.fn();

    applyUpdate(container as never, worker as never, reload);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    // This is the whole design: a reload here would destroy an in-flight
    // recording and any take not yet downloaded.
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads only once the new worker has taken control', () => {
    const container = fakeContainer();
    const worker = fakeWorker();
    const reload = vi.fn();

    applyUpdate(container as never, worker as never, reload);
    expect(reload).not.toHaveBeenCalled();

    container.emit('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload more than once if control changes twice', () => {
    const container = fakeContainer();
    const worker = fakeWorker();
    const reload = vi.fn();

    applyUpdate(container as never, worker as never, reload);
    container.emit('controllerchange');
    container.emit('controllerchange');

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('armUpdate', () => {
  it('reports an update and hands over an apply function', () => {
    const container = fakeContainer();
    const worker = fakeWorker();
    const updates: ApplyFn[] = [];

    const found = armUpdate(
      container as never,
      worker as never,
      (apply) => updates.push(apply),
      vi.fn()
    );

    expect(found).toBe(true);
    expect(updates).toHaveLength(1);
    // Applying is deferred to the caller - nothing has happened yet.
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no waiting worker', () => {
    const onUpdate = vi.fn();
    expect(armUpdate(fakeContainer() as never, null, onUpdate, vi.fn())).toBe(
      false
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('observeUpdates', () => {
  function registrationWith() {
    const installing = fakeWorker('installing');
    return {
      installing,
      waiting: null,
      registration: {
        get installing() {
          return installing;
        },
        waiting: null,
        addEventListener(type: string, handler: Handler) {
          installing.addEventListener('__reg__' + type, handler);
        },
        update: vi.fn().mockResolvedValue(undefined),
      },
      fireUpdateFound: () => installing.emit('__reg__updatefound'),
    };
  }

  it('ignores the very first install - there is nothing to update to', () => {
    const { installing, registration, fireUpdateFound } = registrationWith();
    const onUpdate = vi.fn();

    observeUpdates(
      fakeContainer() as never,
      registration as never,
      onUpdate,
      vi.fn(),
      () => false // not yet controlled at install time
    );
    fireUpdateFound();
    // Reached `installed` too, so this exercises the isControlled guard rather
    // than passing because the worker happened not to be ready yet.
    installing.state = 'installed';
    installing.emit('statechange');

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports an update when the page is already controlled', () => {
    const { installing, registration, fireUpdateFound } = registrationWith();
    const onUpdate = vi.fn();

    observeUpdates(
      fakeContainer() as never,
      registration as never,
      onUpdate,
      vi.fn(),
      () => true
    );
    fireUpdateFound();
    // The worker reaches `installed` and then announces it - order matters,
    // because the handler filters on state.
    installing.state = 'installed';
    installing.emit('statechange');

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('reads control state when the update lands, not when it registered', () => {
    // The bug: `isControlled` was sampled once at registration time. On a first
    // visit the worker has not claimed the page yet, so `controller` is null and
    // the captured false stayed false for the whole life of the tab. Later
    // updates were discarded and the user was never offered a refresh - the app
    // reported up to date while serving a stale build.
    const { installing, registration, fireUpdateFound } = registrationWith();
    const onUpdate = vi.fn();
    let controlled = false; // false at register time, true by the time it lands

    observeUpdates(
      fakeContainer() as never,
      registration as never,
      onUpdate,
      vi.fn(),
      () => controlled
    );

    fireUpdateFound();
    controlled = true; // the worker claims the page while it installs
    installing.state = 'installed';
    installing.emit('statechange');

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('ignores a worker that has not finished installing', () => {
    const { installing, registration, fireUpdateFound } = registrationWith();
    installing.state = 'installing';
    const onUpdate = vi.fn();

    observeUpdates(
      fakeContainer() as never,
      registration as never,
      onUpdate,
      vi.fn(),
      () => true
    );
    fireUpdateFound();
    installing.emit('statechange');

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('registerServiceWorker', () => {
  function stubNavigator(serviceWorker: object | undefined) {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: serviceWorker,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.window, 'isSecureContext', {
      value: true,
      configurable: true,
    });
  }

  it('registers with a relative path and bypasses the HTTP cache', async () => {
    const container = fakeContainer();
    container.register.mockResolvedValue({
      installing: null,
      waiting: null,
      addEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    });
    stubNavigator(container);

    await registerServiceWorker({ checkOnFocus: false });

    expect(container.register).toHaveBeenCalledWith('./sw.js', {
      scope: './',
      // Without this a deploy can hide behind a long-lived cache header.
      updateViaCache: 'none',
    });
  });

  it('does nothing at all when service workers are unsupported', async () => {
    stubNavigator(undefined);
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });

  it('survives a registration failure rather than breaking the app', async () => {
    const container = fakeContainer();
    container.register.mockRejectedValue(new Error('boom'));
    stubNavigator(container);

    await expect(
      registerServiceWorker({ checkOnFocus: false })
    ).resolves.toBeUndefined();
  });
});
