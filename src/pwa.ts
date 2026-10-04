/**
 * Service-worker registration and update detection.
 *
 * The worker (sw.ts) can make an update *available*; this decides when a
 * running page picks it up. It deliberately never reloads on its own.
 *
 * A screen recorder keeps takes in memory as blob URLs, and a take that has
 * not been downloaded is gone the instant the page navigates. Auto-reloading
 * on `controllerchange` is standard PWA polish and would silently destroy
 * someone's recording. An update therefore produces a callback and the user
 * chooses when to take it.
 */

export type ApplyFn = () => void;

export type PwaOptions = {
  /**
   * Called once per waiting update, with an `apply` function. Nothing happens
   * until `apply` is called, and even then the page reloads only once the new
   * worker has actually taken control.
   */
  onUpdate?: (apply: ApplyFn) => void;
  /** Where the worker lives. Relative on purpose - see the manifest notes. */
  scriptUrl?: string;
  scope?: string;
  /** Re-check for a new worker when the window regains focus. */
  checkOnFocus?: boolean;
};

type WorkerLike = {
  state?: string;
  addEventListener(type: string, handler: () => void): void;
  postMessage(message: unknown): void;
};

type RegistrationLike = {
  installing: WorkerLike | null | undefined;
  waiting: WorkerLike | null | undefined;
  addEventListener(type: string, handler: () => void): void;
  update(): Promise<void>;
};

type ServiceWorkerContainerLike = {
  controller: unknown;
  register(url: string, options: object): Promise<RegistrationLike>;
  addEventListener(
    type: string,
    handler: () => void,
    options?: { once?: boolean }
  ): void;
};

/**
 * Activate a waiting worker and run `onceControlled` afterwards.
 *
 * The reload is bound to `controllerchange` rather than fired immediately:
 * `postMessage` is asynchronous, so reloading right away would race the
 * activation and could serve the old worker again.
 */
export function applyUpdate(
  container: ServiceWorkerContainerLike,
  worker: WorkerLike,
  onceControlled: () => void
): void {
  container.addEventListener('controllerchange', () => onceControlled(), {
    once: true,
  } as AddEventListenerOptions);
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Report a waiting worker to the app, if there is one.
 *
 * Returns true when an update was handed over, so callers can distinguish
 * "already up to date" from "update ready".
 */
export function armUpdate(
  container: ServiceWorkerContainerLike,
  worker: WorkerLike | null | undefined,
  onUpdate: ((apply: ApplyFn) => void) | undefined,
  onceControlled: () => void
): boolean {
  if (!worker) return false;
  onUpdate?.(() => applyUpdate(container, worker, onceControlled));
  return true;
}

/**
 * Watch a registration for updates arriving after load.
 *
 * A worker that installs while an older one is controlling the page lands in
 * `waiting`; that is the only moment an update is actionable. An installing
 * worker with no existing controller is the *first* install, which is not an
 * update and must not trigger a prompt.
 */
export function observeUpdates(
  container: ServiceWorkerContainerLike,
  registration: RegistrationLike,
  onUpdate: ((apply: ApplyFn) => void) | undefined,
  onceControlled: () => void,
  isControlled: boolean
): void {
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state !== 'installed') return;
      if (!isControlled) return;
      armUpdate(container, installing, onUpdate, onceControlled);
    });
  });
}

export async function registerServiceWorker(
  options: PwaOptions = {}
): Promise<void> {
  const {
    onUpdate,
    scriptUrl = './sw.js',
    scope = './',
    checkOnFocus = true,
  } = options;

  // No worker support, or an insecure origin: the app still runs, just
  // without offline. Doing nothing quietly beats throwing.
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;
  if (typeof window !== 'undefined' && !window.isSecureContext) return;

  const container =
    navigator.serviceWorker as unknown as ServiceWorkerContainerLike;
  const onceControlled = () => window.location.reload();

  try {
    const registration = await container.register(scriptUrl, {
      scope,
      // Fetch sw.js from the network rather than the HTTP cache, so a deploy
      // is noticed even behind a long-lived cache header.
      updateViaCache: 'none',
    });

    const controlled = Boolean(container.controller);

    // An update may already be parked in `waiting` from a previous visit.
    armUpdate(container, registration.waiting, onUpdate, onceControlled);
    observeUpdates(
      container,
      registration,
      onUpdate,
      onceControlled,
      controlled
    );

    // An installed PWA window can stay open across a long recording session
    // and would otherwise never learn about a deploy. Re-check when it comes
    // back to the foreground.
    if (checkOnFocus && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void registration.update().catch(() => {});
        }
      });
    }
  } catch {
    // A registration failure must not break the app; it works fine without.
  }
}
