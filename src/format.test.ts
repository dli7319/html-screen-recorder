import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatExpiry,
  expiryTone,
  formatWhen,
} from './format';

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

describe('formatExpiry', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('reads a fresh take as the full window', () => {
    // Exactly 30 days out - the rounding choice that keeps a brand-new clip
    // reading the same number the retention note promises.
    expect(formatExpiry(30 * DAY)).toBe('Expires in 30 days');
  });

  it('counts days down in whole days', () => {
    expect(formatExpiry(29 * DAY)).toBe('Expires in 29 days');
    expect(formatExpiry(2 * DAY)).toBe('Expires in 2 days');
    expect(formatExpiry(DAY)).toBe('Expires in 1 day');
    // Singular day stays singular; plural days never do.
    expect(formatExpiry(DAY + 1)).toBe('Expires in 1 day');
  });

  it('switches to hours inside the last day', () => {
    expect(formatExpiry(23 * HOUR)).toBe('Expires in 23 hours');
    expect(formatExpiry(2 * HOUR)).toBe('Expires in 2 hours');
    expect(formatExpiry(HOUR)).toBe('Expires in 1 hour');
  });

  it('switches to minutes inside the last hour', () => {
    expect(formatExpiry(59 * MINUTE)).toBe('Expires in 59 minutes');
    expect(formatExpiry(2 * MINUTE)).toBe('Expires in 2 minutes');
    expect(formatExpiry(MINUTE)).toBe('Expires in 1 minute');
    // The bottom rung stays at one rather than printing "0 minutes".
    expect(formatExpiry(1)).toBe('Expires in 1 minute');
  });

  it('rounds rather than under-reports a take that is nearly fresh', () => {
    // A take made milliseconds ago has 30 days minus epsilon left; flooring
    // would brand-new clips "Expires in 29 days" beside the 30-day note.
    expect(formatExpiry(30 * DAY - 1)).toBe('Expires in 30 days');
  });

  it('says Expired rather than pretending time is left', () => {
    expect(formatExpiry(0)).toBe('Expired');
    expect(formatExpiry(-1)).toBe('Expired');
    expect(formatExpiry(NaN)).toBe('Expired');
    expect(formatExpiry(-30 * DAY)).toBe('Expired');
  });
});

describe('expiryTone', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('stays calm with a day or more left', () => {
    expect(expiryTone(30 * DAY)).toBe('');
    expect(expiryTone(DAY)).toBe('');
  });

  it('nudges amber inside a day', () => {
    expect(expiryTone(DAY - 1)).toBe('is-soon');
    expect(expiryTone(2 * HOUR)).toBe('is-soon');
  });

  it('turns red under an hour and once expired', () => {
    expect(expiryTone(HOUR)).toBe('is-urgent');
    expect(expiryTone(30 * MINUTE)).toBe('is-urgent');
    expect(expiryTone(0)).toBe('is-urgent');
    expect(expiryTone(-DAY)).toBe('is-urgent');
  });
});

describe('formatWhen', () => {
  // Both stamps are built in local time, so the day words depend only on the
  // pair - the assertions hold in any timezone.
  const at = (m: number, d: number, h: number, min: number, y = 2026) =>
    new Date(y, m - 1, d, h, min).getTime();

  it('reads a take from today with the clock time', () => {
    expect(formatWhen(at(11, 17, 14, 32), at(11, 17, 23, 59))).toBe(
      'Today, 14:32'
    );
    // An hour ago is still today: the words are calendar days, not hours.
    expect(formatWhen(at(11, 17, 9, 5), at(11, 17, 10, 5))).toBe(
      'Today, 09:05'
    );
  });

  it('reads a take from the day before as yesterday', () => {
    expect(formatWhen(at(11, 16, 23, 30), at(11, 17, 23, 0))).toBe(
      'Yesterday, 23:30'
    );
  });

  it('crosses month and year boundaries for yesterday', () => {
    expect(formatWhen(at(11, 1, 0, 5), at(11, 2, 8, 0))).toBe(
      'Yesterday, 00:05'
    );
    expect(formatWhen(at(12, 31, 23, 59, 2025), at(1, 1, 0, 30))).toBe(
      'Yesterday, 23:59'
    );
  });

  it('dates older takes inside the current year', () => {
    expect(formatWhen(at(3, 3, 9, 7), at(11, 17, 12, 0))).toBe('Mar 3, 09:07');
  });

  it('adds the year once the take is from another year', () => {
    expect(formatWhen(at(11, 5, 14, 32, 2025), at(11, 17, 12, 0, 2026))).toBe(
      'Nov 5, 2025, 14:32'
    );
  });

  it('dates a future timestamp rather than claiming it is today', () => {
    // Clock skew after a capture on another machine: say what the stamp says.
    expect(formatWhen(at(11, 18, 8, 0), at(11, 17, 23, 59))).toBe(
      'Nov 18, 08:00'
    );
  });

  it('tolerates non-finite input without printing NaN', () => {
    expect(formatWhen(NaN, at(11, 17, 12, 0))).toBe('');
  });
});
