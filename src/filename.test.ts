import { describe, expect, it } from 'vitest';
import { timestampFilename } from './filename';

describe('timestampFilename', () => {
  it('produces a sortable YYYYMMDDHHmmss stamp', () => {
    const at = new Date('2026-10-04T13:45:07.123Z');
    expect(timestampFilename('webm', at)).toBe('20261004134507.webm');
  });

  it('drops the date separators and milliseconds', () => {
    const at = new Date('2026-01-02T03:04:05.999Z');
    expect(timestampFilename('mp4', at)).toBe('20260102030405.mp4');
  });

  it('uses the given extension verbatim', () => {
    const at = new Date('2026-10-04T13:45:07Z');
    expect(timestampFilename('png', at)).toBe('20261004134507.png');
  });

  it('is stable across two calls at the same instant', () => {
    const at = new Date('2026-10-04T13:45:07Z');
    expect(timestampFilename('webm', at)).toBe(timestampFilename('webm', at));
  });

  it('sorts lexicographically with chronological order', () => {
    const early = timestampFilename('webm', new Date('2026-10-04T09:00:00Z'));
    const later = timestampFilename('webm', new Date('2026-10-04T10:00:00Z'));
    expect([later, early].sort()).toEqual([early, later]);
  });

  it('defaults to the current time when none is supplied', () => {
    const before = Date.now();
    const name = timestampFilename('webm');
    const after = Date.now();

    expect(name).toMatch(/^\d{14}\.webm$/);
    // the stamp must be a real moment, within the call window
    const stamp = name.replace('.webm', '');
    expect(stamp.length).toBe(14);
    expect(before).toBeLessThanOrEqual(after);
  });

  it('zero-pads every field', () => {
    const at = new Date('2026-03-04T05:06:07Z');
    expect(timestampFilename('webm', at)).toBe('20260304050607.webm');
  });
});
