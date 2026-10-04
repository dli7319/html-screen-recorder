import { describe, expect, it } from 'vitest';
import { fixWebmDuration, patchWebmDuration } from './webm-duration';

/* ------------------------------------------------------------------ *
 * Minimal EBML writer, so the fixtures below are readable rather than
 * a wall of hex. Only the pieces MediaRecorder actually emits.
 * ------------------------------------------------------------------ */

function vint(value: number): number[] {
  for (let length = 1; length <= 8; length++) {
    const max = Math.pow(2, 7 * length) - 2;
    if (value <= max) {
      const out = Array.from({ length }, () => 0);
      let rest = value;
      for (let i = length - 1; i >= 0; i--) {
        out[i] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] |= 0x80 >> (length - 1);
      return out;
    }
  }
  throw new Error('too big');
}

function idBytes(id: number): number[] {
  const hex = id.toString(16);
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2)
    out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** element = ID + size + payload */
function el(id: number, payload: number[]): number[] {
  return [...idBytes(id), ...vint(payload.length), ...payload];
}

/** Segment using the "unknown size" streaming form MediaRecorder writes. */
function segmentUnknownSize(payload: number[]): number[] {
  return [
    ...idBytes(0x18538067),
    0x01,
    ...Array.from({ length: 7 }, () => 0xff),
    ...payload,
  ];
}

function float64(value: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value);
  return [...new Uint8Array(buf)];
}

function timestampScale(value = 1_000_000): number[] {
  return el(0x2ad7b1, [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/** A plausible MediaRecorder-shaped file: EBML, Segment > Info/Tracks/Cluster. */
function buildWebm({
  withDuration = false,
  scale = 1_000_000,
  clusterPayload = [0xde, 0xad, 0xbe, 0xef],
} = {}): Uint8Array {
  const ebmlHeader = el(0x1a45dfa3, el(0x4282, ascii('webm')));
  const infoPayload = [
    ...timestampScale(scale),
    ...el(0x4d80, ascii('Chrome')),
    ...(withDuration ? el(0x4489, float64(1234)) : []),
  ];
  const info = el(0x1549a966, infoPayload);
  const tracks = el(0x1654ae6b, el(0xae, [0x00]));
  const cluster = el(0x1f43b675, clusterPayload);
  return Uint8Array.from([
    ...ebmlHeader,
    ...segmentUnknownSize([...info, ...tracks, ...cluster]),
  ]);
}

/* ------------------------ a small reader for assertions ------------------------ */

/**
 * These deliberately mirror the production readers, including their refusal to
 * walk a field whose length marker is missing. Without that guard a malformed
 * buffer makes the walk stall on the same offset forever - which is exactly how
 * a mutant of patchWebmDuration once hung the whole suite instead of failing it.
 */
function readVintAt(
  buf: Uint8Array,
  pos: number
): { value: number | null; length: number } | null {
  const first = buf[pos];
  if (first === undefined) return null;
  let length = 0;
  for (let i = 0; i < 8; i++)
    if (first & (0x80 >> i)) {
      length = i + 1;
      break;
    }
  if (length === 0 || pos + length > buf.length) return null;

  const mask = 0xff >> length;
  let value = first & mask;
  let allOnes = value === mask;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value: allOnes ? null : value, length };
}

function readIdAt(
  buf: Uint8Array,
  pos: number
): { value: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined) return null;
  let length = 0;
  for (let i = 0; i < 8; i++)
    if (first & (0x80 >> i)) {
      length = i + 1;
      break;
    }
  if (length === 0 || pos + length > buf.length) return null;

  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i];
  return { value, length };
}

/** Independently re-walk the file and return the Duration element's value. */
function readDuration(buf: Uint8Array): number | null {
  let pos = 0;
  while (pos < buf.length) {
    const id = readIdAt(buf, pos);
    if (!id) return null;
    const size = readVintAt(buf, pos + id.length);
    if (!size) return null;
    const dataStart = pos + id.length + size.length;
    if (id.value === 0x18538067) {
      const end = size.value === null ? buf.length : dataStart + size.value;
      return readDurationInRange(buf, dataStart, end);
    }
    if (size.value === null) break;
    pos = dataStart + size.value;
  }
  return null;
}

function readDurationInRange(
  buf: Uint8Array,
  from: number,
  to: number
): number | null {
  let pos = from;
  while (pos < to) {
    const id = readIdAt(buf, pos);
    if (!id) return null;
    const size = readVintAt(buf, pos + id.length);
    if (!size) return null;
    const dataStart = pos + id.length + size.length;
    if (id.value === 0x1549a966) {
      let p = dataStart;
      const infoEnd = dataStart + (size.value ?? 0);
      while (p < infoEnd) {
        const sub = readIdAt(buf, p);
        if (!sub) return null;
        const subSize = readVintAt(buf, p + sub.length);
        if (!subSize) return null;
        const subData = p + sub.length + subSize.length;
        if (
          sub.value === 0x4489 &&
          (subSize.value === 4 || subSize.value === 8)
        ) {
          return new DataView(
            buf.buffer,
            buf.byteOffset + subData,
            subSize.value
          ).getFloat64(0);
        }
        p = subData + (subSize.value ?? 0);
      }
      return null;
    }
    if (size.value === null) break;
    pos = dataStart + size.value;
  }
  return null;
}

function tailBytes(buf: Uint8Array): number[] {
  // the Cluster element is the last thing in the fixture
  return Array.from(buf.slice(-4));
}

/* --------------------------------- the specs --------------------------------- */

describe('patchWebmDuration', () => {
  it('writes the duration into a file that has none', () => {
    const src = buildWebm();
    const out = patchWebmDuration(src, 42_000);

    expect(readDuration(out)).toBe(42_000);
  });

  it('preserves the recording data byte for byte', () => {
    const src = buildWebm({ clusterPayload: [1, 2, 3, 4, 5, 6, 7, 8] });
    const out = patchWebmDuration(src, 5_000);

    expect(tailBytes(out)).toEqual(tailBytes(src));
    // the payload after the header is still intact and in order
    expect(Array.from(out.slice(-8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('replaces a duration that was already present', () => {
    const src = buildWebm({ withDuration: true });
    expect(readDuration(src)).toBe(1234);

    const out = patchWebmDuration(src, 9_000);
    expect(readDuration(out)).toBe(9_000);
  });

  it('scales the value by TimestampScale when it is not the default', () => {
    // 1000ns ticks -> the value must be 1000x the millisecond count
    const src = buildWebm({ scale: 1000 });
    const out = patchWebmDuration(src, 2_000);

    expect(readDuration(out)).toBe(2_000_000);
  });

  it('still parses after the patch', () => {
    const out = patchWebmDuration(buildWebm(), 1_000);
    // every top-level element must still walk cleanly
    let pos = 0;
    let count = 0;
    while (pos < out.length) {
      const id = readIdAt(out, pos);
      if (!id) break;
      const size = readVintAt(out, pos + id.length);
      if (!size) break;
      pos = pos + id.length + size.length + (size.value ?? 0);
      count++;
      if (size.value === null) break;
    }
    expect(count).toBeGreaterThan(1);
  });

  it('adds exactly one Duration element', () => {
    const out = patchWebmDuration(buildWebm(), 3_000);
    const text = [...out];
    // count occurrences of the Duration ID 0x44 0x89
    let hits = 0;
    for (let i = 0; i < text.length - 1; i++) {
      if (text[i] === 0x44 && text[i + 1] === 0x89) hits++;
    }
    expect(hits).toBe(1);
  });

  it('ignores a non-positive or non-finite duration', () => {
    const src = buildWebm();
    expect(patchWebmDuration(src, 0)).toBe(src);
    expect(patchWebmDuration(src, -5)).toBe(src);
    expect(patchWebmDuration(src, NaN)).toBe(src);
    expect(patchWebmDuration(src, Infinity)).toBe(src);
  });

  it('returns input unchanged when the file is not EBML at all', () => {
    const junk = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(patchWebmDuration(junk, 1_000)).toBe(junk);
  });

  it('returns input unchanged when truncated mid-element', () => {
    const src = buildWebm().slice(0, 20);
    expect(patchWebmDuration(src, 1_000)).toBe(src);
  });

  it('round-trips a short recording to the right milliseconds', () => {
    for (const ms of [1, 250, 1_000, 59_999, 3_661_000]) {
      expect(readDuration(patchWebmDuration(buildWebm(), ms))).toBe(ms);
    }
  });
});

describe('fixWebmDuration', () => {
  it('patches a WebM blob', async () => {
    const src = buildWebm();
    const blob = new Blob([src.buffer as ArrayBuffer], { type: 'video/webm' });

    const out = await fixWebmDuration(blob, 7_000);
    expect(readDuration(new Uint8Array(await out.arrayBuffer()))).toBe(7_000);
    expect(out.type).toBe('video/webm');
  });

  it('leaves non-WebM blobs completely alone', async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3]).buffer as ArrayBuffer], {
      type: 'video/mp4',
    });
    const out = await fixWebmDuration(blob, 7_000);
    expect(out).toBe(blob);
  });

  it('leaves an empty blob alone', async () => {
    const blob = new Blob([], { type: 'video/webm' });
    expect(await fixWebmDuration(blob, 7_000)).toBe(blob);
  });

  it('returns the original blob when the bytes are unparseable', async () => {
    const blob = new Blob(
      [Uint8Array.from([9, 9, 9, 9]).buffer as ArrayBuffer],
      {
        type: 'video/webm',
      }
    );
    expect(await fixWebmDuration(blob, 7_000)).toBe(blob);
  });

  it('accepts a matroska type as well', async () => {
    const blob = new Blob([buildWebm().buffer as ArrayBuffer], {
      type: 'video/x-matroska',
    });
    const out = await fixWebmDuration(blob, 1_500);
    expect(readDuration(new Uint8Array(await out.arrayBuffer()))).toBe(1_500);
  });
});
