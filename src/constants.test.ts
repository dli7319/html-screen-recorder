import { describe, expect, it } from 'vitest';
import { FORMATS_TO_CHECK } from './constants';

describe('FORMATS_TO_CHECK', () => {
  it('lists the six candidate recording formats', () => {
    expect(FORMATS_TO_CHECK).toHaveLength(6);
  });

  it('gives every format a label, a codec string and a container', () => {
    for (const format of FORMATS_TO_CHECK) {
      expect(format.name).toBeTruthy();
      expect(format.mimeType).toMatch(/^video\/(mp4|webm); codecs=/);
      expect(['mp4', 'webm']).toContain(format.ext);
    }
  });

  it('keeps mime types unique so the picker cannot show duplicates', () => {
    const mimeTypes = FORMATS_TO_CHECK.map((format) => format.mimeType);
    expect(new Set(mimeTypes).size).toBe(mimeTypes.length);
  });

  it('pairs each file extension with its container type', () => {
    for (const format of FORMATS_TO_CHECK) {
      const container = format.mimeType.split(';')[0].split('/')[1];
      expect(format.ext).toBe(container);
    }
  });

  it('orders formats from most to least preferred', () => {
    // The picker shows them in array order, so the first supported one is the
    // default. AV1 + Opus leads because it gives the smallest files.
    expect(FORMATS_TO_CHECK[0].mimeType).toContain('av01');
    expect(FORMATS_TO_CHECK[0].ext).toBe('mp4');
  });
});
