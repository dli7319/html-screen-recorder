import { afterEach, describe, expect, it } from 'vitest';
import { installUnloadGuard } from './unload-guard';

function fireUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event as BeforeUnloadEvent;
}

describe('installUnloadGuard', () => {
  // Listeners pile up on the shared window across cases; the teardown keeps a
  // previous case's guard from firing (and asserting) here.
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('blocks unload while a capture is in flight', () => {
    teardown = installUnloadGuard(() => true);
    const event = fireUnload();
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets the page unload freely when idle', () => {
    teardown = installUnloadGuard(() => false);
    const event = fireUnload();
    expect(event.defaultPrevented).toBe(false);
  });

  it('re-evaluates the predicate on every unload', () => {
    let capturing = false;
    teardown = installUnloadGuard(() => capturing);
    expect(fireUnload().defaultPrevented).toBe(false);
    capturing = true;
    expect(fireUnload().defaultPrevented).toBe(true);
    capturing = false;
    expect(fireUnload().defaultPrevented).toBe(false);
  });
});
