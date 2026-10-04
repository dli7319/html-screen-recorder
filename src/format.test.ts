import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('formatBytes', () => {
  it('reports zero for nothing written', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('keeps small values integral', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(842)).toBe('842 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps up to kilobytes and megabytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(12_845)).toBe('12.5 KB');
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
    expect(formatBytes(5_242_880)).toBe('5.0 MB');
  });

  it('reaches gigabytes for a very long take', () => {
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
    expect(formatBytes(2_684_354_560)).toBe('2.5 GB');
  });

  it('tolerates non-finite input without printing NaN', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });

  it('rounds rather than truncates', () => {
    // 1023.6 B should not read as 1023 B
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1100)).toBe('1.1 KB');
  });
});

describe('formatDuration', () => {
  it('reads the first minute as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(9_000)).toBe('00:09');
    expect(formatDuration(59_000)).toBe('00:59');
  });

  it('rolls over into minutes', () => {
    expect(formatDuration(60_000)).toBe('01:00');
    expect(formatDuration(65_000)).toBe('01:05');
  });

  it('adds an hours field past an hour rather than wrapping', () => {
    expect(formatDuration(3_599_000)).toBe('59:59');
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
    expect(formatDuration(7_325_000)).toBe('2:02:05');
  });

  it('zero-pads every field', () => {
    expect(formatDuration(360_000)).toBe('06:00');
    expect(formatDuration(3_606_000)).toBe('1:00:06');
    expect(formatDuration(3_660_000)).toBe('1:01:00');
  });

  it('floors fractional milliseconds', () => {
    expect(formatDuration(1_999)).toBe('00:01');
    expect(formatDuration(1_000)).toBe('00:01');
    expect(formatDuration(999)).toBe('00:00');
  });

  it('treats negative input as zero', () => {
    expect(formatDuration(-5_000)).toBe('00:00');
  });

  it('handles multi-hour recordings', () => {
    expect(formatDuration(36_000_000)).toBe('10:00:00');
    expect(formatDuration(86_400_000)).toBe('24:00:00');
  });
});
