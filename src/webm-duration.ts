/**
 * MediaRecorder's WebM output omits the EBML `Duration` element, so players and
 * editors report the recording as `Infinity` (or refuse to seek). This writes the
 * real duration into the header once the capture is finished.
 *
 * The structure being patched is:
 *
 *   Segment (0x18538067)
 *     Info (0x1549A966)
 *       TimestampScale (0x2AD7B1)   <- usually 1000000 (1ms)
 *       MuxingApp / WritingApp
 *       Duration (0x4489)           <- usually MISSING, float in scale units
 *     Tracks / Cluster...
 *
 * Anything that does not match this shape is returned untouched: a recording
 * that still reports Infinity is a nuisance, but a mangled one is a lost take.
 */

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMESTAMP_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

const DEFAULT_TIMESTAMP_SCALE = 1_000_000; // nanoseconds -> 1ms ticks

interface Element {
  /** Offset of the element's ID. */
  start: number;
  /** Offset of the element's payload. */
  dataStart: number;
  /** Payload length, or null when the header uses the "unknown size" form. */
  size: number | null;
  /** Bytes used by the size field itself. */
  sizeLength: number;
}

/**
 * EBML variable-length integers carry their own length in the leading zero bits
 * of the first byte, with the marker bit forming part of the value.
 */
function readVint(
  buf: Uint8Array,
  pos: number
): { value: number | null; length: number } | null {
  const first = buf[pos];
  if (first === undefined) return null;

  let length = 0;
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) {
      length = i + 1;
      break;
    }
  }
  if (length === 0 || pos + length > buf.length) return null;

  // Clear the length-marker bits; the remainder is the value.
  const mask = 0xff >> length;
  let value = first & mask;
  let allOnes = value === mask;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }

  // All value bits set is the reserved "unknown size" encoding.
  return { value: allOnes ? null : value, length };
}

/** Element IDs use the same length-encoding but keep their marker bits. */
function readId(
  buf: Uint8Array,
  pos: number
): { value: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined) return null;

  let length = 0;
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) {
      length = i + 1;
      break;
    }
  }
  if (length === 0 || pos + length > buf.length) return null;

  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i];
  return { value, length };
}

/** Encode a size value in the fewest bytes that can hold it. */
function writeVint(value: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    // The all-ones encoding is reserved for "unknown", so cap below it.
    const max = Math.pow(2, 7 * length) - 2;
    if (value <= max) {
      const out = new Uint8Array(length);
      let rest = value;
      for (let i = length - 1; i >= 0; i--) {
        out[i] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] |= 0x80 >> (length - 1);
      return out;
    }
  }
  throw new Error('Value too large for an EBML size field');
}

function findElement(
  buf: Uint8Array,
  from: number,
  to: number,
  id: number
): Element | null {
  let pos = from;
  while (pos < to) {
    const elementId = readId(buf, pos);
    if (!elementId) return null;
    const size = readVint(buf, pos + elementId.length);
    if (!size) return null;

    const dataStart = pos + elementId.length + size.length;
    if (elementId.value === id) {
      return {
        start: pos,
        dataStart,
        size: size.value,
        sizeLength: size.length,
      };
    }
    if (size.value === null) return null; // unknown size: runs to the end
    pos = dataStart + size.value;
  }
  return null;
}

function readTimestampScale(info: Uint8Array): number {
  const scale = findElement(info, 0, info.length, ID_TIMESTAMP_SCALE);
  if (!scale || (scale.size !== 4 && scale.size !== 8)) {
    return DEFAULT_TIMESTAMP_SCALE;
  }
  let value = 0;
  for (let i = 0; i < scale.size; i++) {
    value = value * 256 + info[scale.dataStart + i];
  }
  return value > 0 ? value : DEFAULT_TIMESTAMP_SCALE;
}

/**
 * Return a copy of `bytes` with the recording's duration written into the EBML
 * header. Falls back to the input unchanged if the file does not look like the
 * layout MediaRecorder produces.
 */
export function patchWebmDuration(
  bytes: Uint8Array,
  durationMs: number
): Uint8Array {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return bytes;

  const segment = findElement(bytes, 0, bytes.length, ID_SEGMENT);
  if (!segment) return bytes;

  // MediaRecorder writes Segment with an unknown size so it can stream, so the
  // tail of the file is simply the remainder of the buffer.
  const segmentEnd =
    segment.size === null ? bytes.length : segment.dataStart + segment.size;

  const info = findElement(bytes, segment.dataStart, segmentEnd, ID_INFO);
  if (!info || info.size === null) return bytes;

  const infoEnd = info.dataStart + info.size;
  const infoPayload = bytes.subarray(info.dataStart, infoEnd);
  const timestampScale = readTimestampScale(infoPayload);

  // Duration is a float expressed in TimestampScale units.
  const durationValue = (durationMs * 1_000_000) / timestampScale;

  const existing = findElement(infoPayload, 0, infoPayload.length, ID_DURATION);

  let newPayload: Uint8Array;
  if (existing) {
    // Overwrite the value in place, keeping its declared width.
    const width = existing.size ?? 8;
    if (width !== 4 && width !== 8) return bytes;
    newPayload = new Uint8Array(infoPayload);
    writeFloat(newPayload, existing.dataStart, width, durationValue);
  } else {
    // Insert one right after the TimestampScale (or at the head of Info).
    const scale = findElement(
      infoPayload,
      0,
      infoPayload.length,
      ID_TIMESTAMP_SCALE
    );
    const insertAt = scale ? scale.dataStart + (scale.size ?? 0) : 0;
    const entry = buildDurationElement(durationValue);
    newPayload = new Uint8Array(infoPayload.length + entry.length);
    newPayload.set(infoPayload.subarray(0, insertAt), 0);
    newPayload.set(entry, insertAt);
    newPayload.set(infoPayload.subarray(insertAt), insertAt + entry.length);
  }

  const newInfoSize = writeVint(newPayload.length);
  // Rewriting Info's size field only stays safe if its width is unchanged;
  // otherwise every offset after it shifts and the file would be corrupt.
  if (newInfoSize.length !== info.sizeLength) return bytes;

  // out = [bytes before the Info ID] + [Info ID] + [new size] + [new payload]
  //       + [everything after Info]
  const outLength = bytes.length - info.size + newPayload.length;
  const out = new Uint8Array(outLength);

  // The Info ID and the old size field sit immediately before info.dataStart,
  // and the prefix written above already covers them.
  out.set(bytes.subarray(0, info.dataStart), 0); // prefix + Info ID + old size
  out.set(newInfoSize, info.dataStart - info.sizeLength);
  out.set(newPayload, info.dataStart);
  out.set(bytes.subarray(infoEnd), info.dataStart + newPayload.length);

  return out;
}

function buildDurationElement(value: number): Uint8Array {
  const id = Uint8Array.from([0x44, 0x89]);
  const size = writeVint(8);
  const out = new Uint8Array(id.length + size.length + 8);
  out.set(id, 0);
  out.set(size, id.length);
  writeFloat(out, id.length + size.length, 8, value);
  return out;
}

function writeFloat(
  target: Uint8Array,
  offset: number,
  width: number,
  value: number
) {
  const view = new DataView(target.buffer, target.byteOffset + offset, width);
  if (width === 4) view.setFloat32(0, value);
  else view.setFloat64(0, value);
}

/**
 * Blob-facing wrapper: reads, patches, and hands back a Blob of the same type.
 * A failure anywhere returns the original blob rather than risking the take.
 */
export async function fixWebmDuration(
  blob: Blob,
  durationMs: number
): Promise<Blob> {
  if (!blob || blob.size === 0 || durationMs <= 0) return blob;
  if (!/webm|matroska/i.test(blob.type)) return blob;

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const patched = patchWebmDuration(bytes, durationMs);
    return patched === bytes
      ? blob
      : new Blob([patched.buffer as ArrayBuffer], { type: blob.type });
  } catch {
    return blob;
  }
}
